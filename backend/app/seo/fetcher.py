"""HTTP fetching for the crawler. All real network access goes through GuardedFetcher (SSRF-safe)."""
import time
from dataclasses import dataclass, field
from typing import Protocol
from urllib.parse import urljoin

import httpx

from .ssrf import GuardedBackend, UnsafeURL, parse_public_url

TEXT_TYPES = ("text/", "application/xhtml", "application/xml", "application/json", "application/ld+json")


@dataclass
class FetchResult:
    url: str
    final_url: str
    status: int | None = None
    headers: dict[str, str] = field(default_factory=dict)
    text: str = ""
    content_type: str = ""
    redirects: list[dict] = field(default_factory=list)  # [{"url":..., "status":...}] one per hop
    elapsed_ms: int = 0
    error: str | None = None
    blocked: bool = False  # True when refused by the SSRF guard (not a site fault)


class Fetcher(Protocol):
    async def fetch(self, url: str, method: str = "GET") -> FetchResult: ...
    async def close(self) -> None: ...


class GuardedFetcher:
    def __init__(self, user_agent: str, timeout: float = 10.0, max_bytes: int = 2_000_000, max_redirects: int = 5):
        transport = httpx.AsyncHTTPTransport(retries=0)
        pool = transport._pool  # swap the network backend for the SSRF-validating one
        pool._network_backend = GuardedBackend(pool._network_backend)
        self._client = httpx.AsyncClient(
            transport=transport, follow_redirects=False, trust_env=False,
            headers={"User-Agent": user_agent, "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.5"},
            timeout=httpx.Timeout(timeout),
        )
        self._max_bytes = max_bytes
        self._max_redirects = max_redirects

    async def close(self) -> None:
        await self._client.aclose()

    async def fetch(self, url: str, method: str = "GET") -> FetchResult:
        result = FetchResult(url=url, final_url=url)
        current = url
        started = time.monotonic()
        try:
            for _ in range(self._max_redirects + 1):
                current = parse_public_url(current)  # re-validate every hop
                async with self._client.stream(method, current) as r:
                    location = r.headers.get("location")
                    if r.status_code in (301, 302, 303, 307, 308) and location:
                        result.redirects.append({"url": current, "status": r.status_code})
                        current = urljoin(current, location)
                        continue
                    result.final_url = current
                    result.status = r.status_code
                    result.headers = {k.lower(): v for k, v in r.headers.items()}
                    result.content_type = result.headers.get("content-type", "").lower()
                    if method != "HEAD" and result.content_type.startswith(TEXT_TYPES):
                        body = bytearray()
                        async for chunk in r.aiter_bytes():
                            body.extend(chunk)
                            if len(body) >= self._max_bytes:
                                break
                        try:
                            result.text = bytes(body).decode(r.encoding or "utf-8", errors="replace")
                        except LookupError:
                            result.text = bytes(body).decode("utf-8", errors="replace")
                    break
            else:
                result.error = f"Too many redirects (more than {self._max_redirects})"
        except UnsafeURL as exc:
            result.error, result.blocked = f"Blocked: {exc}", True
        except httpx.TimeoutException:
            result.error = "Request timed out"
        except httpx.RequestError as exc:
            result.error = f"Request failed: {type(exc).__name__}"
        result.elapsed_ms = int((time.monotonic() - started) * 1000)
        return result
