from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..crm.qualify import qualify
from ..db import get_db, utcnow
from ..models import Activity, Client, Lead, PricingPackage, User
from ..schemas_crm import ActivityIn, ActivityOut, ClientOut, LeadIn, LeadOut, LeadPatch
from ..security import audit_log, current_user
from .common import like_any, log, owned

router = APIRouter(prefix="/api/leads", tags=["leads"])
CONTACT_KINDS = {"call", "email", "meeting"}


def _client_ids(db: Session, lead_ids: list[int]) -> dict[int, int]:
    rows = db.execute(select(Client.source_lead_id, Client.id).where(Client.source_lead_id.in_(lead_ids))).all() if lead_ids else []
    return {lead_id: cid for lead_id, cid in rows}


def _out(db: Session, leads: list[Lead]) -> list[LeadOut]:
    cids = _client_ids(db, [lead.id for lead in leads])
    return [LeadOut.model_validate(lead).model_copy(update={"client_id": cids.get(lead.id)}) for lead in leads]


@router.get("", response_model=list[LeadOut])
def list_leads(q: str = Query("", max_length=100), status: str = Query("", max_length=20), source: str = Query("", max_length=80),
               priority: str = Query("", max_length=10), user: User = Depends(current_user), db: Session = Depends(get_db)):
    stmt = select(Lead).where(Lead.organisation_id == user.organisation_id)
    if q:
        stmt = stmt.where(like_any([Lead.name, Lead.email, Lead.company, Lead.phone, Lead.service_interest], q))
    for col, val in ((Lead.status, status), (Lead.source, source), (Lead.priority, priority)):
        if val:
            stmt = stmt.where(col == val)
    # shortcut: no pagination, capped at 500 rows; add paging when an agency exceeds that.
    return _out(db, list(db.scalars(stmt.order_by(Lead.created_at.desc(), Lead.id.desc()).limit(500))))


@router.post("", response_model=LeadOut, status_code=201)
def create_lead(body: LeadIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    lead = Lead(organisation_id=user.organisation_id, **body.model_dump())
    db.add(lead)
    db.flush()
    log(db, user, "note", "Lead created", lead_id=lead.id)
    db.commit()
    return _out(db, [lead])[0]


@router.get("/{lead_id}", response_model=LeadOut)
def get_lead(lead_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return _out(db, [owned(db, user, Lead, lead_id)])[0]


@router.patch("/{lead_id}", response_model=LeadOut)
def update_lead(lead_id: int, body: LeadPatch, user: User = Depends(current_user), db: Session = Depends(get_db)):
    lead = owned(db, user, Lead, lead_id)
    data = body.model_dump(exclude_unset=True)
    new_status = data.pop("status", None)
    if new_status == "converted" and lead.status != "converted":
        raise HTTPException(422, "Use 'Convert to client' to mark a lead as converted")
    for k, v in data.items():
        setattr(lead, k, v)
    if new_status and new_status != lead.status:
        log(db, user, "status_change", f"Status changed from {lead.status} to {new_status}", lead_id=lead.id)
        lead.status = new_status
    db.commit()
    return _out(db, [lead])[0]


@router.delete("/{lead_id}", status_code=204)
def delete_lead(lead_id: int, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    lead = owned(db, user, Lead, lead_id)
    db.delete(lead)
    db.commit()
    audit_log(db, request, user, "lead_deleted", str(lead_id))


@router.get("/{lead_id}/activities", response_model=list[ActivityOut])
def list_activities(lead_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    owned(db, user, Lead, lead_id)
    return db.scalars(select(Activity).where(Activity.lead_id == lead_id).order_by(Activity.created_at.desc(), Activity.id.desc())).all()


@router.post("/{lead_id}/activities", response_model=ActivityOut, status_code=201)
def add_activity(lead_id: int, body: ActivityIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    lead = owned(db, user, Lead, lead_id)
    act = log(db, user, body.kind, body.text, lead_id=lead.id)
    if body.kind in CONTACT_KINDS:
        lead.last_contacted_at = utcnow()
    db.commit()
    return act


@router.post("/{lead_id}/qualify", response_model=LeadOut)
def qualify_lead(lead_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Stores a rules-based assessment on the lead. It suggests only: status and priority are never changed here."""
    lead = owned(db, user, Lead, lead_id)
    packages = db.scalars(select(PricingPackage).where(PricingPackage.organisation_id == user.organisation_id, PricingPackage.is_active)).all()
    lead.qualification = qualify(lead, list(packages), utcnow())
    log(db, user, "qualification", f"Qualification run: suggested priority {lead.qualification['suggested_priority']}", lead_id=lead.id)
    db.commit()
    return _out(db, [lead])[0]


@router.post("/{lead_id}/convert", response_model=ClientOut, status_code=201)
def convert_lead(lead_id: int, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    lead = owned(db, user, Lead, lead_id)
    if db.scalar(select(Client.id).where(Client.source_lead_id == lead.id)):
        raise HTTPException(409, "This lead has already been converted to a client")
    client = Client(organisation_id=user.organisation_id, source_lead_id=lead.id, name=lead.name, company=lead.company, email=lead.email,
                    phone=lead.phone, website=lead.website, services=lead.service_interest, notes=lead.notes, status="onboarding")
    db.add(client)
    db.flush()
    log(db, user, "status_change", f"Status changed from {lead.status} to converted", lead_id=lead.id)
    log(db, user, "note", f"Converted from lead #{lead.id}", client_id=client.id)
    lead.status = "converted"
    db.commit()
    audit_log(db, request, user, "lead_converted", f"lead {lead.id} -> client {client.id}")
    return ClientOut.model_validate(client)
