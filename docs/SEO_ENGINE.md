# SEO engine and scoring

All findings come from deterministic code in `backend/app/seo/`. No AI is involved, and no AI key is needed.

## Pipeline

```
POST /api/websites/{id}/audits  ->  SeoAudit(status=queued)  ->  background task run_audit()
  crawler.crawl()        robots.txt -> sitemap -> BFS crawl -> bounded external-link / image checks
  parse.parse_page()     HTML -> PageRecord (title, meta, headings, links, images, JSON-LD, ...)
  checks.run_checks()    every registered check -> list[Outcome(check_id, url, passed, evidence)]
  scoring.compute_scores()  outcomes -> category + overall score
  persist                WebsitePage rows, SeoFinding rows (failed outcomes), audit totals
```

## Crawler behaviour

| Behaviour | Detail |
|---|---|
| Scope | Same site only (`www.` and bare host are treated as the same site). Whole-site or single URL |
| Limits | `max_pages` (≤ `CRAWL_MAX_PAGES_LIMIT`), `max_depth` (≤ `CRAWL_MAX_DEPTH_LIMIT`), 10 s request timeout, 2 MB body cap, 5 redirects, 15-minute audit cap |
| robots.txt | Fetched first; disallowed URLs are never requested and are listed in the audit summary. `Crawl-delay` is honoured (capped at 10 s); default delay 0.5 s |
| Sitemap | `Sitemap:` entries from robots.txt, else `/sitemap.xml`; one level of sitemap index; pages found only in the sitemap are crawled after link discovery |
| Loops | URLs are normalised (fragment and `utm_*`/`fbclid`/`gclid` removed) and de-duplicated; binary/asset extensions are not crawled |
| External links / images | Up to 30 external links and 50 images are checked with `HEAD` (falling back to `GET` on 403/405/501), 4 at a time, 6 s each, 40 s total. Timeouts and blocked targets are "unknown", never reported as broken |
| Not done | No authentication, no CAPTCHA handling, no JavaScript rendering |

## Checks (33)

Severity: **critical** (weight 3), **warning** (2), **info / opportunity** (1).

| Category | Checks |
|---|---|
| Technical | https_site, http_status, redirect_chain, response_time, viewport, broken_images |
| Indexability | robots_txt, robots_blocks_site, sitemap, noindex, canonical_present, canonical_self |
| On-page | title_present, title_length, description_present, description_length, h1_present, h1_single, heading_hierarchy, image_alt |
| Content & metadata | title_unique, description_unique, thin_content, duplicate_content, open_graph, twitter_card, html_lang |
| Internal linking | broken_internal_links, broken_external_links, internal_links_present |
| Structured data | jsonld_valid, schema_required_props, schema_present_home |

The authoritative list with explanations, "why it matters" text and fixes is `GET /api/meta/checks`.

Structured data: only JSON-LD is parsed. Errors are reported only when detectable (unparseable JSON, or a recognised type missing a required property such as `LocalBusiness.address`). Absence of schema is never an error; it is an *opportunity* on the home page only.

Thresholds are heuristics (title 30–60 characters, description 70–160, thin content < 300 words, slow response > 3 s). They are rules of thumb, not Google requirements.

## Scoring

```
check score     = passed outcomes / applicable outcomes
category score  = Σ(severity_weight × check score) / Σ(severity_weight) × 100      (checks with outcomes only)
overall score   = Σ(category_weight × category score) / Σ(category_weight)         (categories with data only)
page score      = Σ(severity_weight × passed) / Σ(severity_weight)  over that page's outcomes
```

Default category weights: Technical 25, On-page 25, Content 20, Indexability 15, Linking 10, Structured 5. Override with `SEO_CATEGORY_WEIGHTS` (JSON, keys as above). The weights used are stored with each audit so history stays interpretable.

A category with no applicable checks is shown as *n/a* and the remaining weights are re-balanced.

**The SEO Health Score is Crescova's own diagnostic metric. It is not a Google ranking factor and does not predict rankings.** Because scores are pass-rates, a single broken page on a large site moves the score only slightly; use the findings list, not the score alone.

## Comparing audits

Findings are fingerprinted as `check_id|url`. Comparison classifies each fingerprint as new (only in the later audit), resolved (only in the earlier), or persistent (in both), and reports score and per-category deltas. Compare audits of the same scope: a single-page audit has few fingerprints and will make most issues look "resolved".

## Adding a check

Add a function in `checks.py` decorated with `@check(id, name, category, severity, explanation, why, fix)` that returns `list[Outcome]`. Add a test in `tests/test_seo_engine.py`. The score, UI and exports pick it up automatically.
