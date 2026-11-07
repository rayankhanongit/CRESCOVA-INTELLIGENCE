"""Offline fake of the web for crawler/API tests. Real SSRF behaviour is tested separately in test_ssrf.py."""
from urllib.parse import urljoin

from app.seo.fetcher import FetchResult

LONG = " ".join(f"word{i}" for i in range(320))


def page(title="Home | Example Co - Plumbing Services", desc="Example Co offers reliable plumbing services across the city with fast response times and fair prices.",
         body="", extra_head="", h1="<h1>Plumbing services</h1>", lang="en"):
    return (f'<html lang="{lang}"><head><title>{title}</title><meta name="description" content="{desc}">'
            f'<meta name="viewport" content="width=device-width, initial-scale=1"><link rel="canonical" href="CANON">'
            f'<meta property="og:title" content="t"><meta property="og:image" content="/i.png"><meta name="twitter:card" content="summary">'
            f'{extra_head}</head><body>{h1}<h2>Sub</h2><p>{LONG}</p>{body}</body></html>')


def good_site() -> dict:
    org = '<script type="application/ld+json">{"@context":"https://schema.org","@type":"Organization","name":"Example Co"}</script>'
    return {
        "https://example.com/robots.txt": (200, "User-agent: *\nDisallow: /private/\nSitemap: https://example.com/sitemap.xml", "text/plain"),
        "https://example.com/sitemap.xml": (200, '<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
                                                 '<url><loc>https://example.com/</loc></url><url><loc>https://example.com/about</loc></url></urlset>', "application/xml"),
        "https://example.com/": (200, page(body='<a href="/about">About</a> <a href="/missing">Gone</a> <img src="/i.png" alt="logo">', extra_head=org).replace("CANON", "https://example.com/"), "text/html"),
        "https://example.com/about": (200, page(title="About Example Co - Our Plumbing Team", desc="Meet the Example Co team: licensed plumbers with twenty years of experience serving local homes.",
                                              body='<a href="/">Home</a>').replace("CANON", "https://example.com/about"), "text/html"),
        "https://example.com/i.png": (200, "", "image/png"),
    }


class FakeFetcher:
    """site: {url: (status, body, content_type) | ("redirect", target) | ("error", message)}"""

    def __init__(self, site: dict):
        self.site, self.log = site, []

    async def close(self):
        pass

    async def fetch(self, url: str, method: str = "GET") -> FetchResult:
        self.log.append((method, url))
        redirects, current = [], url
        for _ in range(6):
            entry = self.site.get(current)
            if entry is None:
                return FetchResult(url, current, 404, {"content-type": "text/html"}, "<html><body>Not found</body></html>", "text/html", redirects)
            if entry[0] == "redirect":
                redirects.append({"url": current, "status": 301})
                current = urljoin(current, entry[1])
                continue
            if entry[0] == "error":
                return FetchResult(url, current, None, error=entry[1], redirects=redirects)
            status, body, ctype = entry
            headers = {"content-type": ctype}
            return FetchResult(url, current, status, headers, body if method != "HEAD" else "", ctype, redirects, elapsed_ms=20)
        return FetchResult(url, current, None, error="Too many redirects", redirects=redirects)
