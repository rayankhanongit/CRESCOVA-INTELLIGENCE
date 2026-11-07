"""Deterministic SEO checks. Each check yields Outcomes (pass/fail per URL); nothing here uses AI.

Adding a check = one decorated function. Metadata (severity, explanation, why, fix) lives with the check
so findings are always self-explanatory.
"""
from collections import defaultdict
from dataclasses import dataclass
from typing import Callable
from urllib.parse import urlsplit

from .crawler import CrawlResult, normalize
from .parse import PageRecord

SEVERITY_WEIGHT = {"critical": 3, "warning": 2, "info": 1}
CATEGORIES = {
    "technical": "Technical SEO", "onpage": "On-page SEO", "content": "Content & metadata",
    "indexability": "Indexability", "linking": "Internal linking", "structured": "Structured data",
}


@dataclass(frozen=True)
class CheckDef:
    id: str
    name: str
    category: str
    severity: str
    explanation: str
    why: str
    fix: str


@dataclass
class Outcome:
    check_id: str
    url: str  # page URL, or the site origin for site-wide checks
    passed: bool
    evidence: str = ""


CHECKS: dict[str, CheckDef] = {}
_FUNCS: list[Callable[[CrawlResult], list[Outcome]]] = []


def check(id, name, category, severity, explanation, why, fix):
    def deco(fn):
        CHECKS[id] = CheckDef(id, name, category, severity, explanation, why, fix)
        fn.check_id = id
        _FUNCS.append(fn)
        return fn
    return deco


def _html(site: CrawlResult) -> list[PageRecord]:
    return [p for p in site.pages if p.ok]


def _origin(site: CrawlResult) -> str:
    s = urlsplit(site.start_url)
    return f"{s.scheme}://{s.netloc}/"


def _trunc(s: str, n: int = 140) -> str:
    return s if len(s) <= n else s[: n - 1] + "…"


# ---------------------------------------------------------------- technical
@check("https_site", "Site is served over HTTPS", "technical", "critical",
       "The audited address uses plain HTTP rather than HTTPS.",
       "HTTPS is a lightweight ranking signal, browsers flag HTTP pages as 'Not secure', and it protects visitors' data.",
       "Install a TLS certificate and redirect all HTTP URLs to HTTPS with a 301.")
def _https(site):
    https = site.start_url.startswith("https://")
    return [Outcome("https_site", _origin(site), https, "" if https else f"Start URL is {site.start_url}")]


@check("http_status", "Page returns a success status", "technical", "critical",
       "The page could not be fetched successfully (HTTP error status or request failure).",
       "Pages that error cannot be indexed, waste crawl budget and frustrate visitors.",
       "Fix or remove the page, or redirect it (301) to the closest relevant live page.")
def _status(site):
    out = []
    for p in site.pages:
        ok = p.status is not None and p.status < 400
        out.append(Outcome("http_status", p.url, ok, "" if ok else (p.error or f"HTTP {p.status}")))
    return out


@check("redirect_chain", "No redirect chains", "technical", "warning",
       "The URL passes through two or more redirects before reaching its destination.",
       "Each extra hop slows the page and dilutes link signals; crawlers may give up on long chains.",
       "Point links and the first redirect straight at the final URL.")
def _chain(site):
    return [Outcome("redirect_chain", p.url, len(p.redirects) <= 1,
                    "" if len(p.redirects) <= 1 else " → ".join([r["url"] for r in p.redirects] + [p.final_url]))
            for p in site.pages if p.redirects or p.status]


@check("response_time", "Server responds quickly", "technical", "warning",
       "The server took more than 3 seconds to deliver the page.",
       "Slow responses hurt user experience and Core Web Vitals, and limit how many pages crawlers fetch.",
       "Investigate hosting, caching, database queries and heavy server-side rendering.")
def _speed(site):
    return [Outcome("response_time", p.url, p.elapsed_ms <= 3000, f"{p.elapsed_ms} ms") for p in _html(site)]


