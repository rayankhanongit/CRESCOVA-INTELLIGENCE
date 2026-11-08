"""In-app notifications, created on demand from stored data. De-duplicated by (organisation, dedupe_key), so syncing is idempotent.
Nothing here emails, messages or pushes anything outside the application."""
from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from .db import utcnow
from .models import ContentEntry, Lead, Notification, Proposal, SeoAudit, Task, User, Website


def sync(db: Session, user: User) -> int:
    org = user.organisation_id
    today = utcnow().date()
    wanted: list[tuple[str, str, str, str]] = []  # (dedupe_key, kind, title, link)

    for t in db.scalars(select(Task).where(Task.organisation_id == org, Task.completed_at.is_(None), Task.due_date.is_not(None))):
        if t.due_date < today:
            wanted.append((f"task:{t.id}:overdue", "task", f"Task overdue: {t.title}", "/tasks"))
        elif t.due_date <= today + timedelta(days=2):
            wanted.append((f"task:{t.id}:soon:{t.due_date}", "task", f"Task due {t.due_date:%d %b}: {t.title}", "/tasks"))
    for lead in db.scalars(select(Lead).where(Lead.organisation_id == org, Lead.next_follow_up.is_not(None), Lead.next_follow_up <= today, Lead.status.notin_(["converted", "lost"]))):
        wanted.append((f"lead:{lead.id}:followup:{lead.next_follow_up}", "lead", f"Follow up with {lead.name}", f"/leads/{lead.id}"))
    cutoff = utcnow() - timedelta(days=7)
    names = {w.id: w.name for w in db.scalars(select(Website).where(Website.organisation_id == org))}
    for a in db.scalars(select(SeoAudit).where(SeoAudit.organisation_id == org, SeoAudit.status.in_(["completed", "failed"]), SeoAudit.finished_at >= cutoff)):
        site = names.get(a.website_id, "a website")
        title = f"Audit finished for {site}: score {a.score}" if a.status == "completed" else f"Audit failed for {site}"
        wanted.append((f"audit:{a.id}:{a.status}", "audit", title, f"/audits/{a.id}"))
    for p in db.scalars(select(Proposal).where(Proposal.organisation_id == org, Proposal.valid_until.is_not(None), Proposal.valid_until < today, Proposal.status.in_(["draft", "sent", "expired"]))):
        wanted.append((f"proposal:{p.id}:expired", "proposal", f"Proposal passed its valid-until date: {p.title}", f"/proposals/{p.id}"))
    for c in db.scalars(select(ContentEntry).where(ContentEntry.organisation_id == org, ContentEntry.publish_date == today, ContentEntry.status.in_(["approved", "scheduled"]))):
        wanted.append((f"content:{c.id}:{today}", "content", f"Content due today: {c.title}", "/calendar"))

    have = set(db.scalars(select(Notification.dedupe_key).where(Notification.organisation_id == org, Notification.dedupe_key.in_([w[0] for w in wanted])))) if wanted else set()
    new = [w for w in wanted if w[0] not in have]
    for key, kind, title, link in new:
        db.add(Notification(organisation_id=org, kind=kind, title=title[:300], link=link, dedupe_key=key))
    db.commit()
    return len(new)
