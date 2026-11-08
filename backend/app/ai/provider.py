"""One interface over Gemini, OpenAI and Groq using plain HTTPS (no vendor SDKs).

Keys come from the environment only. They go in headers, never in URLs, and are never logged or returned.
Only the fixed provider hosts below are ever contacted, so user input cannot redirect these requests (no SSRF).
"""
from dataclasses import dataclass

import httpx

from ..config import get_settings

# Model names change over time. These are defaults only: set AI_MODEL in backend/.env to override.
DEFAULT_MODELS = {"openai": "gpt-4o-mini", "gemini": "gemini-2.0-flash", "groq": "llama-3.3-70b-versatile"}
OPENAI_URL = "https://api.openai.com/v1/chat/completions"
GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"
GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"


class AIUnavailable(Exception):
    """No provider/key is configured."""


class AIError(Exception):
    """The provider call failed. The message is safe to show: it never contains provider response bodies."""


@dataclass
class AIResult:
    text: str
    provider: str
    model: str
    tokens_in: int | None = None
    tokens_out: int | None = None


def active() -> tuple[str, str, str] | None:
    """(provider, key, model) when AI is configured, else None."""
    s = get_settings()
    key = {"openai": s.openai_api_key, "gemini": s.gemini_api_key, "groq": s.groq_api_key}.get(s.ai_provider, "")
    return (s.ai_provider, key, s.ai_model or DEFAULT_MODELS[s.ai_provider]) if key else None


def _post(client: httpx.Client, url: str, headers: dict, body: dict) -> dict:
    try:
        r = client.post(url, headers=headers, json=body)
    except httpx.TimeoutException:
        raise AIError("The AI provider timed out") from None
    except httpx.HTTPError:
        raise AIError("Could not reach the AI provider") from None
    if r.status_code >= 400:
        raise AIError(f"The AI provider returned HTTP {r.status_code}")
    try:
        return r.json()
    except ValueError:
        raise AIError("The AI provider returned an unreadable response") from None


def call_openai_compatible(client: httpx.Client, provider: str, url: str, key: str, model: str, system: str, prompt: str, json_mode: bool) -> AIResult:
    body = {"model": model, "messages": [{"role": "system", "content": system}, {"role": "user", "content": prompt}]}
    if json_mode:
        body["response_format"] = {"type": "json_object"}
    data = _post(client, url, {"Authorization": f"Bearer {key}"}, body)
    try:
        text = data["choices"][0]["message"]["content"] or ""
    except (KeyError, IndexError, TypeError):
        raise AIError("The AI provider returned an unexpected response") from None
    u = data.get("usage") or {}
    return AIResult(text, provider, model, u.get("prompt_tokens"), u.get("completion_tokens"))


def call_gemini(client: httpx.Client, key: str, model: str, system: str, prompt: str, json_mode: bool) -> AIResult:
    cfg = {"maxOutputTokens": 4096, **({"responseMimeType": "application/json"} if json_mode else {})}
    body = {"systemInstruction": {"parts": [{"text": system}]}, "contents": [{"role": "user", "parts": [{"text": prompt}]}], "generationConfig": cfg}
    data = _post(client, GEMINI_URL.format(model=model), {"x-goog-api-key": key}, body)
    try:
        text = "".join(p.get("text", "") for p in data["candidates"][0]["content"]["parts"])
    except (KeyError, IndexError, TypeError):
        raise AIError("The AI provider returned an unexpected response") from None
    u = data.get("usageMetadata") or {}
    return AIResult(text, "gemini", model, u.get("promptTokenCount"), u.get("candidatesTokenCount"))


def complete(system: str, prompt: str, json_mode: bool = False, client: httpx.Client | None = None) -> AIResult:
    cfg = active()
    if not cfg:
        raise AIUnavailable()
    provider, key, model = cfg
    own = client or httpx.Client(timeout=httpx.Timeout(60.0), trust_env=False)
    try:
        if provider == "gemini":
            return call_gemini(own, key, model, system, prompt, json_mode)
        url = OPENAI_URL if provider == "openai" else GROQ_URL
        return call_openai_compatible(own, provider, url, key, model, system, prompt, json_mode)
    finally:
        if client is None:
            own.close()
