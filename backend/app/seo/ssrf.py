"""SSRF protection for everything that fetches a user-supplied URL.

Three layers:
1. parse_public_url: scheme, credentials, port and obvious-internal hostname checks.
2. resolve_public: every address a hostname resolves to must be globally routable.
3. GuardedBackend: re-resolves and re-validates at *connect time* and connects to the validated IP,
   so DNS rebinding between check and use is not possible. Redirects are re-validated by the fetcher.
"""
import asyncio
import ipaddress
import socket
from urllib.parse import urlsplit, urlunsplit

import httpcore

ALLOWED_PORTS = {80, 443, 8080, 8443}
BLOCKED_SUFFIXES = (".local", ".localhost", ".internal", ".localdomain", ".lan", ".home.arpa")
_NAT64 = ipaddress.ip_network("64:ff9b::/96")


class UnsafeURL(ValueError):
    """Raised when a URL or resolved address is not allowed to be fetched."""


def is_public_ip(ip) -> bool:
    if isinstance(ip, str):
        try:
            ip = ipaddress.ip_address(ip.split("%")[0])
        except ValueError:
            return False
    if ip.version == 6:
        if ip.ipv4_mapped:
            return is_public_ip(ip.ipv4_mapped)
        if ip.sixtofour:
            return is_public_ip(ip.sixtofour)
        if ip in _NAT64:
            return is_public_ip(ipaddress.IPv4Address(int(ip) & 0xFFFFFFFF))
    return ip.is_global and not ip.is_multicast


def parse_public_url(url: str) -> str:
    """Validate syntax and return a normalised URL. Does not touch the network."""
    url = (url or "").strip()
    if not url or len(url) > 2048:
        raise UnsafeURL("URL is empty or too long")
    parts = urlsplit(url)
    if parts.scheme not in ("http", "https"):
        raise UnsafeURL("Only http:// and https:// URLs are allowed")
    if parts.username or parts.password:
        raise UnsafeURL("URLs containing credentials are not allowed")
    host = (parts.hostname or "").rstrip(".").lower()
    if not host:
        raise UnsafeURL("URL has no hostname")
    try:
        explicit_port = parts.port
    except ValueError:
        raise UnsafeURL("Invalid port") from None
    default = 443 if parts.scheme == "https" else 80
    if (explicit_port or default) not in ALLOWED_PORTS:
        raise UnsafeURL("Port not allowed (use 80, 443, 8080 or 8443)")
    if host == "localhost" or host.endswith(BLOCKED_SUFFIXES):
        raise UnsafeURL("Internal hostnames are not allowed")
    try:
        literal = ipaddress.ip_address(host)
    except ValueError:
        literal = None
    if literal is not None:
        if not is_public_ip(literal):
            raise UnsafeURL("Private, loopback and link-local addresses are not allowed")
        netloc = f"[{host}]" if literal.version == 6 else host
    else:
        try:
            netloc = host.encode("idna").decode("ascii")
        except UnicodeError:
            raise UnsafeURL("Invalid hostname") from None
    if explicit_port and explicit_port != default:
        netloc += f":{explicit_port}"
    return urlunsplit((parts.scheme, netloc, parts.path or "/", parts.query, ""))


def _check_addresses(infos) -> list[str]:
    ips = list(dict.fromkeys(i[4][0] for i in infos))
    if not ips:
        raise UnsafeURL("Hostname does not resolve")
    if any(not is_public_ip(ip) for ip in ips):
        raise UnsafeURL("Hostname resolves to a non-public address")
    return ips


def resolve_public_sync(host: str, port: int) -> list[str]:
    try:
        return _check_addresses(socket.getaddrinfo(host, port, type=socket.SOCK_STREAM))
    except socket.gaierror:
        raise UnsafeURL("Hostname does not resolve") from None


async def resolve_public(host: str, port: int) -> list[str]:
    try:
        infos = await asyncio.get_running_loop().getaddrinfo(host, port, type=socket.SOCK_STREAM)
    except socket.gaierror:
        raise UnsafeURL("Hostname does not resolve") from None
    return _check_addresses(infos)


def validate_target(url: str) -> str:
    """Full synchronous validation used when saving a website: syntax + DNS resolution."""
    clean = parse_public_url(url)
    parts = urlsplit(clean)
    resolve_public_sync(parts.hostname, parts.port or (443 if parts.scheme == "https" else 80))
    return clean


class GuardedBackend(httpcore.AsyncNetworkBackend):
    """Validates resolved IPs at connect time and connects to the validated IP (TLS SNI is unaffected)."""

    def __init__(self, inner: httpcore.AsyncNetworkBackend):
        self._inner = inner

    async def connect_tcp(self, host, port, timeout=None, local_address=None, socket_options=None):
        ips = await resolve_public(host, port)
        last: Exception | None = None
        for ip in ips:
            try:
                return await self._inner.connect_tcp(
                    ip, port, timeout=timeout, local_address=local_address, socket_options=socket_options
                )
            except httpcore.ConnectError as exc:
                last = exc
        raise last or UnsafeURL("Could not connect")

    async def connect_unix_socket(self, path, timeout=None, socket_options=None):
        raise UnsafeURL("Unix sockets are not allowed")

    async def sleep(self, seconds: float) -> None:
        await self._inner.sleep(seconds)
