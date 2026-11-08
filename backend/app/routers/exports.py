"""Whole-table CSV exports of your own data, so nothing is locked in."""
import csv
import io

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Client, ContentEntry, Keyword, Lead, Proposal, Task, User
from ..security import current_user
from .proposals import totals

router = APIRouter(prefix="/api/export", tags=["export"])

TABLES = {
    "leads": (Lead, ["id", "name", "email", "phone", "company", "website", "service_interest", "budget", "source", "status", "priority", "notes", "last_contacted_at", "next_follow_up", "created_at"]),
    "clients": (Client, ["id", "name", "company", "email", "phone", "website", "services", "contract_start", "contract_end", "monthly_value", "status", "notes", "created_at"]),
    "tasks": (Task, ["id", "title", "notes", "due_date", "priority", "completed_at", "client_id", "website_id", "created_at"]),
    "keywords": (Keyword, ["id", "term", "intent", "topic", "mapped_url", "source", "search_volume", "difficulty", "cpc", "position", "metrics_source", "notes"]),
    "content": (ContentEntry, ["id", "title", "kind", "platform", "status", "publish_date", "ai_generated", "client_id", "body"]),
    "proposals": (Proposal, ["id", "title", "recipient_name", "status", "valid_until", "sent_at", "discount_percent", "created_at"]),
}


@router.get("/{table}.csv")
def export_table(table: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    if table not in TABLES:
        raise HTTPException(404, "Unknown export (use " + ", ".join(TABLES) + ")")
    model, cols = TABLES[table]
    buf = io.StringIO()
    w = csv.writer(buf)
    extra = ["total"] if table == "proposals" else []
    w.writerow(cols + extra)
    for row in db.scalars(select(model).where(model.organisation_id == user.organisation_id).order_by(model.id)):
        vals = [getattr(row, c) for c in cols] + ([totals(row.items, row.discount_percent)["total"]] if table == "proposals" else [])
        w.writerow([("'" + v if isinstance(v, str) and v[:1] in "=+-@\t\r" and v else ("" if v is None else v)) for v in vals])  # defuse spreadsheet formulas
    return Response(buf.getvalue(), media_type="text/csv", headers={"Content-Disposition": f'attachment; filename="{table}.csv"'})
