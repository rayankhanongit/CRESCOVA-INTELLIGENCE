import asyncio

from app.config import DEFAULT_CATEGORY_WEIGHTS
from app.seo.checks import CHECKS, Outcome, run_checks
from app.seo.crawler import CrawlConfig, crawl, normalize
from app.seo.scoring import compute_scores, page_score

from fakesite import FakeFetcher, good_site, page


def run(site, start="https://example.com/", **cfg):
    f = FakeFetcher(site)
    result = asyncio.run(crawl(start, CrawlConfig(delay=0, **cfg), f))
    return result, f


def failed(result):
    return {(o.check_id, o.url) for o in run_checks(result) if not o.passed}


def test_crawls_discovers_links_and_robots_sitemap():
    r, _ = run(good_site())
    assert {p.url for p in r.pages} == {"https://example.com/", "https://example.com/about", "https://example.com/missing"}
    assert r.robots.present and r.sitemap.found and r.sitemap.url_count == 2


def test_respects_robots_disallow():
    site = good_site()
    site["https://example.com/"] = (200, page(body='<a href="/private/secret">x</a>').replace("CANON", "https://example.com/"), "text/html")
    site["https://example.com/private/secret"] = (200, page(), "text/html")
    r, f = run(site)
    assert "https://example.com/private/secret" in r.skipped_by_robots
    assert ("GET", "https://example.com/private/secret") not in f.log


def test_max_pages_and_depth_limits_and_no_loops():
    site = good_site()
    for i in range(30):  # a chain/loop-prone site
        site[f"https://example.com/p{i}"] = (200, page(title=f"P{i} title long enough here ok", body=f'<a href="/p{i + 1}">n</a><a href="/">h</a>').replace("CANON", f"https://example.com/p{i}"), "text/html")
    site["https://example.com/"] = (200, page(body='<a href="/p0">s</a>').replace("CANON", "https://example.com/"), "text/html")
    r, _ = run(site, max_pages=5, max_depth=10)
    assert len(r.pages) == 5 and r.truncated
    r2, _ = run(site, max_pages=50, max_depth=2)
    assert max(p.depth for p in r2.pages) <= 2


def test_single_url_mode_fetches_only_that_page():
    r, f = run(good_site(), start="https://example.com/about", single_url=True, max_pages=1)
    assert [p.url for p in r.pages] == ["https://example.com/about"]


def test_tracking_params_and_fragments_deduped():
    assert normalize("https://Example.com/a?utm_source=x&id=2#top") == "https://example.com/a?id=2"


def test_detects_broken_internal_link_and_missing_basics():
    site = good_site()
    site["https://example.com/about"] = (200, "<html><head></head><body><h1>A</h1><h1>B</h1><img src='/x.png'></body></html>", "text/html")
    r, _ = run(site)
    f = failed(r)
    assert ("broken_internal_links", "https://example.com/") in f
    assert ("http_status", "https://example.com/missing") in f
    about = "https://example.com/about"
    for cid in ("title_present", "description_present", "h1_single", "image_alt", "viewport", "canonical_present"):
        assert (cid, about) in f, cid


def test_redirect_chain_and_https():
    site = good_site()
    site["https://example.com/a"] = ("redirect", "/b")
    site["https://example.com/b"] = ("redirect", "/about")
    site["https://example.com/"] = (200, page(body='<a href="/a">a</a>').replace("CANON", "https://example.com/"), "text/html")
    r, _ = run(site)
    assert ("redirect_chain", "https://example.com/a") in failed(r)
    http_site = {k.replace("https://", "http://"): v for k, v in good_site().items()}
    r2, _ = run(http_site, start="http://example.com/")
    assert any(c == "https_site" for c, _u in failed(r2))


def test_duplicate_titles_and_content():
    site = good_site()
    dup = page(title="Same title for both pages here", body='<a href="/b">b</a>').replace("CANON", "x")
    site["https://example.com/"] = (200, page(body='<a href="/a">a</a><a href="/b">b</a>').replace("CANON", "https://example.com/"), "text/html")
    site["https://example.com/a"] = (200, dup, "text/html")
    site["https://example.com/b"] = (200, dup, "text/html")
    f = failed(run(site)[0])
    assert ("title_unique", "https://example.com/a") in f and ("duplicate_content", "https://example.com/b") in f


