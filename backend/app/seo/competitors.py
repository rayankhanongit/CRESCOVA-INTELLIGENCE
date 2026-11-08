"""Observed, public-page facts for competitor comparison. Everything here is counted from pages we could fetch.
We have no access to competitors' analytics, backlinks or rankings, and nothing here claims to."""
import re
from collections import Counter

STOP = {"the", "and", "for", "with", "our", "you", "your", "are", "from", "this", "that", "have", "will", "about", "home", "page", "services",
        "service", "best", "new", "all", "more", "how", "what", "why", "can", "get", "who", "welcome", "contact", "blog"}


def _terms(rows: list[dict]) -> Counter:
    c: Counter = Counter()
    for r in rows:
        text = " ".join([r["title"], *r["h1s"], *[h[1] for h in r["headings"] if h[0] == 2]]).lower()
        c.update({t for t in re.findall(r"[a-z]{3,}", text) if t not in STOP})  # once per page, so one long page can't dominate
    return c


def summarise(rows: list[dict], site: dict) -> dict:
    """rows: [{ok, url, title, description, h1s, headings, word_count, schema_types}]; site: {https, robots, sitemap}."""
    ok = [r for r in rows if r["ok"]]
    n = len(ok) or 1
    pct = lambda pred: round(100 * sum(1 for r in ok if pred(r)) / n, 1)  # noqa: E731
    schema = Counter(t for r in ok for t in set(r["schema_types"]))
    return {
        "pages_analysed": len(ok), "avg_word_count": round(sum(r["word_count"] for r in ok) / n) if ok else 0,
        "pct_with_title": pct(lambda r: bool(r["title"])), "pct_with_description": pct(lambda r: bool(r["description"])),
        "pct_with_h1": pct(lambda r: bool(r["h1s"])), "pct_with_schema": pct(lambda r: bool(r["schema_types"])),
        "schema_types": dict(schema.most_common(10)), "site": site,
        "sample_titles": [r["title"] for r in ok if r["title"]][:10],
        "top_terms": [t for t, _ in _terms(ok).most_common(30)],
    }


def gaps(own_terms: list[str], competitor_terms: list[str], limit: int = 15) -> list[str]:
    """Words competitors use in titles and headings that your own analysed pages don't."""
    mine = set(own_terms)
    return [t for t in competitor_terms if t not in mine][:limit]


def rows_from_records(records) -> list[dict]:
    return [{"ok": p.ok, "url": p.url, "title": p.title, "description": p.description, "h1s": p.h1s, "headings": p.headings,
             "word_count": p.word_count, "schema_types": p.schema_types} for p in records]


def rows_from_pages(pages) -> list[dict]:
    """From stored WebsitePage rows of one of your own audits."""
    return [{"ok": p.status_code is not None and 200 <= p.status_code < 300 and bool(p.title or p.word_count), "url": p.url, "title": p.title,
             "description": p.meta_description, "h1s": (p.data or {}).get("h1s", []), "headings": (p.data or {}).get("headings", []),
             "word_count": p.word_count, "schema_types": (p.data or {}).get("schema_types", [])} for p in pages]
