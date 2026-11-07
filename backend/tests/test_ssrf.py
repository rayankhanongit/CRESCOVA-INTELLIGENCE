import asyncio
import socket

import pytest

from app.seo import ssrf
from app.seo.fetcher import GuardedFetcher
from app.seo.ssrf import UnsafeURL, is_public_ip, parse_public_url


@pytest.mark.parametrize("ip", [
    "127.0.0.1", "127.9.9.9", "10.0.0.5", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1",
    "0.0.0.0", "224.0.0.1", "::1", "fe80::1", "fc00::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1", "64:ff9b::7f00:1", "2002:7f00:1::1",
])
def test_non_public_ips_rejected(ip):
    assert not is_public_ip(ip)


@pytest.mark.parametrize("ip", ["93.184.216.34", "8.8.8.8", "2606:4700:4700::1111"])
def test_public_ips_allowed(ip):
    assert is_public_ip(ip)


@pytest.mark.parametrize("url", [
    "http://localhost/", "http://LOCALHOST:8080/", "http://127.0.0.1/", "http://[::1]/", "http://169.254.169.254/latest/meta-data/",
    "http://10.1.2.3/", "http://192.168.0.1/admin", "http://foo.internal/", "http://printer.local/", "ftp://example.com/",
    "file:///etc/passwd", "javascript:alert(1)", "http://user:pass@example.com/", "http://example.com:22/", "http://example.com:3306/",
    "http://0.0.0.0/", "", "http://", "http://[::ffff:127.0.0.1]/",
])
def test_unsafe_urls_rejected_before_any_network_use(url):
    with pytest.raises(UnsafeURL):
        parse_public_url(url)


def test_normalises_public_url():
    assert parse_public_url("HTTPS://Example.COM:443/a?b=1#frag") == "https://example.com/a?b=1"
    assert parse_public_url("http://example.com") == "http://example.com/"


def test_decimal_and_hex_ip_forms_caught_by_resolution(monkeypatch, real_dns):
    # getaddrinfo would turn "2130706433" into 127.0.0.1; the post-resolution check must catch it.
    monkeypatch.setattr(socket, "getaddrinfo", lambda host, port, **kw: [(2, 1, 6, "", ("127.0.0.1", port))])
    with pytest.raises(UnsafeURL):
        ssrf.validate_target("http://2130706433/")


def test_hostname_resolving_to_private_address_rejected(monkeypatch, real_dns):
    monkeypatch.setattr(socket, "getaddrinfo", lambda host, port, **kw: [(2, 1, 6, "", ("93.184.216.34", port)), (2, 1, 6, "", ("10.0.0.9", port))])
    with pytest.raises(UnsafeURL):
        ssrf.validate_target("http://rebind.example.com/")


def test_unresolvable_host_rejected(monkeypatch, real_dns):
    def boom(*a, **k):
        raise socket.gaierror("nope")
    monkeypatch.setattr(socket, "getaddrinfo", boom)
    with pytest.raises(UnsafeURL):
        ssrf.validate_target("https://does-not-exist.example/")


def test_real_fetcher_blocks_localhost_and_metadata():
    async def go():
        f = GuardedFetcher("test-agent", timeout=3)
        try:
            return [await f.fetch(u) for u in ("http://127.0.0.1/", "http://localhost:8080/", "http://169.254.169.254/latest/meta-data/", "http://[::1]/")]
        finally:
            await f.close()
    for res in asyncio.run(go()):
        assert res.blocked and res.status is None and "Blocked" in res.error


def test_connect_time_guard_catches_dns_rebinding(monkeypatch):
    """A hostname that passes syntax checks but resolves to a private IP at connect time must not be contacted."""
    async def rebinding_resolve(host, port):  # same validation path as the real resolver, but DNS now answers with a private IP
        return ssrf._check_addresses([(2, 1, 6, "", ("10.0.0.7", port))])
    monkeypatch.setattr(ssrf, "resolve_public", rebinding_resolve)

    async def go():
        f = GuardedFetcher("test-agent", timeout=3)
        try:
            return await f.fetch("http://rebind.example.com/")
        finally:
            await f.close()
    res = asyncio.run(go())
    assert res.blocked and "non-public" in res.error


def test_redirect_to_internal_address_is_blocked():
    """Every redirect hop is re-validated: a public URL redirecting to the metadata IP must fail."""
    import httpx

    async def go():
        f = GuardedFetcher("test-agent", timeout=3)
        f._client = httpx.AsyncClient(transport=httpx.MockTransport(
            lambda req: httpx.Response(302, headers={"location": "http://169.254.169.254/latest/meta-data/"})), follow_redirects=False)
        try:
            return await f.fetch("https://example.com/")
        finally:
            await f.close()
    res = asyncio.run(go())
    assert res.blocked and res.redirects and res.redirects[0]["status"] == 302


def test_website_api_rejects_private_targets(authed):
    for url in ("http://localhost:8080", "http://169.254.169.254/", "http://192.168.1.1", "ftp://example.com"):
        r = authed.post("/api/websites", json={"name": "x", "url": url})
        assert r.status_code == 422, url
