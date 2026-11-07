"""Runs one audit end to end and persists the result. Executed as a background task."""
import asyncio
import logging
import time
from collections import defaultdict
from collections.abc import Callable

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..db import SessionLocal, utcnow
from ..models import SeoAudit, SeoFinding, Website, WebsitePage
from .checks import CHECKS, Outcome, run_checks
from .crawler import CrawlConfig, crawl
from .fetcher import Fetcher
from .scoring import compute_scores, page_score

log = logging.getLogger("crescova.audit")
MAX_AUDIT_SECONDS = 900  # hard cap so a hung host can never leave an audit "running" forever


def default_fetcher_factory() -> Fetcher:
    from .fetcher import GuardedFetcher
    return GuardedFetcher(get_settings().crawl_user_agent)


async def run_audit(audit_id: int, fetcher_factory: Callable[[], Fetcher] = default_fetcher_factory,
                    session_factory: Callable[[], Session] = lambda: SessionLocal()) -> None:
    db = session_factory()
    fetcher = None
    try:
        audit = db.get(SeoAudit, audit_id)
        if audit is None:
            return
        audit.status = "running"
        db.commit()
        settings = get_settings()
        started = time.monotonic()
        fetcher = fetcher_factory()
        cfg = CrawlConfig(max_pages=audit.max_pages, max_depth=audit.max_depth, delay=settings.crawl_delay_seconds,
                          single_url=audit.mode == "url", user_agent=settings.crawl_user_agent)
        site = await asyncio.wait_for(crawl(audit.target_url, cfg, fetcher), MAX_AUDIT_SECONDS)
        outcomes = run_checks(site)
        result = compute_scores(outcomes, settings.seo_category_weights)

        by_url: dict[str, list[Outcome]] = defaultdict(list)
        for o in outcomes:
            by_url[o.url].append(o)
        page_rows: dict[str, WebsitePage] = {}
        for p in site.pages:
            row = WebsitePage(
                audit_id=audit.id, url=p.url, final_url=p.final_url, status_code=p.status, depth=p.depth,
                title=p.title, meta_description=p.description, canonical=p.canonical, word_count=p.word_count,
                indexable=p.ok and not p.noindex, score=page_score(by_url.get(p.url, [])), response_ms=p.elapsed_ms,
                content_hash=p.content_hash, error=p.error, data=p.to_data(),
            )
            db.add(row)
            page_rows[p.url] = row
        db.flush()

        counts = {"critical": 0, "warning": 0, "info": 0}
        passed = 0
        for o in outcomes:
            if o.passed:
                passed += 1
                continue
            d = CHECKS[o.check_id]
            counts[d.severity] += 1
            page = page_rows.get(o.url)
            db.add(SeoFinding(
                audit_id=audit.id, page_id=page.id if page else None, check_id=d.id, name=d.name, severity=d.severity,
                category=d.category, url=o.url, explanation=d.explanation, why_it_matters=d.why,
                recommendation=d.fix, evidence=o.evidence, fingerprint=f"{d.id}|{o.url}",
            ))

        audit.status = "completed"
        audit.finished_at = utcnow()
        audit.duration_ms = int((time.monotonic() - started) * 1000)
        audit.pages_crawled = len(site.pages)
        audit.score = result.overall
        audit.category_scores = result.categories
        audit.weights = settings.seo_category_weights
        audit.critical_count, audit.warning_count, audit.info_count = counts["critical"], counts["warning"], counts["info"]
        audit.passed_count = passed
        audit.summary = {
            "checks": result.checks, "truncated": site.truncated, "skipped_by_robots": site.skipped_by_robots[:50],
            "robots": {"present": site.robots.present, "status": site.robots.status, "crawl_delay": site.robots.crawl_delay},
            "sitemap": {"found": site.sitemap.found, "url": site.sitemap.url, "url_count": site.sitemap.url_count},
            "external_links_checked": len(site.external_status), "images_checked": len(site.image_status),
        }
        website = db.get(Website, audit.website_id)
        if website and audit.mode == "site":  # single-URL audits don't represent the whole site's score
            website.current_score, website.last_audit_at = result.overall, audit.finished_at
        elif website:
            website.last_audit_at = audit.finished_at
        db.commit()
    except Exception:  # never leave an audit stuck in "running"
        log.exception("Audit %s failed", audit_id)
        db.rollback()
        audit = db.get(SeoAudit, audit_id)
        if audit:
            audit.status, audit.finished_at = "failed", utcnow()
            audit.error = "The audit failed unexpectedly. Check the server log for details."
            db.commit()
    finally:
        if fetcher is not None:
            await fetcher.close()
        db.close()


def fail_stale_audits(db: Session) -> None:
    for a in db.scalars(select(SeoAudit).where(SeoAudit.status.in_(["queued", "running"]))):
        a.status, a.error, a.finished_at = "failed", "Interrupted by a server restart.", utcnow()
    db.commit()
