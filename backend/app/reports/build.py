"""Gathers a report snapshot. Every section carries a `source` label so a reader can always tell measured data
(from Crescova's own crawler) from data your team typed in, and from AI text. Nothing is estimated here, and
Google Analytics / Search Console are not connected, so no traffic or ranking figures can appear."""
from datetime import date, datetime, time, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import utcnow
from ..models import Client, ContentEntry, Keyword, OnboardingTask, SeoAudit, SeoFinding, SeoRecommendation, Task, Website
from ..seo.checks import CHECKS

SECTIONS = ("seo", "keywords", "tasks", "recommendations", "progress", "content", "notes")
NEEDS_WEBSITE = {"seo", "keywords", "recommendations"}
SOURCES = {
    "seo": "Measured: Crescova's own crawler and deterministic checks (stored audit data)",
    "keywords": "Entered or imported by your team. AI-suggested terms are marked and carry no metrics",
    "tasks": "Task records entered by your team",
    "recommendations": "AI-generated text that a person reviewed and accepted. Not measured data",
    "progress": "Records entered by your team",
    "content": "Content records entered or drafted by your team (AI-assisted drafts are flagged)",
    "notes": "Written by your team",
}
NOT_CONNECTED = {"google_analytics_4": "Not connected. No traffic or conversion data is included.",
                 "google_search_console": "Not connected. No impressions, clicks or ranking positions are included."}


def _bounds(start: date, end: date) -> tuple[datetime, datetime]:
    return datetime.combine(start, time.min, timezone.utc), datetime.combine(end + timedelta(days=1), time.min, timezone.utc)


def _seo(db: Session, org: int, site: Website, start: date, end: date) -> dict:
    lo, hi = _bounds(start, end)
    audits = list(db.scalars(select(SeoAudit).where(SeoAudit.organisation_id == org, SeoAudit.website_id == site.id, SeoAudit.status == "completed",
                                                    SeoAudit.created_at >= lo, SeoAudit.created_at < hi).order_by(SeoAudit.created_at, SeoAudit.id)))
    full = [a for a in audits if a.mode == "site"]
    out: dict = {"source": SOURCES["seo"], "audits_run": len(audits), "full_site_audits": len(full)}
    if not full:
        return {**out, "note": "No full-site audit was completed in this period."}
    first, last = full[0], full[-1]
    fp = lambda a: {f.fingerprint: f for f in db.scalars(select(SeoFinding).where(SeoFinding.audit_id == a.id))}  # noqa: E731
    last_f = fp(last)
    grouped: dict[str, dict] = {}
    for f in last_f.values():
        g = grouped.setdefault(f.check_id, {"issue": f.name, "severity": f.severity, "category": f.category, "affected_urls": 0})
        g["affected_urls"] += 1
    out.update(latest_audit_id=last.id, latest_audit_date=last.created_at.date().isoformat(), score=last.score, category_scores=last.category_scores,
               pages_crawled=last.pages_crawled, critical=last.critical_count, warnings=last.warning_count, opportunities=last.info_count, checks_passed=last.passed_count,
               open_issues=sorted(grouped.values(), key=lambda g: ({"critical": 0, "warning": 1, "info": 2}[g["severity"]], -g["affected_urls"]))[:25])
    if first.id != last.id:
        first_f = fp(first)
        out.update(first_audit_date=first.created_at.date().isoformat(), first_score=first.score,
                   score_change=None if None in (first.score, last.score) else round(last.score - first.score, 1),
                   resolved=sorted({f.name for k, f in first_f.items() if k not in last_f})[:25], new=sorted({f.name for k, f in last_f.items() if k not in first_f})[:25])
    return out


