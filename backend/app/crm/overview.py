"""Business figures for the dashboard. Everything is computed from stored rows; revenue means what we can actually
know: recurring value of active clients and the total of accepted proposals. Payments are not tracked, so there is
no "outstanding payments" figure."""
from collections import Counter

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from ..db import utcnow
from ..models import Client, Lead, Proposal, Task, User
from ..routers.proposals import totals

FUNNEL = ["new", "contacted", "qualified", "proposal_sent", "negotiation", "converted"]


def _month(d) -> str:
    return f"{d.year}-{d.month:02d}"


def business_overview(db: Session, user: User) -> dict:
    org = user.organisation_id
    leads = db.scalars(select(Lead).where(Lead.organisation_id == org)).all()
    clients = db.scalars(select(Client).where(Client.organisation_id == org).order_by(Client.created_at)).all()
    proposals = db.scalars(select(Proposal).options(selectinload(Proposal.items)).where(Proposal.organisation_id == org)).all()
    by_status = Counter(lead.status for lead in leads)
    today = utcnow().date()

    attention = []
    for t in db.scalars(select(Task).where(Task.organisation_id == org, Task.completed_at.is_(None), Task.due_date.is_not(None))):
        if (t.due_date - today).days <= 2:
            attention.append({"kind": "task", "id": t.id, "title": t.title, "due": t.due_date.isoformat(), "overdue": t.due_date < today})
    for lead in leads:
        if lead.next_follow_up and lead.next_follow_up <= today and lead.status not in ("converted", "lost"):
            attention.append({"kind": "followup", "id": lead.id, "title": f"Follow up with {lead.name}", "due": lead.next_follow_up.isoformat(), "overdue": lead.next_follow_up < today})
    attention.sort(key=lambda a: a["due"])

    growth, running = [], 0
    for month, n in sorted(Counter(_month(c.created_at) for c in clients).items()):
        running += n
        growth.append({"month": month, "clients": running})

    return {
        "currency": user.organisation.currency,
        "leads_total": len(leads),
        "leads_new": by_status["new"],
        "leads_qualified": by_status["qualified"],
        "clients_active": sum(c.status == "active" for c in clients),
        "clients_total": len(clients),
        "proposals_sent": sum(p.sent_at is not None for p in proposals),
        "proposals_accepted": sum(p.status == "accepted" for p in proposals),
        "conversion_rate": round(by_status["converted"] / len(leads) * 100, 1) if leads else None,
        "monthly_recurring_value": round(sum(c.monthly_value for c in clients if c.status == "active"), 2),
        "accepted_proposal_value": round(sum(totals(p.items, p.discount_percent)["total"] for p in proposals if p.status == "accepted"), 2),
        "funnel": [{"stage": s, "leads": by_status[s]} for s in FUNNEL],
        "leads_by_month": [{"month": m, "leads": n} for m, n in sorted(Counter(_month(lead.created_at) for lead in leads).items())],
        "client_growth": growth,
        "attention": attention[:10],
    }
