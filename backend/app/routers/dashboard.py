from collections import Counter

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..db import get_db
from ..models import SeoAudit, SeoFinding, User, Website
from ..schemas import AuditOut
from ..security import current_user

router = APIRouter(prefix="/api", tags=["dashboard"])


@router.get("/dashboard/overview")
def overview(user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Every number is computed from stored rows; nothing is hardcoded or demo data."""
    org = user.organisation_id
    sites = db.scalars(select(Website).where(Website.organisation_id == org)).all()
    audits = db.scalars(select(SeoAudit).where(SeoAudit.organisation_id == org).order_by(SeoAudit.created_at)).all()
    done = [a for a in audits if a.status == "completed"]

    by_site: dict[int, list[SeoAudit]] = {}
    for a in done:
        by_site.setdefault(a.website_id, []).append(a)
    full_latest = [full[-1] for lst in by_site.values() if (full := [a for a in lst if a.mode == "site"])]

    improvements = 0
    for lst in by_site.values():
        full = [a for a in lst if a.mode == "site"]
        if len(full) >= 2:
            prev, cur = full[-2], full[-1]
            fp = lambda a: set(db.scalars(select(SeoFinding.fingerprint).where(SeoFinding.audit_id == a.id)))  # noqa: E731
            improvements += len(fp(prev) - fp(cur))

    scores = [a.score for a in full_latest if a.score is not None]
    day = lambda d: d.date().isoformat()  # noqa: E731
    activity = Counter(day(a.created_at) for a in audits)
    names = {s.id: s.name for s in sites}
    return {
        "seo": {
            "websites": len(sites),
            "audits_total": len(done),
            "average_score": round(sum(scores) / len(scores), 1) if scores else None,
            "critical_issues": sum(a.critical_count for a in full_latest),
            "warnings": sum(a.warning_count for a in full_latest),
            "improvements_completed": improvements,
        },
        "score_trend": [{"date": day(a.created_at), "score": a.score, "website": names.get(a.website_id, "")} for a in done if a.mode == "site" and a.score is not None],
        "audit_activity": [{"date": d, "audits": n} for d, n in sorted(activity.items())],
        "recent_audits": [{**AuditOut.model_validate(a).model_dump(mode="json"), "website_name": names.get(a.website_id, "")} for a in reversed(audits[-8:])],
        "business": None,  # Leads, clients and revenue arrive with the CRM module (Phase D); no placeholder numbers.
    }


@router.get("/system/status")
def system_status(user: User = Depends(current_user)):
    s = get_settings()
    return {
        "environment": s.environment,
        "database": "sqlite" if s.database_url.startswith("sqlite") else s.database_url.split(":", 1)[0],
        "ai_provider": s.ai_provider,
        "ai_keys_configured": {"gemini": bool(s.gemini_api_key), "openai": bool(s.openai_api_key), "groq": bool(s.groq_api_key)},
        "category_weights": s.seo_category_weights,
        "crawl_limits": {"max_pages": s.crawl_max_pages_limit, "max_depth": s.crawl_max_depth_limit, "delay_seconds": s.crawl_delay_seconds},
        "registration_open": s.allow_registration,
        "integrations": {"google_analytics_4": "not implemented", "google_search_console": "not implemented"},
    }
