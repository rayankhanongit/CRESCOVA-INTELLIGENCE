"""
Crescova AI Provider
Supports Gemini, OpenAI and Groq.

Optimized for:
- Low-latency AI generation
- Gemini Flash-Lite minimal thinking
- Controlled automatic retries
- Efficient HTTP connection handling
- JSON responses
- Safe API key management
"""

import time
from dataclasses import dataclass

import httpx

from ..config import get_settings


# ==================================================
# CONFIGURATION
# ==================================================

DEFAULT_MODELS = {
    "gemini": "gemini-3.5-flash-lite",
    "openai": "gpt-4o-mini",
    "groq": "llama-3.3-70b-versatile",
}

GEMINI_URL = (
    "https://generativelanguage.googleapis.com/"
    "v1beta/models/{model}:generateContent"
)

OPENAI_URL = (
    "https://api.openai.com/v1/chat/completions"
)

GROQ_URL = (
    "https://api.groq.com/openai/v1/chat/completions"
)

MAX_RETRIES = 1

RETRYABLE_STATUS_CODES = {
    500,
    502,
    503,
    504,
}


# ==================================================
# EXCEPTIONS
# ==================================================

class AIUnavailable(Exception):
    """AI provider or API key is not configured."""


class AIError(Exception):
    """AI provider request failed."""


# ==================================================
# RESULT MODEL
# ==================================================

@dataclass
class AIResult:
    text: str
    provider: str
    model: str
    tokens_in: int | None = None
    tokens_out: int | None = None


# ==================================================
# PROVIDER CONFIGURATION
# ==================================================

def active() -> tuple[str, str, str] | None:

    settings = get_settings()

    provider = settings.ai_provider.lower().strip()

    keys = {
        "gemini": settings.gemini_api_key,
        "openai": settings.openai_api_key,
        "groq": settings.groq_api_key,
    }

    if provider not in keys:
        return None

    key = (keys[provider] or "").strip()

    if not key:
        return None

    model = (
        (settings.ai_model or "").strip()
        or DEFAULT_MODELS[provider]
    )

    return provider, key, model


# ==================================================
# HTTP CLIENT
# ==================================================

def create_client() -> httpx.Client:

    return httpx.Client(

        timeout=httpx.Timeout(
            90.0,
            connect=10.0,
            read=90.0,
            write=30.0,
            pool=10.0,
        ),

        trust_env=False,

        follow_redirects=False,
    )


# ==================================================
# ERROR EXTRACTION
# ==================================================

def extract_error(response: httpx.Response) -> str:

    try:

        data = response.json()

        error = data.get("error", {})

        if isinstance(error, dict):

            message = error.get("message")

            if message:
                return str(message)[:500]

    except (ValueError, AttributeError):
        pass

    return f"HTTP {response.status_code}"


# ==================================================
# HTTP REQUEST WITH CONTROLLED RETRIES
# ==================================================

def _post(
    client: httpx.Client,
    url: str,
    headers: dict,
    body: dict,
) -> dict:

    for attempt in range(MAX_RETRIES + 1):

        try:

            response = client.post(
                url,
                headers=headers,
                json=body,
            )

        except httpx.TimeoutException:

            if attempt < MAX_RETRIES:

                time.sleep(1)

                continue

            raise AIError(
                "The AI provider timed out."
            ) from None

        except httpx.HTTPError:

            if attempt < MAX_RETRIES:

                time.sleep(1)

                continue

            raise AIError(
                "Could not connect to the AI provider."
            ) from None

        # Retry temporary server failures once.

        if response.status_code in RETRYABLE_STATUS_CODES:

            if attempt < MAX_RETRIES:

                retry_after = response.headers.get(
                    "Retry-After"
                )

                try:

                    delay = min(
                        max(float(retry_after), 0),
                        3,
                    )

                except (TypeError, ValueError):

                    delay = 1

                time.sleep(delay)

                continue

        # Handle provider errors.

        if response.status_code >= 400:

            message = extract_error(response)

            if response.status_code == 429:

                raise AIError(
                    f"AI rate limit or quota exceeded: {message}"
                )

            if response.status_code == 503:

                raise AIError(
                    f"AI provider temporarily unavailable: {message}"
                )

            if response.status_code == 404:

                raise AIError(
                    f"AI model not found. Check AI_MODEL: {message}"
                )

            raise AIError(
                f"AI provider returned HTTP "
                f"{response.status_code}: {message}"
            )

        try:

            return response.json()

        except ValueError:

            raise AIError(
                "AI provider returned invalid JSON."
            ) from None

    raise AIError(
        "AI request failed after retry."
    )


# ==================================================
# OPENAI / GROQ
# ==================================================

