from datetime import datetime

from fastapi import APIRouter, Depends
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from ..db import get_db, utcnow
from ..models import Notification, User
from ..notify import sync
from ..schemas import ORM
from ..security import current_user
from .common import owned

router = APIRouter(prefix="/api/notifications", tags=["notifications"])


class NotificationOut(ORM):
    id: int
    kind: str
    title: str
    link: str
    read_at: datetime | None
    created_at: datetime


@router.get("")
def list_notifications(user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Refreshes from stored data, then returns the newest 50 and the unread count."""
    sync(db, user)
    rows = db.scalars(select(Notification).where(Notification.organisation_id == user.organisation_id).order_by(Notification.created_at.desc(), Notification.id.desc()).limit(50)).all()
    unread = db.scalar(select(func.count()).select_from(Notification).where(Notification.organisation_id == user.organisation_id, Notification.read_at.is_(None)))
    return {"unread": unread, "items": [NotificationOut.model_validate(n) for n in rows]}


@router.post("/{notification_id}/read", status_code=204)
def mark_read(notification_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    n = owned(db, user, Notification, notification_id)
    n.read_at = n.read_at or utcnow()
    db.commit()


@router.post("/read-all", status_code=204)
def mark_all_read(user: User = Depends(current_user), db: Session = Depends(get_db)):
    db.execute(update(Notification).where(Notification.organisation_id == user.organisation_id, Notification.read_at.is_(None)).values(read_at=utcnow()))
    db.commit()