@check("viewport", "Mobile viewport configured", "technical", "warning",
       "The page has no <meta name=\"viewport\"> tag.",
       "Without it mobile browsers render a zoomed-out desktop layout; Google uses mobile-first indexing.",
       "Add <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"> to the <head>.")
def _viewport(site):
    return [Outcome("viewport", p.url, bool(p.viewport)) for p in _html(site)]


@check("broken_images", "Images load correctly", "technical", "warning",
       "One or more images on the page returned an error status.",
       "Broken images degrade the experience and look unprofessional; they also waste image-search opportunities.",
       "Fix the image URLs or remove the references.")
def _images(site):
    out = []
    for p in _html(site):
        checked = [(i["src"], site.image_status[i["src"]]) for i in p.images if i["src"] in site.image_status]
        if not checked:
            continue
        bad = [f"{u} ({s})" for u, s in checked if s is not None and s >= 400]
        out.append(Outcome("broken_images", p.url, not bad, "; ".join(bad[:5])))
    return out


# ------------------------------------------------------------- indexability
@check("robots_txt", "robots.txt is available", "indexability", "info",
       "No robots.txt file was found at the site root.",
       "robots.txt tells crawlers what to avoid and where the sitemap is. It is optional, but expected on professional sites.",
       "Publish a robots.txt at /robots.txt, referencing your sitemap.")
def _robots(site):
    r = site.robots
    return [Outcome("robots_txt", _origin(site), r.present, "" if r.present else (r.error or "Not found"))]


@check("robots_blocks_site", "robots.txt allows crawling", "indexability", "critical",
       "robots.txt disallows the start URL for crawlers.",
       "Blocking the site (or its home page) can remove it from search results entirely.",
       "Remove the blanket Disallow rule unless the site is intentionally private.")
def _blocked(site):
    if not site.robots.present:
        return []
    return [Outcome("robots_blocks_site", _origin(site), not site.robots.blocks_start,
                    "Start URL disallowed by robots.txt" if site.robots.blocks_start else "")]


@check("sitemap", "XML sitemap is available", "indexability", "warning",
       "No valid XML sitemap was found (checked robots.txt references and /sitemap.xml).",
       "Sitemaps help search engines discover and prioritise your URLs, especially on larger or newer sites.",
       "Generate a sitemap.xml listing canonical, indexable URLs and reference it in robots.txt.")
def _sitemap(site):
    s = site.sitemap
    return [Outcome("sitemap", _origin(site), s.found and s.url_count > 0,
                    f"{s.url_count} URLs in {s.url}" if s.found else (s.error or "Not found"))]


@check("noindex", "Page is indexable", "indexability", "warning",
       "The page carries a noindex directive (meta robots or X-Robots-Tag).",
       "Noindex pages are excluded from search results. That is correct for private pages but harmful on pages you want found.",
       "Remove the noindex directive if the page should appear in search.")
def _noindex(site):
    return [Outcome("noindex", p.url, not p.noindex, f"robots: {p.robots_meta or p.x_robots}" if p.noindex else "") for p in _html(site)]


@check("canonical_present", "Canonical URL declared", "indexability", "warning",
       "The page has no <link rel=\"canonical\">.",
       "A canonical tag consolidates duplicate URL variants (tracking parameters, trailing slashes) onto one preferred URL.",
       "Add a self-referencing canonical tag pointing at the preferred absolute URL.")
def _canon(site):
    return [Outcome("canonical_present", p.url, bool(p.canonical)) for p in _html(site)]


@check("canonical_self", "Canonical points to this page", "indexability", "info",
       "The canonical URL points to a different page.",
       "That tells search engines to index the other URL instead. It is correct for duplicates, but a mistake on pages you want ranked.",
       "Confirm the canonical target is intentional; otherwise make it self-referencing.")
def _canon_self(site):
    out = []
    for p in _html(site):
        if p.canonical:
            same = normalize(p.canonical) in {normalize(p.url), normalize(p.final_url)}
            out.append(Outcome("canonical_self", p.url, same, "" if same else f"Canonical: {p.canonical}"))
    return out


# ------------------------------------------------------------------ on-page
@check("title_present", "Page has a title", "onpage", "critical",
       "The page has no <title> element, or it is empty.",
       "The title is the main clickable headline in search results and one of the strongest on-page signals.",
       "Write a unique, descriptive title that leads with the page's main topic.")
def _title(site):
    return [Outcome("title_present", p.url, bool(p.title)) for p in _html(site)]


@check("title_length", "Title length is appropriate", "onpage", "warning",
       "The title is shorter than 30 or longer than 60 characters.",
       "Long titles are truncated in results; very short ones waste the chance to describe the page.",
       "Aim for roughly 30–60 characters with the key phrase near the start.")
def _title_len(site):
    return [Outcome("title_length", p.url, 30 <= len(p.title) <= 60, f"{len(p.title)} chars: {_trunc(p.title)}")
            for p in _html(site) if p.title]


@check("description_present", "Meta description present", "onpage", "warning",
       "The page has no meta description.",
       "Search engines often use it as the result snippet; a good one improves click-through rate.",
       "Write a unique 70–160 character summary that includes a reason to click.")
def _desc(site):
    return [Outcome("description_present", p.url, bool(p.description)) for p in _html(site)]


@check("description_length", "Meta description length is appropriate", "onpage", "warning",
       "The meta description is shorter than 70 or longer than 160 characters.",
       "Over-long descriptions are cut off in results; very short ones give little reason to click.",
       "Aim for about 70–160 characters.")
def _desc_len(site):
    return [Outcome("description_length", p.url, 70 <= len(p.description) <= 160, f"{len(p.description)} chars")
            for p in _html(site) if p.description]


@check("h1_present", "Page has an H1", "onpage", "warning",
       "The page has no <h1> heading.",
       "The H1 tells users and search engines what the page is about.",
       "Add one clear H1 that matches the page's primary topic.")
def _h1(site):
    return [Outcome("h1_present", p.url, bool(p.h1s)) for p in _html(site)]


@check("h1_single", "Exactly one H1", "onpage", "warning",
       "The page has more than one <h1> heading.",
       "Multiple H1s blur the page's primary topic and usually signal template problems.",
       "Keep a single H1 and demote the others to H2/H3.")
def _h1_single(site):
    return [Outcome("h1_single", p.url, len(p.h1s) == 1, f"{len(p.h1s)} H1s: " + "; ".join(_trunc(h, 50) for h in p.h1s[:4]))
            for p in _html(site) if p.h1s]


@check("heading_hierarchy", "Headings follow a logical order", "onpage", "info",
       "The heading outline skips a level (for example H2 followed directly by H4).",
       "A logical outline helps screen-reader users and makes the page structure clearer to crawlers.",
       "Nest headings without skipping levels.")
def _hier(site):
    out = []
    for p in _html(site):
        if not p.headings:
            continue
        levels = [h[0] for h in p.headings]
        skip = next(((a, b) for a, b in zip(levels, levels[1:]) if b > a + 1), None)
        out.append(Outcome("heading_hierarchy", p.url, skip is None, f"H{skip[0]} followed by H{skip[1]}" if skip else ""))
    return out


@check("image_alt", "Images have alt text", "onpage", "warning",
       "One or more images have no alt attribute.",
       "Alt text is essential for accessibility and helps search engines understand images. (Empty alt on decorative images is valid.)",
       "Add a short descriptive alt attribute, or alt=\"\" for purely decorative images.")
def _alt(site):
    out = []
    for p in _html(site):
        if p.images:
            missing = [i["src"] for i in p.images if i["alt"] is None]
            out.append(Outcome("image_alt", p.url, not missing, f"{len(missing)} of {len(p.images)} images missing alt" if missing else ""))
    return out


# ------------------------------------------------------------------ content
def _dupes(site, attr: str, check_id: str) -> list[Outcome]:
    groups = defaultdict(list)
    for p in _html(site):
        v = getattr(p, attr).strip().lower()
        if v:
            groups[v].append(p)
    return [Outcome(check_id, p.url, len(g) == 1, "" if len(g) == 1 else f"Shared with {len(g) - 1} other page(s), e.g. {next(o.url for o in g if o is not p)}")
            for g in groups.values() for p in g]


@check("title_unique", "Title is unique", "content", "warning",
       "Another crawled page uses exactly the same title.",
       "Duplicate titles make pages indistinguishable in results and compete with each other.",
       "Give every page a title that reflects its specific content.")
def _title_unique(site):
    return _dupes(site, "title", "title_unique")


@check("description_unique", "Meta description is unique", "content", "warning",
       "Another crawled page uses exactly the same meta description.",
       "Duplicate descriptions waste snippet space and suggest templated or thin content.",
       "Write a distinct description for each page.")
def _desc_unique(site):
    return _dupes(site, "description", "description_unique")


@check("thin_content", "Page has substantial content", "content", "info",
       "The page has fewer than 300 words of visible text.",
       "Very short pages rarely satisfy search intent on informational queries. (Contact or utility pages can legitimately be short.)",
       "Expand the page with genuinely useful information, or consider consolidating it.")
def _thin(site):
    return [Outcome("thin_content", p.url, p.word_count >= 300, f"{p.word_count} words") for p in _html(site)]


@check("duplicate_content", "Content is not duplicated", "content", "warning",
       "Another crawled page has identical body text.",
       "Duplicate pages split ranking signals and can cause the wrong URL to rank.",
       "Consolidate the pages with a 301 redirect or point a canonical tag at the preferred one.")
def _dup_content(site):
    groups = defaultdict(list)
    for p in _html(site):
        if p.content_hash:
            groups[p.content_hash].append(p)
    return [Outcome("duplicate_content", p.url, len(g) == 1, "" if len(g) == 1 else f"Identical text to {next(o.url for o in g if o is not p)}")
            for g in groups.values() for p in g]


@check("open_graph", "Open Graph tags present", "content", "info",
       "The page lacks og:title and/or og:image.",
       "Open Graph tags control how links look when shared on social platforms and messaging apps.",
       "Add og:title, og:description, og:image and og:url.")
def _og(site):
    return [Outcome("open_graph", p.url, "og:title" in p.og and "og:image" in p.og,
                    f"Found: {', '.join(p.og) or 'none'}") for p in _html(site)]


@check("twitter_card", "Twitter/X card present", "content", "info",
       "The page has no twitter:card metadata.",
       "Controls the preview card when the page is shared on X/Twitter.",
       "Add <meta name=\"twitter:card\" content=\"summary_large_image\"> plus title and image.")
def _tw(site):
    return [Outcome("twitter_card", p.url, "twitter:card" in p.twitter) for p in _html(site)]


@check("html_lang", "HTML lang attribute set", "content", "info",
       "The <html> element has no lang attribute.",
       "The lang attribute helps browsers, screen readers and search engines pick the right language handling.",
       "Add lang=\"en\" (or the correct language code) to the <html> tag.")
def _lang(site):
    return [Outcome("html_lang", p.url, bool(p.lang)) for p in _html(site)]


# ------------------------------------------------------------------ linking
@check("broken_internal_links", "No broken internal links", "linking", "critical",
       "The page links to internal URLs that returned an error when crawled.",
       "Broken internal links lead visitors and crawlers to dead ends and waste link equity.",
       "Update or remove the links, or restore/redirect the missing pages.")
def _broken_int(site):
    status = {}
    for p in site.pages:
        for u in (p.url, p.final_url):
            status[normalize(u)] = p.status if p.status is not None else 0
    out = []
    for p in _html(site):
        if not p.internal_links:
            continue
        bad = [f"{u} ({status[normalize(u)] or 'unreachable'})" for u in p.internal_links
               if normalize(u) in status and (status[normalize(u)] == 0 or status[normalize(u)] >= 400)]
        out.append(Outcome("broken_internal_links", p.url, not bad, "; ".join(bad[:5])))
    return out


@check("broken_external_links", "No broken external links", "linking", "warning",
       "The page links to external URLs that returned an error status (a bounded sample of external links is checked).",
       "Dead outbound links reduce trust and user experience.",
       "Replace or remove the links.")
def _broken_ext(site):
    out = []
    for p in _html(site):
        checked = [(u, site.external_status[u]) for u in p.external_links if u in site.external_status]
        if checked:
            bad = [f"{u} ({s})" for u, s in checked if s is not None and s >= 400]
            out.append(Outcome("broken_external_links", p.url, not bad, "; ".join(bad[:5])))
    return out


@check("internal_links_present", "Page links to other pages", "linking", "warning",
       "The page contains no internal links.",
       "Pages with no outgoing internal links are dead ends for users and crawlers and pass no authority on.",
       "Link to related pages, services or a clear next step.")
def _int_links(site):
    return [Outcome("internal_links_present", p.url, bool(p.internal_links)) for p in _html(site)]


# --------------------------------------------------------------- structured
@check("jsonld_valid", "Structured data is valid JSON", "structured", "warning",
       "A JSON-LD block on the page could not be parsed.",
       "Invalid JSON-LD is ignored by search engines, so any rich-result eligibility is lost.",
       "Validate the markup (for example with Google's Rich Results Test) and fix the syntax error.")
def _jsonld(site):
    return [Outcome("jsonld_valid", p.url, p.schema_parse_errors == 0, f"{p.schema_parse_errors} of {p.schema_blocks} blocks invalid")
            for p in _html(site) if p.schema_blocks]


@check("schema_required_props", "Structured data has required properties", "structured", "warning",
       "A detected schema.org type is missing a property that its rich result requires.",
       "Incomplete markup may be ignored or flagged in Search Console.",
       "Add the missing properties listed in the evidence.")
def _schema_props(site):
    return [Outcome("schema_required_props", p.url, not p.schema_issues, "; ".join(p.schema_issues[:5]))
            for p in _html(site) if p.schema_types]


@check("schema_present_home", "Home page declares organisation/website schema", "structured", "info",
       "No Organization, LocalBusiness, ProfessionalService or WebSite markup was detected on the home page.",
       "This is an opportunity rather than an error: such markup helps search engines understand who runs the site.",
       "Add Organization (or LocalBusiness / ProfessionalService) JSON-LD to the home page.")
def _schema_home(site):
    home = site.pages[0] if site.pages and site.pages[0].ok else None
    if not home:
        return []
    wanted = {"Organization", "LocalBusiness", "ProfessionalService", "WebSite"}
    return [Outcome("schema_present_home", home.url, bool(wanted & set(home.schema_types)), f"Types found: {', '.join(home.schema_types) or 'none'}")]


def run_checks(site: CrawlResult) -> list[Outcome]:
    outcomes: list[Outcome] = []
    for fn in _FUNCS:
        outcomes.extend(fn(site))
    return outcomes