def call_openai_compatible(
    client: httpx.Client,
    provider: str,
    url: str,
    key: str,
    model: str,
    system: str,
    prompt: str,
    json_mode: bool,
) -> AIResult:

    body = {

        "model": model,

        "messages": [

            {
                "role": "system",
                "content": system,
            },

            {
                "role": "user",
                "content": prompt,
            },

        ],

        "temperature": 0.4,

    }

    if json_mode:

        body["response_format"] = {
            "type": "json_object"
        }

    headers = {

        "Authorization": f"Bearer {key}",

        "Content-Type": "application/json",

    }

    data = _post(
        client,
        url,
        headers,
        body,
    )

    try:

        message = data["choices"][0]["message"]

        content = message.get("content") or ""

        if isinstance(content, list):

            content = "".join(
                item.get("text", "")
                for item in content
                if isinstance(item, dict)
            )

        if not isinstance(content, str):

            raise TypeError()

    except (KeyError, IndexError, TypeError):

        raise AIError(
            "OpenAI-compatible provider returned an unexpected response."
        ) from None

    usage = data.get("usage") or {}

    return AIResult(

        text=content,

        provider=provider,

        model=model,

        tokens_in=usage.get("prompt_tokens"),

        tokens_out=usage.get("completion_tokens"),

    )


# ==================================================
# GEMINI
# ==================================================

def call_gemini(
    client: httpx.Client,
    key: str,
    model: str,
    system: str,
    prompt: str,
    json_mode: bool,
) -> AIResult:

    # Optimize reasoning for Flash-Lite models.

    generation_config = {

        "temperature": 0.4,

        "maxOutputTokens": 4096,

    }

    # Gemini 3.5 Flash-Lite supports minimal thinking.

    if model.startswith(
        (
            "gemini-3.5-flash-lite",
            "gemini-3.1-flash-lite",
        )
    ):

        generation_config["thinkingConfig"] = {

            "thinkingLevel": "minimal"

        }

    if json_mode:

        generation_config["responseMimeType"] = (
            "application/json"
        )

    body = {

        "systemInstruction": {

            "parts": [

                {
                    "text": system
                }

            ]

        },

        "contents": [

            {

                "role": "user",

                "parts": [

                    {
                        "text": prompt
                    }

                ],

            }

        ],

        "generationConfig": generation_config,

    }

    headers = {

        "x-goog-api-key": key,

        "Content-Type": "application/json",

    }

    # Avoid accidentally duplicating the models/ prefix.

    model_name = model.removeprefix("models/")

    url = GEMINI_URL.format(
        model=model_name
    )

    data = _post(
        client,
        url,
        headers,
        body,
    )

    try:

        candidates = data.get("candidates", [])

        if not candidates:

            feedback = data.get(
                "promptFeedback",
                {},
            )

            block_reason = feedback.get(
                "blockReason",
                "No response candidates returned",
            )

            raise AIError(
                f"Gemini did not generate a response: {block_reason}"
            )

        candidate = candidates[0]

        content = candidate.get(
            "content",
            {},
        )

        parts = content.get(
            "parts",
            [],
        )

        text = "".join(

            part.get("text", "")

            for part in parts

            if isinstance(part, dict)

        )

        if not text.strip():

            finish_reason = candidate.get(
                "finishReason",
                "UNKNOWN",
            )

            raise AIError(
                f"Gemini returned an empty response. "
                f"Finish reason: {finish_reason}"
            )

    except AIError:

        raise

    except (KeyError, IndexError, TypeError):

        raise AIError(
            "Gemini returned an unexpected response format."
        ) from None

    usage = data.get(
        "usageMetadata",
        {},
    )

    return AIResult(

        text=text,

        provider="gemini",

        model=model,

        tokens_in=usage.get(
            "promptTokenCount"
        ),

        tokens_out=usage.get(
            "candidatesTokenCount"
        ),

    )


# ==================================================
# MAIN AI ENTRY POINT
# ==================================================

def complete(
    system: str,
    prompt: str,
    json_mode: bool = False,
    client: httpx.Client | None = None,
) -> AIResult:

    config = active()

    if not config:

        raise AIUnavailable(
            "No AI provider or API key is configured."
        )

    provider, key, model = config

    own_client = client is None

    http_client = client or create_client()

    try:

        if provider == "gemini":

            return call_gemini(

                http_client,

                key,

                model,

                system,

                prompt,

                json_mode,

            )

        if provider == "openai":

            return call_openai_compatible(

                http_client,

                provider,

                OPENAI_URL,

                key,

                model,

                system,

                prompt,

                json_mode,

            )

        if provider == "groq":

            return call_openai_compatible(

                http_client,

                provider,

                GROQ_URL,

                key,

                model,

                system,

                prompt,

                json_mode,

            )

        raise AIUnavailable(
            f"Unsupported AI provider: {provider}"
        )

    finally:

        if own_client:

            http_client.close()