def test_structured_data_only_flags_detectable_errors():
    site = good_site()
    bad = '<script type="application/ld+json">{"@type":"LocalBusiness","name":"X"}</script><script type="application/ld+json">{oops</script>'
    site["https://example.com/about"] = (200, page(extra_head=bad).replace("CANON", "https://example.com/about"), "text/html")
    r, _ = run(site)
    f = failed(r)
    assert ("schema_required_props", "https://example.com/about") in f  # LocalBusiness lacks address
    assert ("jsonld_valid", "https://example.com/about") in f
    assert ("schema_required_props", "https://example.com/") not in f  # valid Organization on the home page
    # no markup at all is never an "error"-severity finding
    assert CHECKS["schema_present_home"].severity == "info"


def test_noindex_and_canonical_elsewhere():
    site = good_site()
    site["https://example.com/about"] = (200, page(extra_head='<meta name="robots" content="noindex">').replace("CANON", "https://example.com/other"), "text/html")
    f = failed(run(site)[0])
    assert ("noindex", "https://example.com/about") in f and ("canonical_self", "https://example.com/about") in f


def test_robots_blocking_site_is_critical():
    site = good_site()
    site["https://example.com/robots.txt"] = (200, "User-agent: *\nDisallow: /", "text/plain")
    r, _ = run(site)
    assert ("robots_blocks_site", "https://example.com/") in failed(r)
    assert r.pages == []  # and we obeyed it


def test_sitemap_xxe_is_not_expanded():
    site = good_site()
    site["https://example.com/sitemap.xml"] = (200, '<?xml version="1.0"?><!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>&e;</loc></url></urlset>', "application/xml")
    r, _ = run(site)
    assert all("passwd" not in u for u in r.sitemap.urls)


def test_slow_external_hosts_cannot_stall_the_crawl(monkeypatch):
    from app.seo import crawler

    class Hanging(FakeFetcher):
        async def fetch(self, url, method="GET"):
            if "slow.example.org" in url:
                await asyncio.sleep(30)
            return await super().fetch(url, method)

    site = good_site()
    site["https://example.com/"] = (200, page(body="".join(f'<a href="https://slow.example.org/{i}">x</a>' for i in range(8))).replace("CANON", "https://example.com/"), "text/html")
    monkeypatch.setattr(crawler, "LINK_CHECK_TIMEOUT", 0.2)
    import time
    t = time.monotonic()
    result = asyncio.run(crawl("https://example.com/", CrawlConfig(delay=0), Hanging(site)))
    assert time.monotonic() - t < 5
    assert all(v is None for v in result.external_status.values())  # unknown, so never reported as broken
    assert not any(c == "broken_external_links" and not o for c, o in [(o.check_id, o.passed) for o in run_checks(result)])


# ---- scoring ----------------------------------------------------------------
def test_perfect_outcomes_score_100():
    outs = [Outcome("title_present", "u", True), Outcome("https_site", "u", True), Outcome("sitemap", "u", True)]
    res = compute_scores(outs, DEFAULT_CATEGORY_WEIGHTS)
    assert res.overall == 100.0 and res.categories["onpage"] == 100.0 and res.categories["linking"] is None


def test_scoring_is_weighted_and_transparent():
    # onpage: critical title (w3) 1/2 pass, warning h1 (w2) 2/2 pass -> (3*.5 + 2*1)/5 = 70
    outs = [Outcome("title_present", "a", True), Outcome("title_present", "b", False), Outcome("h1_present", "a", True), Outcome("h1_present", "b", True)]
    res = compute_scores(outs, DEFAULT_CATEGORY_WEIGHTS)
    assert res.categories["onpage"] == 70.0 and res.overall == 70.0  # only one category has data -> renormalised


def test_weights_are_configurable():
    outs = [Outcome("title_present", "a", False), Outcome("https_site", "a", True)]
    default = compute_scores(outs, DEFAULT_CATEGORY_WEIGHTS).overall
    heavy_tech = compute_scores(outs, {**DEFAULT_CATEGORY_WEIGHTS, "technical": 90}).overall
    assert heavy_tech > default


def test_page_score():
    assert page_score([Outcome("title_present", "u", True), Outcome("h1_present", "u", False)]) == 60.0  # 3/(3+2)
    assert page_score([]) is None


def test_every_check_has_valid_metadata():
    from app.seo.checks import CATEGORIES
    for c in CHECKS.values():
        assert c.category in CATEGORIES and c.severity in ("critical", "warning", "info")
        assert all([c.name, c.explanation, c.why, c.fix])
    assert set(DEFAULT_CATEGORY_WEIGHTS) == set(CATEGORIES) and sum(DEFAULT_CATEGORY_WEIGHTS.values()) == 100
