from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..db import get_db, utcnow
from ..models import Activity, Client, OnboardingTask, User
from ..schemas_crm import ActivityIn, ActivityOut, ClientIn, ClientOut, ClientPatch, OnboardingIn, OnboardingOut, OnboardingPatch
from ..security import audit_log, current_user
from .common import like_any, log, owned

router = APIRouter(prefix="/api", tags=["clients"])

# Never ask a client to send passwords through forms or chat; the access item says so on purpose.
DEFAULT_CHECKLIST = [
    "Collect business details", "Collect website information", "Collect brand assets", "Collect social media URLs",
    "Collect target audience information", "Collect geographical markets", "Collect SEO objectives",
    "Agree how access will be shared (use invitations or a password manager, never plain-text passwords)",
    "Create initial project tasks",
]


def _out(db: Session, clients: list[Client]) -> list[ClientOut]:
    ids = [c.id for c in clients]
    rows = db.execute(select(OnboardingTask.client_id, func.count(), func.sum(OnboardingTask.done))
                      .where(OnboardingTask.client_id.in_(ids)).group_by(OnboardingTask.client_id)).all() if ids else []
    prog = {cid: (int(done or 0), total) for cid, total, done in rows}
    return [ClientOut.model_validate(c).model_copy(update={"onboarding_done": prog.get(c.id, (0, 0))[0], "onboarding_total": prog.get(c.id, (0, 0))[1]}) for c in clients]


@router.get("/clients", response_model=list[ClientOut])
def list_clients(q: str = Query("", max_length=100), status: str = Query("", max_length=20), user: User = Depends(current_user), db: Session = Depends(get_db)):
    stmt = select(Client).where(Client.organisation_id == user.organisation_id)
    if q:
        stmt = stmt.where(like_any([Client.name, Client.company, Client.email], q))
    if status:
        stmt = stmt.where(Client.status == status)
    return _out(db, list(db.scalars(stmt.order_by(Client.created_at.desc(), Client.id.desc()).limit(500))))


@router.post("/clients", response_model=ClientOut, status_code=201)
def create_client(body: ClientIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    client = Client(organisation_id=user.organisation_id, **body.model_dump())
    db.add(client)
    db.commit()
    return _out(db, [client])[0]


@router.get("/clients/{client_id}", response_model=ClientOut)
def get_client(client_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return _out(db, [owned(db, user, Client, client_id)])[0]


@router.patch("/clients/{client_id}", response_model=ClientOut)
def update_client(client_id: int, body: ClientPatch, user: User = Depends(current_user), db: Session = Depends(get_db)):
    client = owned(db, user, Client, client_id)
    data = body.model_dump(exclude_unset=True)
    start, end = data.get("contract_start", client.contract_start), data.get("contract_end", client.contract_end)
    if start and end and end < start:
        raise HTTPException(422, "Contract end must not be before contract start")
    if "status" in data and data["status"] != client.status:
        log(db, user, "status_change", f"Status changed from {client.status} to {data['status']}", client_id=client.id)
    for k, v in data.items():
        setattr(client, k, v)
    db.commit()
    return _out(db, [client])[0]


@router.delete("/clients/{client_id}", status_code=204)
def delete_client(client_id: int, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    client = owned(db, user, Client, client_id)
    db.delete(client)
    db.commit()
    audit_log(db, request, user, "client_deleted", str(client_id))


@router.get("/clients/{client_id}/history", response_model=list[ActivityOut])
def client_history(client_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """The client's own timeline plus the timeline of the lead it was converted from."""
    client = owned(db, user, Client, client_id)
    cond = Activity.client_id == client.id
    if client.source_lead_id:
        cond = cond | (Activity.lead_id == client.source_lead_id)
    return db.scalars(select(Activity).where(Activity.organisation_id == user.organisation_id, cond).order_by(Activity.created_at.desc(), Activity.id.desc())).all()


@router.post("/clients/{client_id}/activities", response_model=ActivityOut, status_code=201)
def add_client_activity(client_id: int, body: ActivityIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    owned(db, user, Client, client_id)
    act = log(db, user, body.kind, body.text, client_id=client_id)
    db.commit()
    return act


# ---- onboarding checklist
@router.get("/clients/{client_id}/onboarding", response_model=list[OnboardingOut])
def list_onboarding(client_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    owned(db, user, Client, client_id)
    return db.scalars(select(OnboardingTask).where(OnboardingTask.client_id == client_id).order_by(OnboardingTask.position, OnboardingTask.id)).all()


@router.post("/clients/{client_id}/onboarding/start", response_model=list[OnboardingOut], status_code=201)
def start_onboarding(client_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    client = owned(db, user, Client, client_id)
    if db.scalar(select(func.count()).select_from(OnboardingTask).where(OnboardingTask.client_id == client.id)):
        raise HTTPException(409, "Onboarding has already been started for this client")
    for i, title in enumerate(DEFAULT_CHECKLIST):
        db.add(OnboardingTask(organisation_id=user.organisation_id, client_id=client.id, title=title, position=i))
    log(db, user, "note", "Onboarding checklist started", client_id=client.id)
    db.commit()
    return list_onboarding(client_id, user, db)


@router.post("/clients/{client_id}/onboarding", response_model=OnboardingOut, status_code=201)
def add_onboarding(client_id: int, body: OnboardingIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    owned(db, user, Client, client_id)
    last = db.scalar(select(func.max(OnboardingTask.position)).where(OnboardingTask.client_id == client_id))
    item = OnboardingTask(organisation_id=user.organisation_id, client_id=client_id, title=body.title, position=(last if last is not None else -1) + 1)
    db.add(item)
    db.commit()
    return item


@router.patch("/onboarding/{item_id}", response_model=OnboardingOut)
def update_onboarding(item_id: int, body: OnboardingPatch, user: User = Depends(current_user), db: Session = Depends(get_db)):
    item = owned(db, user, OnboardingTask, item_id)
    if body.title is not None:
        item.title = body.title
    if body.done is not None:
        item.done, item.done_at = body.done, (utcnow() if body.done else None)
    db.commit()
    return item


@router.delete("/onboarding/{item_id}", status_code=204)
def delete_onboarding(item_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    db.delete(owned(db, user, OnboardingTask, item_id))
    db.commit()
