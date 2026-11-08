import asyncio
import logging
from collections.abc import Callable
from datetime import datetime

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..ai.service import run_ai, untrusted
from ..config import get_settings
from ..db import SessionLocal, get_db, utcnow
from ..models import Competitor, SeoAudit, User, Website, WebsitePage
from ..schemas import ORM
from ..security import audit_log, current_user
from ..seo.competitors import gaps, rows_from_pages, rows_from_records, summarise
from ..seo.crawler import CrawlConfig, crawl
from ..seo.fetcher import Fetcher
from ..seo.runner import default_fetcher_factory
from ..seo.ssrf import UnsafeURL, validate_target
from .common import owned
from .websites import get_owned_website

router = APIRouter(prefix="/api", tags=["competitors"])
log = logging.getLogger("crescova.competitors")
MAX_PAGES, MAX_DEPTH, MAX_SECONDS = 10, 2, 300


class CompetitorIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    url: str = Field(min_length=3, max_length=2048)


class CompetitorOut(ORM):
    id: int
    website_id: int
    name: str
    url: str
    status: str
    last_analysed_at: datetime | None
    analysis: dict | None
    insights: dict | None
    error: str | None


async def run_competitor(comp_id: int, fetcher_factory: Callable[[], Fetcher] = default_fetcher_factory, session_factory: Callable[[], Session] = lambda: SessionLocal()) -> None:
    db = session_factory()
    fetcher = None
    try:
        comp = db.get(Competitor, comp_id)
        if comp is None:
            return
        comp.status = "running"
        db.commit()
        s = get_settings()
        fetcher = fetcher_factory()
        cfg = CrawlConfig(max_pages=MAX_PAGES, max_depth=MAX_DEPTH, delay=s.crawl_delay_seconds, user_agent=s.crawl_user_agent)
        site = await asyncio.wait_for(crawl(comp.url, cfg, fetcher), MAX_SECONDS)
        meta = {"https": site.start_url.startswith("https://"), "robots": site.robots.present, "sitemap": site.sitemap.found, "sitemap_urls": site.sitemap.url_count,
                "blocked_by_robots": site.robots.blocks_start}
        comp.analysis = summarise(rows_from_records(site.pages), meta)
        comp.insights, comp.error = None, ("robots.txt disallows crawling this site, so nothing was fetched." if site.robots.blocks_start else None)
        comp.status, comp.last_analysed_at = "done", utcnow()
        db.commit()
    except Exception:
        log.exception("Competitor analysis %s failed", comp_id)
        db.rollback()
        comp = db.get(Competitor, comp_id)
        if comp:
            comp.status, comp.error = "failed", "The analysis failed unexpectedly. Check the server log for details."
            db.commit()
    finally:
        if fetcher is not None:
            await fetcher.close()
        db.close()


def fail_stale_competitors(db: Session) -> None:
    for c in db.scalars(select(Competitor).where(Competitor.status == "running")):
        c.status, c.error = "failed", "Interrupted by a server restart."
    db.commit()


