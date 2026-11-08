from fastapi import HTTPException
from sqlalchemy import or_
from sqlalchemy.orm import Session

from ..models import Activity, User


def owned(db: Session, user: User, model, id_: int):
    """Load a tenant-owned row; another organisation's row is a 404 so ids can't be probed."""
    row = db.get(model, id_)
    if not row or row.organisation_id != user.organisation_id:
        raise HTTPException(404, f"{model.__name__} not found")
    return row


def ref(db: Session, user: User, model, id_: int | None):
    """Validate an optional foreign reference supplied by the caller belongs to the same organisation."""
    return None if id_ is None else owned(db, user, model, id_)


def like_any(columns, q: str):
    esc = q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return or_(*[c.ilike(f"%{esc}%", escape="\\") for c in columns])


def log(db: Session, user: User, kind: str, text: str, lead_id: int | None = None, client_id: int | None = None) -> Activity:
    a = Activity(organisation_id=user.organisation_id, user_id=user.id, lead_id=lead_id, client_id=client_id, kind=kind, text=text[:5000])
    db.add(a)
    return a
