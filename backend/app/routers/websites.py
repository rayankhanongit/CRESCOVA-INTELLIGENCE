from urllib.parse import urlsplit

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..db import get_db
from ..models import SeoAudit, User, Website
from ..schemas import AuditIn, AuditOut, WebsiteIn, WebsiteOut, WebsiteUpdate
from ..security import audit_log, current_user
from ..seo.crawler import same_site
from ..seo.runner import run_audit
from ..seo.ssrf import UnsafeURL, validate_target

router = APIRouter(prefix="/api/websites", tags=["websites"])


def get_owned_website(db: Session, user: User, website_id: int) -> Website:
    site = db.get(Website, website_id)
    if not site or site.organisation_id != user.organisation_id:  # 404, never reveal other tenants' ids
        raise HTTPException(404, "Website not found")
    return site


def _validated(url: str) -> str:
    try:
        return validate_target(url)
    except UnsafeURL as exc:
        raise HTTPException(422, f"URL rejected: {exc}") from None


@router.get("", response_model=list[WebsiteOut])
def list_websites(user: User = Depends(current_user), db: Session = Depends(get_db)):
    return db.scalars(select(Website).where(Website.organisation_id == user.organisation_id).order_by(Website.name)).all()


@router.post("", response_model=WebsiteOut, status_code=201)
def create_website(body: WebsiteIn, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    url = _validated(body.url)
    if db.scalar(select(Website).where(Website.organisation_id == user.organisation_id, Website.url == url)):
        raise HTTPException(409, "This website has already been added")
    site = Website(organisation_id=user.organisation_id, **body.model_dump(exclude={"url"}), url=url)
    db.add(site)
    db.commit()
    audit_log(db, request, user, "website_created", url)
    return site


@router.get("/{website_id}", response_model=WebsiteOut)
def get_website(website_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return get_owned_website(db, user, website_id)


@router.patch("/{website_id}", response_model=WebsiteOut)
def update_website(website_id: int, body: WebsiteUpdate, user: User = Depends(current_user), db: Session = Depends(get_db)):
    site = get_owned_website(db, user, website_id)
    for k, v in body.model_dump(exclude_unset=True).items():
        if v is not None:
            setattr(site, k, v)
    db.commit()
    return site


@router.delete("/{website_id}", status_code=204)
def delete_website(website_id: int, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    site = get_owned_website(db, user, website_id)
    db.delete(site)
    db.commit()
    audit_log(db, request, user, "website_deleted", site.url)


@router.get("/{website_id}/audits", response_model=list[AuditOut])
def list_audits(website_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    get_owned_website(db, user, website_id)
    return db.scalars(select(SeoAudit).where(SeoAudit.website_id == website_id).order_by(SeoAudit.created_at.desc(), SeoAudit.id.desc())).all()


@router.post("/{website_id}/audits", response_model=AuditOut, status_code=202)
def start_audit(website_id: int, body: AuditIn, request: Request, background: BackgroundTasks,
                user: User = Depends(current_user), db: Session = Depends(get_db)):
    settings = get_settings()
    site = get_owned_website(db, user, website_id)
    active = db.scalar(select(func.count()).select_from(SeoAudit).where(
        SeoAudit.organisation_id == user.organisation_id, SeoAudit.status.in_(["queued", "running"])))
    if active >= settings.max_concurrent_audits_per_org:
        raise HTTPException(429, "Too many audits are already running. Wait for one to finish.")
    target = site.url
    if body.mode == "url":
        if not body.url:
            raise HTTPException(422, "A URL is required for a single-page audit")
        target = _validated(body.url)
        if not same_site(target, urlsplit(site.url).hostname or ""):
            raise HTTPException(422, "The URL must belong to this website")
    audit = SeoAudit(
        organisation_id=user.organisation_id, website_id=site.id, mode=body.mode, target_url=target,
        max_pages=1 if body.mode == "url" else min(body.max_pages, settings.crawl_max_pages_limit),
        max_depth=0 if body.mode == "url" else min(body.max_depth, settings.crawl_max_depth_limit),
    )
    db.add(audit)
    db.commit()
    audit_log(db, request, user, "audit_started", f"{site.url} ({body.mode})")
    background.add_task(run_audit, audit.id, request.app.state.fetcher_factory)
    return audit