def build(db: Session, org: int, *, site: Website | None, client: Client | None, start: date, end: date, sections: list[str], notes: str, currency: str) -> dict:
    lo, hi = _bounds(start, end)
    data: dict = {"meta": {"period_start": start.isoformat(), "period_end": end.isoformat(), "generated_at": utcnow().isoformat(),
                           "website": {"id": site.id, "name": site.name, "url": site.url} if site else None,
                           "client": {"id": client.id, "name": client.name, "status": client.status} if client else None, "currency": currency},
                  "integrations": NOT_CONNECTED, "sections": {}, "skipped": []}
    out = data["sections"]
    for s in sections:
        if s in NEEDS_WEBSITE and not site:
            data["skipped"].append(f"{s}: choose a website to include this section")
        elif s == "seo":
            out["seo"] = _seo(db, org, site, start, end)
        elif s == "keywords":
            kws = db.scalars(select(Keyword).where(Keyword.organisation_id == org, Keyword.website_id == site.id).order_by(Keyword.topic, Keyword.term)).all()
            out["keywords"] = {"source": SOURCES["keywords"], "items": [{"term": k.term, "intent": k.intent, "topic": k.topic, "mapped_url": k.mapped_url, "origin": k.source,
                               "search_volume": k.search_volume, "difficulty": k.difficulty, "cpc": k.cpc, "position": k.position, "metrics_source": k.metrics_source} for k in kws]}
        elif s == "recommendations":
            rows = db.execute(select(SeoRecommendation, SeoAudit).join(SeoAudit, SeoAudit.id == SeoRecommendation.audit_id).where(
                SeoRecommendation.organisation_id == org, SeoAudit.website_id == site.id, SeoRecommendation.status == "accepted",
                SeoRecommendation.created_at >= lo, SeoRecommendation.created_at < hi).order_by(SeoRecommendation.id)).all()
            out["recommendations"] = {"source": SOURCES["recommendations"], "items": [{"issue": CHECKS[r.check_id].name if r.check_id in CHECKS else r.check_id,
                                                                                         "recommendation": r.recommendation, "ai_model": f"{r.provider} {r.model}"} for r, _ in rows]}
        elif s == "tasks":
            q = select(Task).where(Task.organisation_id == org)
            q = q.where(Task.client_id == client.id) if client else q.where(Task.website_id == site.id)
            tasks = db.scalars(q.order_by(Task.id)).all()
            done = [t for t in tasks if t.completed_at and lo <= t.completed_at < hi]
            today = utcnow().date()
            out["tasks"] = {"source": SOURCES["tasks"], "completed_in_period": [{"title": t.title, "completed": t.completed_at.date().isoformat()} for t in done],
                            "open": sum(1 for t in tasks if not t.completed_at), "overdue": sum(1 for t in tasks if not t.completed_at and t.due_date and t.due_date < today)}
        elif s == "progress":
            if not client:
                data["skipped"].append("progress: choose a client to include this section")
                continue
            items = db.scalars(select(OnboardingTask).where(OnboardingTask.client_id == client.id).order_by(OnboardingTask.position)).all()
            out["progress"] = {"source": SOURCES["progress"], "client_status": client.status, "contract_start": str(client.contract_start or ""), "contract_end": str(client.contract_end or ""),
                               "onboarding_done": sum(i.done for i in items), "onboarding_total": len(items), "checklist": [{"item": i.title, "done": i.done} for i in items]}
        elif s == "content":
            q = select(ContentEntry).where(ContentEntry.organisation_id == org, ContentEntry.publish_date >= start, ContentEntry.publish_date <= end)
            if client:
                q = q.where(ContentEntry.client_id == client.id)
            rows = db.scalars(q.order_by(ContentEntry.publish_date, ContentEntry.id)).all()
            by: dict[str, int] = {}
            for e in rows:
                by[e.status] = by.get(e.status, 0) + 1
            out["content"] = {"source": SOURCES["content"], "by_status": by, "items": [{"date": e.publish_date.isoformat(), "title": e.title, "platform": e.platform, "status": e.status, "ai_assisted": e.ai_generated} for e in rows]}
        elif s == "notes":
            if notes.strip():
                out["notes"] = {"source": SOURCES["notes"], "text": notes.strip()}
    return data
