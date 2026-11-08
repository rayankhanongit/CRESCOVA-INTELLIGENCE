from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..crm.proposal_pdf import proposal_pdf
from ..db import get_db, utcnow
from ..models import Client, Lead, PricingPackage, Proposal, ProposalItem, User
from ..schemas_crm import ItemIn, PackageIn, PackageOut, PackagePatch, ProposalIn, ProposalOut, ProposalPatch, StatusIn
from ..security import audit_log, current_user
from .common import log, owned, ref

router = APIRouter(prefix="/api", tags=["proposals"])


def totals(items, discount_percent: float) -> dict:
    """Server-side source of truth for proposal money (rounded to 2dp per line, then summed)."""
    subtotal = round(sum(round(i.quantity * i.unit_price, 2) for i in items), 2)
    discount = round(subtotal * discount_percent / 100, 2)
    return {"subtotal": subtotal, "discount_amount": discount, "total": round(subtotal - discount, 2)}


def out(p: Proposal) -> ProposalOut:
    items = [{"id": i.id, "package_id": i.package_id, "description": i.description, "quantity": i.quantity,
              "unit_price": i.unit_price, "line_total": round(i.quantity * i.unit_price, 2)} for i in p.items]
    base = {c: getattr(p, c) for c in ProposalOut.model_fields if c not in ("items", "subtotal", "discount_amount", "total")}
    return ProposalOut(**base, items=items, **totals(p.items, p.discount_percent))


def _expire(db: Session, rows: list[Proposal]) -> None:
    today = utcnow().date()
    for p in rows:
        if p.status in ("draft", "sent") and p.valid_until and p.valid_until < today:
            p.status = "expired"
    db.commit()


def _items(db: Session, user: User, items: list[ItemIn]) -> list[ProposalItem]:
    for it in items:
        ref(db, user, PricingPackage, it.package_id)
    return [ProposalItem(position=n, **it.model_dump()) for n, it in enumerate(items)]


def _recipient(db: Session, user: User, lead_id: int | None, client_id: int | None) -> str:
    client, lead = ref(db, user, Client, client_id), ref(db, user, Lead, lead_id)
    return (client or lead).name if (client or lead) else ""


# ---- pricing packages
@router.get("/packages", response_model=list[PackageOut])
def list_packages(user: User = Depends(current_user), db: Session = Depends(get_db)):
    return db.scalars(select(PricingPackage).where(PricingPackage.organisation_id == user.organisation_id).order_by(PricingPackage.name)).all()


@router.post("/packages", response_model=PackageOut, status_code=201)
def create_package(body: PackageIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    pkg = PricingPackage(organisation_id=user.organisation_id, **body.model_dump())
    db.add(pkg)
    db.commit()
    return pkg


@router.patch("/packages/{package_id}", response_model=PackageOut)
def update_package(package_id: int, body: PackagePatch, user: User = Depends(current_user), db: Session = Depends(get_db)):
    pkg = owned(db, user, PricingPackage, package_id)
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(pkg, k, v)
    db.commit()
    return pkg


@router.delete("/packages/{package_id}", status_code=204)
def delete_package(package_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    db.delete(owned(db, user, PricingPackage, package_id))  # proposal lines keep their own description and price
    db.commit()


# ---- proposals
@router.get("/proposals", response_model=list[ProposalOut])
def list_proposals(status: str = Query("", max_length=20), user: User = Depends(current_user), db: Session = Depends(get_db)):
    rows = list(db.scalars(select(Proposal).where(Proposal.organisation_id == user.organisation_id).order_by(Proposal.created_at.desc(), Proposal.id.desc()).limit(500)))
    _expire(db, rows)
    return [out(p) for p in rows if not status or p.status == status]


@router.post("/proposals", response_model=ProposalOut, status_code=201)
def create_proposal(body: ProposalIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    if body.lead_id is None and body.client_id is None:
        raise HTTPException(422, "Choose a lead or a client for this proposal")
    data = body.model_dump(exclude={"items"})
    p = Proposal(organisation_id=user.organisation_id, recipient_name=_recipient(db, user, body.lead_id, body.client_id), **data)
    p.items = _items(db, user, body.items)
    db.add(p)
    db.commit()
    return out(p)


def _get(db: Session, user: User, proposal_id: int) -> Proposal:
    p = owned(db, user, Proposal, proposal_id)
    _expire(db, [p])
    return p


@router.get("/proposals/{proposal_id}", response_model=ProposalOut)
def get_proposal(proposal_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return out(_get(db, user, proposal_id))


@router.patch("/proposals/{proposal_id}", response_model=ProposalOut)
def update_proposal(proposal_id: int, body: ProposalPatch, user: User = Depends(current_user), db: Session = Depends(get_db)):
    p = _get(db, user, proposal_id)
    if p.status != "draft":
        raise HTTPException(409, "Only draft proposals can be edited. Set the status back to draft first.")
    data = body.model_dump(exclude_unset=True, exclude={"items"})
    if "lead_id" in data or "client_id" in data:
        lead_id, client_id = data.get("lead_id", p.lead_id), data.get("client_id", p.client_id)
        if lead_id is None and client_id is None:
            raise HTTPException(422, "A proposal needs a lead or a client")
        data["recipient_name"] = _recipient(db, user, lead_id, client_id)
    for k, v in data.items():
        setattr(p, k, v)
    if body.items is not None:
        p.items = _items(db, user, body.items)
    db.commit()
    return out(p)


@router.delete("/proposals/{proposal_id}", status_code=204)
def delete_proposal(proposal_id: int, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    db.delete(owned(db, user, Proposal, proposal_id))
    db.commit()
    audit_log(db, request, user, "proposal_deleted", str(proposal_id))


@router.post("/proposals/{proposal_id}/status", response_model=ProposalOut)
def set_status(proposal_id: int, body: StatusIn, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Status is recorded by a person. Nothing is emailed: 'sent' just records that you sent the PDF yourself."""
    p = _get(db, user, proposal_id)
    if body.status == p.status:
        return out(p)
    if body.status == "sent" and not p.items:
        raise HTTPException(422, "Add at least one line item before marking a proposal as sent")
    log(db, user, "note", f"Proposal '{p.title}' marked {body.status}", lead_id=p.lead_id, client_id=p.client_id)
    if body.status == "sent":
        p.sent_at = p.sent_at or utcnow()
        lead = db.get(Lead, p.lead_id) if p.lead_id else None
        if lead and lead.status in ("new", "contacted", "qualified"):
            log(db, user, "status_change", f"Status changed from {lead.status} to proposal_sent", lead_id=lead.id)
            lead.status = "proposal_sent"
    p.status = body.status
    db.commit()
    audit_log(db, request, user, "proposal_status", f"{p.id} -> {body.status}")
    return out(p)


@router.get("/proposals/{proposal_id}/pdf")
def download_pdf(proposal_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    p = _get(db, user, proposal_id)
    pdf = proposal_pdf(out(p).model_dump(), user.organisation.name, user.organisation.currency)
    return Response(pdf, media_type="application/pdf", headers={"Content-Disposition": f'attachment; filename="proposal-{p.id}.pdf"'})
