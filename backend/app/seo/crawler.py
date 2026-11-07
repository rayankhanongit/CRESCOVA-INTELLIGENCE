"""Polite, bounded, same-site crawler. Honours robots.txt and Crawl-delay; never authenticates or solves CAPTCHAs."""
import asyncio
from collections import deque
from dataclasses import dataclass, field
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
from urllib.robotparser import RobotFileParser

from lxml import etree

from .fetcher import Fetcher
from .parse import PageRecord, parse_page

SKIP_EXT = (".pdf", ".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg", ".ico", ".css", ".js", ".zip", ".gz", ".mp4",
            ".mp3", ".woff", ".woff2", ".ttf", ".xml", ".json", ".txt", ".doc", ".docx", ".xls", ".xlsx", ".avif")
TRACKING = ("utm_", "fbclid", "gclid", "mc_", "_ga")
MAX_CRAWL_DELAY = 10.0
MAX_EXTERNAL_CHECKS = 30
MAX_IMAGE_CHECKS = 50
LINK_CHECK_CONCURRENCY = 4
LINK_CHECK_TIMEOUT = 6.0   # seconds per external link / image check
LINK_CHECK_BUDGET = 40.0   # seconds for all of them together


@dataclass
class CrawlConfig:
    max_pages: int = 50
    max_depth: int = 3
    delay: float = 0.5
    single_url: bool = False
    user_agent: str = "CrescovaBot/1.0"
    respect_robots: bool = True


@dataclass
class RobotsInfo:
    status: int | None = None
    present: bool = False
    error: str | None = None
    blocks_start: bool = False
    crawl_delay: float | None = None
    sitemaps: list[str] = field(default_factory=list)


@dataclass
class SitemapInfo:
    url: str = ""
    found: bool = False
    url_count: int = 0
    error: str | None = None
    urls: list[str] = field(default_factory=list)


@dataclass
class CrawlResult:
    start_url: str
    pages: list[PageRecord] = field(default_factory=list)
    robots: RobotsInfo = field(default_factory=RobotsInfo)
    sitemap: SitemapInfo = field(default_factory=SitemapInfo)
    skipped_by_robots: list[str] = field(default_factory=list)
    external_status: dict[str, int | None] = field(default_factory=dict)  # None = blocked/unreachable, not "broken"
    image_status: dict[str, int | None] = field(default_factory=dict)
    truncated: bool = False


def normalize(url: str) -> str:
    p = urlsplit(url)
    host = (p.hostname or "").lower()
    host = f"[{host}]" if ":" in host else host
    port = p.port
    if port and port not in (80, 443):
        host += f":{port}"
    query = urlencode([(k, v) for k, v in parse_qsl(p.query, keep_blank_values=True) if not k.lower().startswith(TRACKING)])
    return urlunsplit((p.scheme.lower(), host, p.path or "/", query, ""))


def same_site(url: str, site_host: str) -> bool:
    strip = lambda h: h[4:] if h.startswith("www.") else h  # noqa: E731
    return strip((urlsplit(url).hostname or "").lower()) == strip(site_host.lower())


def _parse_sitemap(text: str) -> tuple[list[str], list[str]]:
    """Returns (page urls, child sitemap urls). XXE-safe parser: no entities, DTDs or network."""
    parser = etree.XMLParser(resolve_entities=False, no_network=True, load_dtd=False, huge_tree=False)
    root = etree.fromstring(text.encode("utf-8", errors="replace"), parser)
    locs = [(el.text or "").strip() for el in root.iter() if isinstance(el.tag, str) and el.tag.endswith("}loc") or el.tag == "loc"]
    kind = etree.QName(root).localname
    return ([], locs) if kind == "sitemapindex" else (locs, [])


async def _load_sitemap(fetcher: Fetcher, candidates: list[str], site_host: str) -> SitemapInfo:
    info = SitemapInfo()
    for cand in candidates:
        res = await fetcher.fetch(cand)
        if res.status != 200 or not res.text:
            info.error = res.error or f"HTTP {res.status}"
            continue
        try:
            pages, children = _parse_sitemap(res.text)
            for child in children[:3]:  # one level of sitemap index, bounded
                cres = await fetcher.fetch(child)
                if cres.status == 200 and cres.text:
                    pages += _parse_sitemap(cres.text)[0]
        except etree.XMLSyntaxError:
            info.error = "Sitemap is not valid XML"
            continue
        info.url, info.found, info.error = cand, True, None
        info.urls = [u for u in dict.fromkeys(pages) if same_site(u, site_host)][:1000]
        info.url_count = len(info.urls)
        return info
    return info


