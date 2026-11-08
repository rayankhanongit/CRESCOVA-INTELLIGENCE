"""AI interpretation of deterministic findings. The AI is given stored findings and may only comment on them:
check ids it returns that were not supplied are discarded, and nothing here ever edits a website."""
from collections import defaultdict
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from ..ai.service import run_ai, untrusted
from ..db import get_db
from ..models import SeoFinding, SeoRecommendation, User, Website, WebsitePage
from ..schemas import ORM
from ..security import current_user
from ..seo.checks import CHECKS
from .audits import owned_audit
from .common import owned

router = APIRouter(prefix="/api", tags=["ai-recommendations"])
MAX_GROUPS = 12


class RecOut(ORM):
    id: int
    audit_id: int
    check_id: str
    check_name: str = ""
    severity: str = ""
    interpretation: str
    recommendation: str
    example: str
    status: str
    provider: str
    model: str


class RecStatus(BaseModel):
    status: Literal["suggested", "accepted", "dismissed"]


def _out(r: SeoRecommendation) -> RecOut:
    c = CHECKS.get(r.check_id)
    return RecOut.model_validate(r).model_copy(update={"check_name": c.name if c else r.check_id, "severity": c.severity if c else ""})


def _context(site: Website | None) -> str:
    if not site:
        return "unknown"
    return untrusted(f"{site.name}; category: {site.category}; market: {site.market}; audience: {site.target_audience}", 400)


@router.get("/audits/{audit_id}/recommendations", response_model=list[RecOut])
def list_recommendations(audit_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    owned_audit(db, user, audit_id)
    rows = db.scalars(select(SeoRecommendation).where(SeoRecommendation.audit_id == audit_id).order_by(SeoRecommendation.id))
    return sorted((_out(r) for r in rows), key=lambda r: ({"critical": 0, "warning": 1, "info": 2}.get(r.severity, 3), r.check_id))


@router.post("/audits/{audit_id}/recommendations", response_model=list[RecOut], status_code=201)
def generate_recommendations(audit_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    audit = owned_audit(db, user, audit_id)
    if audit.status != "completed":
        raise HTTPException(409, "The audit is not complete yet")
    reviewed = set(db.scalars(select(SeoRecommendation.check_id).where(SeoRecommendation.audit_id == audit_id, SeoRecommendation.status != "suggested")))
    groups: dict[str, list[SeoFinding]] = defaultdict(list)
    for f in db.scalars(select(SeoFinding).where(SeoFinding.audit_id == audit_id, SeoFinding.severity != "info").order_by(SeoFinding.id)):
        if f.check_id not in reviewed:
            groups[f.check_id].append(f)
    if not groups:
        raise HTTPException(409, "There are no critical issues or warnings left to interpret")
    chosen = sorted(groups.items(), key=lambda kv: (CHECKS[kv[0]].severity != "critical", -len(kv[1])))[:MAX_GROUPS]
    findings = [{"check_id": cid, "name": CHECKS[cid].name, "severity": CHECKS[cid].severity, "affected_pages": len(fs),
                 "what_was_detected": CHECKS[cid].explanation,
                 "examples": [{"url": f.url, "evidence": untrusted(f.evidence, 300)} for f in fs[:3]]} for cid, fs in chosen]
    site = db.get(Website, audit.website_id)
    prompt = (
        f"Website context: {_context(site)}\n\nThese are verified findings from a deterministic SEO crawler (facts, not guesses):\n{findings}\n\n"
        "For each finding, write a short plain-English interpretation of what it means for this site, a concrete recommended fix, and where useful a short example "
        '(for instance a rewritten title). Reply as JSON: {"recommendations":[{"check_id":"...","interpretation":"...","recommendation":"...","example":"..."}]}. '
        "Use only the check_ids listed. Do not add new findings."
    )
    res, data = run_ai(db, user, "seo_recommendations", prompt, json_mode=True)
    allowed = {cid for cid, _ in chosen}
    items = data.get("recommendations", []) if isinstance(data, dict) else []
    db.execute(delete(SeoRecommendation).where(SeoRecommendation.audit_id == audit_id, SeoRecommendation.status == "suggested"))
    seen: set[str] = set()
    for it in items:
        cid = it.get("check_id") if isinstance(it, dict) else None
        if cid not in allowed or cid in seen or not it.get("recommendation"):  # drop anything about checks we didn't supply
            continue
        seen.add(cid)
        db.add(SeoRecommendation(organisation_id=user.organisation_id, audit_id=audit_id, check_id=cid, interpretation=str(it.get("interpretation", ""))[:3000],
                                 recommendation=str(it["recommendation"])[:3000], example=str(it.get("example", "") or "")[:2000], provider=res.provider, model=res.model))
    db.commit()
    return list_recommendations(audit_id, user, db)


@router.patch("/recommendations/{rec_id}", response_model=RecOut)
def review(rec_id: int, body: RecStatus, user: User = Depends(current_user), db: Session = Depends(get_db)):
    rec = owned(db, user, SeoRecommendation, rec_id)
    rec.status = body.status
    db.commit()
    return _out(rec)


@router.post("/pages/{page_id}/ai-rewrite")
def rewrite_page(page_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Suggested replacement title and meta description for one crawled page. Returned for review; nothing is stored or applied."""
    page = db.get(WebsitePage, page_id)
    if not page:
        raise HTTPException(404, "Page not found")
    audit = owned_audit(db, user, page.audit_id)
    site = db.get(Website, audit.website_id)
    d = page.data or {}
    prompt = (
        f"Website context: {_context(site)}\nPage URL: {untrusted(page.url, 300)}\nCurrent title: {untrusted(page.title, 300)}\n"
        f"Current meta description: {untrusted(page.meta_description, 400)}\nH1: {untrusted(' | '.join(d.get('h1s', [])), 300)}\n"
        f"Main headings: {untrusted(' | '.join(h[1] for h in d.get('headings', [])[:10]), 600)}\n\n"
        'Suggest an improved SEO title (30-60 characters) and meta description (70-160 characters) that stay truthful to the page. '
        'Reply as JSON: {"title":"...","meta_description":"...","reasoning":"..."}.'
    )
    res, data = run_ai(db, user, "page_rewrite", prompt, json_mode=True)
    data = data if isinstance(data, dict) else {}
    return {"title": str(data.get("title", ""))[:200], "meta_description": str(data.get("meta_description", ""))[:400], "reasoning": str(data.get("reasoning", ""))[:1000],
            "provider": res.provider, "model": res.model, "ai_generated": True}
