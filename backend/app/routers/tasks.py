from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db, utcnow
from ..models import Client, Task, User, Website
from ..schemas_crm import OrgPatch, TaskIn, TaskOut, TaskPatch
from ..security import audit_log, current_user
from .common import owned, ref

router = APIRouter(prefix="/api", tags=["tasks"])


def _check_refs(db: Session, user: User, data: dict) -> None:
    for key, model in (("assignee_id", User), ("website_id", Website), ("client_id", Client)):
        ref(db, user, model, data.get(key))


@router.get("/tasks", response_model=list[TaskOut])
def list_tasks(state: str = Query("", pattern="^(|open|done|overdue)$"), website_id: int | None = None, client_id: int | None = None,
               user: User = Depends(current_user), db: Session = Depends(get_db)):
    stmt = select(Task).where(Task.organisation_id == user.organisation_id)
    if state == "done":
        stmt = stmt.where(Task.completed_at.is_not(None))
    elif state in ("open", "overdue"):
        stmt = stmt.where(Task.completed_at.is_(None))
        if state == "overdue":
            stmt = stmt.where(Task.due_date < utcnow().date())
    if website_id is not None:
        stmt = stmt.where(Task.website_id == website_id)
    if client_id is not None:
        stmt = stmt.where(Task.client_id == client_id)
    return db.scalars(stmt.order_by(Task.due_date.is_(None), Task.due_date, Task.id).limit(1000)).all()


@router.post("/tasks", response_model=TaskOut, status_code=201)
def create_task(body: TaskIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    _check_refs(db, user, body.model_dump())
    t = Task(organisation_id=user.organisation_id, **body.model_dump())
    db.add(t)
    db.commit()
    return t


@router.patch("/tasks/{task_id}", response_model=TaskOut)
def update_task(task_id: int, body: TaskPatch, user: User = Depends(current_user), db: Session = Depends(get_db)):
    t = owned(db, user, Task, task_id)
    data = body.model_dump(exclude_unset=True)
    done = data.pop("done", None)
    _check_refs(db, user, data)
    for k, v in data.items():
        setattr(t, k, v)
    if done is not None:
        t.completed_at = (t.completed_at or utcnow()) if done else None
    db.commit()
    return t


@router.delete("/tasks/{task_id}", status_code=204)
def delete_task(task_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    db.delete(owned(db, user, Task, task_id))
    db.commit()


@router.get("/team")
def team(user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Users in the caller's organisation (for task assignment)."""
    rows = db.scalars(select(User).where(User.organisation_id == user.organisation_id, User.is_active).order_by(User.full_name))
    return [{"id": u.id, "full_name": u.full_name} for u in rows]


@router.patch("/organisation")
def update_organisation(body: OrgPatch, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    if user.role not in ("owner", "admin"):
        raise HTTPException(403, "Only an owner or admin can change agency settings")
    org = user.organisation
    for k, v in body.model_dump(exclude_unset=True).items():
        if v is not None:
            setattr(org, k, v)
    db.commit()
    audit_log(db, request, user, "organisation_updated", str(body.model_dump(exclude_unset=True)))
    return {"name": org.name, "currency": org.currency}