@router.get("/websites/{website_id}/competitors", response_model=list[CompetitorOut])
def list_competitors(website_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    get_owned_website(db, user, website_id)
    return db.scalars(select(Competitor).where(Competitor.website_id == website_id).order_by(Competitor.name)).all()


@router.post("/websites/{website_id}/competitors", response_model=CompetitorOut, status_code=201)
def add_competitor(website_id: int, body: CompetitorIn, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    get_owned_website(db, user, website_id)
    url = body.url.strip()
    try:
        url = validate_target(url if "://" in url else f"https://{url}")
    except UnsafeURL as exc:
        raise HTTPException(422, f"URL rejected: {exc}") from None
    if db.scalar(select(Competitor.id).where(Competitor.website_id == website_id, Competitor.url == url)):
        raise HTTPException(409, "This competitor has already been added")
    comp = Competitor(organisation_id=user.organisation_id, website_id=website_id, name=body.name.strip(), url=url)
    db.add(comp)
    db.commit()
    audit_log(db, request, user, "competitor_added", url)
    return comp


@router.delete("/competitors/{competitor_id}", status_code=204)
def delete_competitor(competitor_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    db.delete(owned(db, user, Competitor, competitor_id))
    db.commit()


@router.post("/competitors/{competitor_id}/analyse", response_model=CompetitorOut, status_code=202)
def analyse(competitor_id: int, request: Request, background: BackgroundTasks, user: User = Depends(current_user), db: Session = Depends(get_db)):
    comp = owned(db, user, Competitor, competitor_id)
    running = db.scalar(select(func.count()).select_from(Competitor).where(Competitor.organisation_id == user.organisation_id, Competitor.status == "running"))
    if comp.status == "running" or running >= get_settings().max_concurrent_audits_per_org:
        raise HTTPException(429, "An analysis is already running. Wait for it to finish.")
    comp.status = "running"
    db.commit()
    background.add_task(run_competitor, comp.id, request.app.state.fetcher_factory)
    return comp


def _own(db: Session, website_id: int) -> tuple[dict | None, int | None]:
    audit = db.scalars(select(SeoAudit).where(SeoAudit.website_id == website_id, SeoAudit.status == "completed", SeoAudit.mode == "site")
                       .order_by(SeoAudit.created_at.desc(), SeoAudit.id.desc())).first()
    if not audit:
        return None, None
    pages = db.scalars(select(WebsitePage).where(WebsitePage.audit_id == audit.id)).all()
    site = db.get(Website, website_id)
    meta = {"https": site.url.startswith("https://"), "robots": bool(audit.summary.get("robots", {}).get("present")),
            "sitemap": bool(audit.summary.get("sitemap", {}).get("found")), "sitemap_urls": audit.summary.get("sitemap", {}).get("url_count", 0), "blocked_by_robots": False}
    return summarise(rows_from_pages(pages), meta), audit.id


@router.get("/websites/{website_id}/comparison")
def comparison(website_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Observed facts side by side. 'own' comes from your latest full-site audit; competitors from their last analysis."""
    site = get_owned_website(db, user, website_id)
    own, audit_id = _own(db, website_id)
    comps = db.scalars(select(Competitor).where(Competitor.website_id == website_id, Competitor.analysis.is_not(None)).order_by(Competitor.name)).all()
    return {"website": {"id": site.id, "name": site.name}, "own": own, "own_audit_id": audit_id,
            "competitors": [{"id": c.id, "name": c.name, "analysis": c.analysis, "content_gaps": gaps(own["top_terms"], c.analysis["top_terms"]) if own else []} for c in comps],
            "note": "Public page facts only. No competitor analytics, backlinks or rankings are available to this tool."}


@router.post("/competitors/{competitor_id}/insights", response_model=CompetitorOut)
def insights(competitor_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    comp = owned(db, user, Competitor, competitor_id)
    if not comp.analysis:
        raise HTTPException(409, "Analyse this competitor first")
    own, _ = _own(db, comp.website_id)
    if not own:
        raise HTTPException(409, "Run a full-site audit of your own website first, so there is something to compare")
    site = db.get(Website, comp.website_id)
    prompt = (
        f"Our website: {untrusted(f'{site.name}; category {site.category}; market {site.market}', 400)}\nObserved facts about OUR site (counted by a crawler): {own}\n"
        f"Observed facts about competitor {untrusted(comp.name, 100)} (public pages only, up to {MAX_PAGES} pages crawled): {comp.analysis}\n\n"
        "Write strategic observations for an SEO agency. Separate what is directly visible in these numbers from your own interpretation. Do not claim anything about the "
        "competitor's traffic, rankings, backlinks or private data. "
        'Reply as JSON: {"observed":["..."],"interpretation":["..."],"opportunities":["..."]}.'
    )
    res, data = run_ai(db, user, "competitor_insights", prompt, json_mode=True)
    data = data if isinstance(data, dict) else {}
    clean = lambda k: [str(x)[:500] for x in (data.get(k) or [])[:8]]  # noqa: E731
    comp.insights = {"observed": clean("observed"), "interpretation": clean("interpretation"), "opportunities": clean("opportunities"),
                     "ai_generated": True, "provider": res.provider, "model": res.model, "generated_at": utcnow().isoformat()}
    db.commit()
    return comp