async def crawl(start_url: str, cfg: CrawlConfig, fetcher: Fetcher) -> CrawlResult:
    start_url = normalize(start_url)
    sp = urlsplit(start_url)
    site_host = sp.hostname or ""
    origin = f"{sp.scheme}://{sp.netloc}"
    out = CrawlResult(start_url=start_url)

    # robots.txt
    rp = RobotFileParser()
    rres = await fetcher.fetch(f"{origin}/robots.txt")
    out.robots.status = rres.status
    if rres.status == 200 and rres.text:
        rp.parse(rres.text.splitlines())
        rp.modified()
        out.robots.present = True
        out.robots.sitemaps = [s for s in (rp.site_maps() or [])][:5]
        cd = rp.crawl_delay(cfg.user_agent) or rp.crawl_delay("*")
        out.robots.crawl_delay = float(cd) if cd else None
    else:
        rp.allow_all = True
        out.robots.error = rres.error or (f"HTTP {rres.status}" if rres.status else None)
    out.robots.blocks_start = out.robots.present and not rp.can_fetch(cfg.user_agent, start_url)
    delay = min(max(cfg.delay, out.robots.crawl_delay or 0), MAX_CRAWL_DELAY)

    out.sitemap = await _load_sitemap(fetcher, out.robots.sitemaps + [f"{origin}/sitemap.xml"], site_host)

    seen = {start_url}
    queue: deque[tuple[str, int]] = deque([(start_url, 0)])
    sitemap_seeded = False
    first = True
    while True:
        if not queue:
            if sitemap_seeded or cfg.single_url:
                break
            sitemap_seeded = True  # pages only reachable via the sitemap are audited after link discovery
            for u in out.sitemap.urls:
                n = normalize(u)
                if n not in seen and len(seen) < cfg.max_pages and not n.lower().split("?")[0].endswith(SKIP_EXT):
                    seen.add(n)
                    queue.append((n, 1))
            continue
        if len(out.pages) >= cfg.max_pages:
            out.truncated = out.truncated or bool(queue)
            break
        url, depth = queue.popleft()
        if cfg.respect_robots and not rp.can_fetch(cfg.user_agent, url):
            out.skipped_by_robots.append(url)
            continue
        if not first:
            await asyncio.sleep(delay)
        first = False
        res = await fetcher.fetch(url)
        rec = parse_page(res, depth, site_host)
        out.pages.append(rec)
        if res.final_url != url:
            seen.add(normalize(res.final_url))
        if cfg.single_url or not rec.ok or depth >= cfg.max_depth or not same_site(res.final_url, site_host):
            continue
        for link in rec.internal_links:
            n = normalize(link)
            if n in seen or n.lower().split("?")[0].endswith(SKIP_EXT):
                continue
            if len(seen) >= cfg.max_pages:
                out.truncated = True
                continue
            seen.add(n)
            queue.append((n, depth + 1))

    # Spot-check external links and images (bounded, via HEAD with GET fallback).
    ext = list(dict.fromkeys(u for p in out.pages for u in p.external_links))[:MAX_EXTERNAL_CHECKS]
    imgs = list(dict.fromkeys(i["src"] for p in out.pages for i in p.images))[:MAX_IMAGE_CHECKS]
    sem = asyncio.Semaphore(LINK_CHECK_CONCURRENCY)

    async def check(url: str, bucket: dict) -> None:
        async with sem:
            bucket[url] = await _status_of(fetcher, url)

    jobs = [check(u, out.external_status) for u in ext] + [check(u, out.image_status) for u in imgs]
    try:  # overall budget: slow third-party hosts must not stall the audit; unchecked URLs are simply left "unknown"
        await asyncio.wait_for(asyncio.gather(*jobs), LINK_CHECK_BUDGET)
    except asyncio.TimeoutError:
        pass
    return out


async def _status_of(fetcher: Fetcher, url: str) -> int | None:
    try:
        res = await asyncio.wait_for(fetcher.fetch(url, "HEAD"), LINK_CHECK_TIMEOUT)
        if res.status in (403, 405, 501):
            res = await asyncio.wait_for(fetcher.fetch(url, "GET"), LINK_CHECK_TIMEOUT)
    except asyncio.TimeoutError:
        return None
    return None if res.error else res.status  # errors (incl. SSRF blocks, timeouts) are "unknown", not "broken"
