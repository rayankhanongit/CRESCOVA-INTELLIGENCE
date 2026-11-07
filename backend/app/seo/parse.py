"""HTML -> PageRecord. Pure function of the fetched response; no network access."""
import hashlib
import json
import re
from dataclasses import dataclass, field
from urllib.parse import urljoin, urlsplit, urlunsplit

from bs4 import BeautifulSoup

from .fetcher import FetchResult

MAX_LINKS = 500
REQUIRED_PROPS = {
    "Organization": ["name"], "LocalBusiness": ["name", "address"], "ProfessionalService": ["name", "address"],
    "WebSite": ["url"], "Article": ["headline"], "Product": ["name"], "Service": ["name"],
    "BreadcrumbList": ["itemListElement"], "FAQPage": ["mainEntity"], "WebPage": [],
}


@dataclass
class PageRecord:
    url: str
    final_url: str
    depth: int = 0
    status: int | None = None
    error: str | None = None
    redirects: list[dict] = field(default_factory=list)
    elapsed_ms: int = 0
    is_html: bool = False
    title: str = ""
    description: str = ""
    canonical: str = ""
    robots_meta: str = ""
    x_robots: str = ""
    lang: str = ""
    viewport: str = ""
    h1s: list[str] = field(default_factory=list)
    headings: list[list] = field(default_factory=list)  # [[level, text], ...]
    word_count: int = 0
    content_hash: str | None = None
    images: list[dict] = field(default_factory=list)  # [{"src":..., "alt": None|str}]
    internal_links: list[str] = field(default_factory=list)
    external_links: list[str] = field(default_factory=list)
    schema_types: list[str] = field(default_factory=list)
    schema_blocks: int = 0
    schema_parse_errors: int = 0
    schema_issues: list[str] = field(default_factory=list)
    og: dict = field(default_factory=dict)
    twitter: dict = field(default_factory=dict)

    @property
    def noindex(self) -> bool:
        d = f"{self.robots_meta} {self.x_robots}".lower()
        return "noindex" in d or re.search(r"\bnone\b", d) is not None

    @property
    def ok(self) -> bool:
        return self.is_html and self.status is not None and 200 <= self.status < 300

    def to_data(self) -> dict:
        """Extra detail persisted in WebsitePage.data (columns hold the headline fields)."""
        return {
            "redirects": self.redirects, "robots_meta": self.robots_meta, "x_robots": self.x_robots,
            "lang": self.lang, "viewport": self.viewport, "h1s": self.h1s, "headings": self.headings[:100],
            "images": self.images[:200], "internal_links": self.internal_links, "external_links": self.external_links,
            "schema_types": self.schema_types, "schema_blocks": self.schema_blocks,
            "schema_parse_errors": self.schema_parse_errors, "schema_issues": self.schema_issues,
            "og": self.og, "twitter": self.twitter,
        }


def strip_tracking(url: str) -> str:
    return urlunsplit(urlsplit(url)._replace(fragment=""))


def _walk_nodes(obj):
    if isinstance(obj, list):
        for item in obj:
            yield from _walk_nodes(item)
    elif isinstance(obj, dict):
        yield obj
        for v in obj.get("@graph", []) if isinstance(obj.get("@graph"), list) else []:
            yield from _walk_nodes(v)


def _types(node) -> list[str]:
    t = node.get("@type")
    t = t if isinstance(t, list) else [t]
    return [str(x).rsplit("/", 1)[-1] for x in t if x]


def _is_internal(host: str, site_host: str) -> bool:
    strip = lambda h: h[4:] if h.startswith("www.") else h  # noqa: E731
    return strip(host.lower()) == strip(site_host.lower())


def parse_page(res: FetchResult, depth: int, site_host: str) -> PageRecord:
    rec = PageRecord(url=res.url, final_url=res.final_url, depth=depth, status=res.status, error=res.error,
                     redirects=res.redirects, elapsed_ms=res.elapsed_ms, x_robots=res.headers.get("x-robots-tag", ""))
    rec.is_html = res.content_type.startswith(("text/html", "application/xhtml")) and bool(res.text)
    if not rec.is_html:
        return rec
    soup = BeautifulSoup(res.text, "lxml")
    base = res.final_url

    rec.title = (soup.title.get_text(" ", strip=True) if soup.title else "")
    meta = lambda **kw: soup.find("meta", attrs=kw)  # noqa: E731
    d = meta(name=re.compile("^description$", re.I))
    rec.description = (d.get("content") or "").strip() if d else ""
    link = soup.find("link", rel=lambda v: v and "canonical" in (v if isinstance(v, list) else [v]))
    rec.canonical = urljoin(base, link["href"].strip()) if link and link.get("href") else ""
    r = meta(name=re.compile("^robots$", re.I))
    rec.robots_meta = (r.get("content") or "").strip() if r else ""
    v = meta(name=re.compile("^viewport$", re.I))
    rec.viewport = (v.get("content") or "").strip() if v else ""
    rec.lang = (soup.html.get("lang") or "").strip() if soup.html else ""
    for m in soup.find_all("meta"):
        prop = (m.get("property") or m.get("name") or "").lower()
        if prop.startswith("og:") and m.get("content"):
            rec.og[prop] = m["content"].strip()[:300]
        elif prop.startswith("twitter:") and m.get("content"):
            rec.twitter[prop] = m["content"].strip()[:300]

    for h in soup.find_all(re.compile(r"^h[1-6]$")):
        text = h.get_text(" ", strip=True)[:160]
        rec.headings.append([int(h.name[1]), text])
        if h.name == "h1":
            rec.h1s.append(text)

    for img in soup.find_all("img"):
        src = (img.get("src") or img.get("data-src") or "").strip()
        if src and not src.startswith("data:"):
            alt = img.get("alt")
            rec.images.append({"src": urljoin(base, src), "alt": alt.strip() if alt is not None else None})

    seen: set[str] = set()
    for a in soup.find_all("a", href=True):
        href = a["href"].strip()
        if not href or href.startswith(("#", "mailto:", "tel:", "javascript:", "sms:", "data:")):
            continue
        absolute = strip_tracking(urljoin(base, href))
        parts = urlsplit(absolute)
        if parts.scheme not in ("http", "https") or absolute in seen:
            continue
        seen.add(absolute)
        (rec.internal_links if _is_internal(parts.hostname or "", site_host) else rec.external_links).append(absolute)
    rec.internal_links, rec.external_links = rec.internal_links[:MAX_LINKS], rec.external_links[:MAX_LINKS]

    for script in soup.find_all("script", type=re.compile("ld\\+json", re.I)):
        rec.schema_blocks += 1
        try:
            data = json.loads(script.string or script.get_text() or "")
        except (json.JSONDecodeError, ValueError):
            rec.schema_parse_errors += 1
            continue
        for node in _walk_nodes(data):
            for t in _types(node):
                if t not in rec.schema_types:
                    rec.schema_types.append(t)
                for prop in REQUIRED_PROPS.get(t, []):
                    if not node.get(prop):
                        rec.schema_issues.append(f"{t} is missing required property '{prop}'")

    for tag in soup(["script", "style", "noscript", "template"]):
        tag.decompose()
    text = soup.get_text(" ", strip=True)
    words = re.findall(r"\w+", text)
    rec.word_count = len(words)
    if rec.word_count >= 50:  # tiny pages would give false duplicate signals
        rec.content_hash = hashlib.sha1(" ".join(words).lower().encode()).hexdigest()
    return rec
