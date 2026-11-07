from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import SeoAudit, SeoFinding, User, Website, WebsitePage
from ..schemas import AuditDetail, AuditOut, FindingOut, PageDetail, PageRow
from ..security import audit_log, current_user
from ..seo.checks import CATEGORIES, CHECKS
from ..seo.report import audit_pdf, findings_csv

router = APIRouter(prefix="/api", tags=["audits"])


def owned_audit(db: Session, user: User, audit_id: int) -> SeoAudit:
    a = db.get(SeoAudit, audit_id)
    if not a or a.organisation_id != user.organisation_id:
        raise HTTPException(404, "Audit not found")
    return a


def _findings(db: Session, audit_id: int, severity: str | None = None, category: str | None = None) -> list[SeoFinding]:
    q = select(SeoFinding).where(SeoFinding.audit_id == audit_id)
    if severity:
        q = q.where(SeoFinding.severity == severity)
    if category:
        q = q.where(SeoFinding.category == category)
    return list(db.scalars(q.order_by(SeoFinding.id)))


@router.get("/meta/checks")
def check_catalogue(user: User = Depends(current_user)):
    """The full list of checks and categories, so the UI can explain exactly how scoring works."""
    return {"categories": CATEGORIES, "checks": [c.__dict__ for c in CHECKS.values()],
            "severity_weights": {"critical": 3, "warning": 2, "info": 1}}


@router.get("/audits")
def list_all_audits(limit: int = Query(100, ge=1, le=500), user: User = Depends(current_user), db: Session = Depends(get_db)):
    rows = db.execute(
        select(SeoAudit, Website.name).join(Website, Website.id == SeoAudit.website_id)
        .where(SeoAudit.organisation_id == user.organisation_id).order_by(SeoAudit.created_at.desc(), SeoAudit.id.desc()).limit(limit)).all()
    return [{**AuditOut.model_validate(a).model_dump(mode="json"), "website_name": name} for a, name in rows]


@router.get("/audits/compare")
def compare(base: int, target: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    a, b = owned_audit(db, user, base), owned_audit(db, user, target)
    if a.website_id != b.website_id:
        raise HTTPException(422, "Audits must belong to the same website")
    fa, fb = {f.fingerprint: f for f in _findings(db, a.id)}, {f.fingerprint: f for f in _findings(db, b.id)}
    dump = lambda keys, src: [FindingOut.model_validate(src[k]).model_dump() for k in sorted(keys)]  # noqa: E731
    cats = {c: (None if None in (a.category_scores.get(c), b.category_scores.get(c))
                else round(b.category_scores[c] - a.category_scores[c], 1)) for c in b.category_scores}
    return {
        "base_id": a.id, "target_id": b.id,
        "score_delta": None if None in (a.score, b.score) else round(b.score - a.score, 1),
        "category_deltas": cats,
        "new": dump(fb.keys() - fa.keys(), fb),
        "resolved": dump(fa.keys() - fb.keys(), fa),
        "persistent": dump(fa.keys() & fb.keys(), fb),
    }


@router.get("/audits/{audit_id}", response_model=AuditDetail)
def get_audit(audit_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return owned_audit(db, user, audit_id)


@router.delete("/audits/{audit_id}", status_code=204)
def delete_audit(audit_id: int, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    a = owned_audit(db, user, audit_id)
    if a.status in ("queued", "running"):
        raise HTTPException(409, "Wait for the audit to finish before deleting it")
    db.delete(a)
    db.commit()
    audit_log(db, request, user, "audit_deleted", str(audit_id))


@router.get("/audits/{audit_id}/findings", response_model=list[FindingOut])
def audit_findings(audit_id: int, severity: str | None = Query(None, pattern="^(critical|warning|info)$"),
                   category: str | None = Query(None, max_length=20), user: User = Depends(current_user), db: Session = Depends(get_db)):
    owned_audit(db, user, audit_id)
    order = {"critical": 0, "warning": 1, "info": 2}
    return sorted(_findings(db, audit_id, severity, category), key=lambda f: (order[f.severity], f.name, f.url))


@router.get("/audits/{audit_id}/pages", response_model=list[PageRow])
def audit_pages(audit_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    owned_audit(db, user, audit_id)
    return db.scalars(select(WebsitePage).where(WebsitePage.audit_id == audit_id).order_by(WebsitePage.id)).all()


@router.get("/pages/{page_id}", response_model=PageDetail)
def page_detail(page_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    page = db.get(WebsitePage, page_id)
    if not page:
        raise HTTPException(404, "Page not found")
    owned_audit(db, user, page.audit_id)  # ownership is enforced via the parent audit
    findings = list(db.scalars(select(SeoFinding).where(SeoFinding.page_id == page.id)))
    return PageDetail.model_validate({**{c: getattr(page, c) for c in PageDetail.model_fields if c != "findings"}, "findings": findings})


@router.get("/audits/{audit_id}/export.{fmt}")
def export_audit(audit_id: int, fmt: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    audit = owned_audit(db, user, audit_id)
    if audit.status != "completed":
        raise HTTPException(409, "Audit is not complete")
    site = db.get(Website, audit.website_id)
    findings = _findings(db, audit_id)
    safe = f"audit-{audit.id}"
    if fmt == "csv":
        return Response(findings_csv(findings), media_type="text/csv", headers={"Content-Disposition": f'attachment; filename="{safe}.csv"'})
    if fmt == "json":
        body = {"audit": AuditDetail.model_validate(audit).model_dump(mode="json"), "website": site.url,
                "findings": [FindingOut.model_validate(f).model_dump() for f in findings]}
        import json
        return Response(json.dumps(body, indent=2), media_type="application/json", headers={"Content-Disposition": f'attachment; filename="{safe}.json"'})
    if fmt == "pdf":
        return Response(audit_pdf(site, audit, findings), media_type="application/pdf", headers={"Content-Disposition": f'attachment; filename="{safe}.pdf"'})
    raise HTTPException(404, "Unknown export format (use csv, json or pdf)")
