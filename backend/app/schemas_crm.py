"""Request/response schemas for Phase D. Each *Patch extends its *In: fields a caller omits are excluded with
model_dump(exclude_unset=True), so PATCH only touches what was sent."""
import re
from datetime import date, datetime
from typing import Literal
from urllib.parse import urlsplit

from pydantic import BaseModel, EmailStr, Field, field_validator, model_validator

from .schemas import ORM

LeadStatus = Literal["new", "contacted", "qualified", "proposal_sent", "negotiation", "converted", "lost"]
ClientStatus = Literal["onboarding", "active", "paused", "completed", "cancelled"]
ProposalStatus = Literal["draft", "sent", "accepted", "rejected", "expired"]
Priority = Literal["low", "medium", "high"]
Email = EmailStr | Literal[""]


def clean_website(v: str | None) -> str | None:
    """Websites on leads/clients are shown as links, so only http(s) is accepted (blocks javascript: URLs)."""
    if v is None or not v.strip():
        return v if v is None else ""
    v = v.strip()
    if "://" not in v:
        v = "https://" + v
    parts = urlsplit(v)
    try:
        parts.port  # raises for "javascript:alert(1)", which becomes host "javascript" with port "alert(1)"
        ok = parts.scheme in ("http", "https") and bool(parts.hostname) and not re.search(r"\s", v)
    except ValueError:
        ok = False
    if not ok:
        raise ValueError("Enter a valid http(s) website address")
    return v


class _Website(BaseModel):
    @field_validator("website", check_fields=False)
    @classmethod
    def _site(cls, v):
        return clean_website(v)


# ---- leads
class LeadIn(_Website):
    name: str = Field(min_length=1, max_length=200)
    email: Email = ""
    phone: str = Field(default="", max_length=40)
    company: str = Field(default="", max_length=200)
    website: str = Field(default="", max_length=2048)
    service_interest: str = Field(default="", max_length=300)
    budget: float | None = Field(default=None, ge=0, le=1e10)
    source: str = Field(default="", max_length=80)
    notes: str = Field(default="", max_length=10000)
    priority: Priority | Literal[""] = ""
    next_follow_up: date | None = None


class LeadPatch(LeadIn):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    status: LeadStatus | None = None


class LeadOut(ORM):
    id: int
    name: str
    email: str
    phone: str
    company: str
    website: str
    service_interest: str
    budget: float | None
    source: str
    notes: str
    status: str
    priority: str
    qualification: dict | None
    last_contacted_at: datetime | None
    next_follow_up: date | None
    created_at: datetime
    client_id: int | None = None


class ActivityIn(BaseModel):
    kind: Literal["note", "call", "email", "meeting"] = "note"
    text: str = Field(min_length=1, max_length=5000)


class ActivityOut(ORM):
    id: int
    kind: str
    text: str
    created_at: datetime


# ---- clients
class ClientIn(_Website):
    name: str = Field(min_length=1, max_length=200)
    company: str = Field(default="", max_length=200)
    email: Email = ""
    phone: str = Field(default="", max_length=40)
    website: str = Field(default="", max_length=2048)
    services: str = Field(default="", max_length=5000)
    contract_start: date | None = None
    contract_end: date | None = None
    monthly_value: float = Field(default=0, ge=0, le=1e10)
    status: ClientStatus = "onboarding"
    notes: str = Field(default="", max_length=10000)

    @model_validator(mode="after")
    def _dates(self):
        if self.contract_start and self.contract_end and self.contract_end < self.contract_start:
            raise ValueError("Contract end must not be before contract start")
        return self


class ClientPatch(ClientIn):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    status: ClientStatus | None = None
    monthly_value: float | None = Field(default=None, ge=0, le=1e10)


class ClientOut(ORM):
    id: int
    source_lead_id: int | None
    name: str
    company: str
    email: str
    phone: str
    website: str
    services: str
    contract_start: date | None
    contract_end: date | None
    monthly_value: float
    status: str
    notes: str
    created_at: datetime
    onboarding_done: int = 0
    onboarding_total: int = 0


class OnboardingIn(BaseModel):
    title: str = Field(min_length=1, max_length=300)


class OnboardingPatch(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=300)
    done: bool | None = None


class OnboardingOut(ORM):
    id: int
    client_id: int
    title: str
    done: bool
    done_at: datetime | None
    position: int


# ---- pricing and proposals
class PackageIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: str = Field(default="", max_length=2000)
    price: float = Field(default=0, ge=0, le=1e10)
    billing: Literal["one_time", "monthly"] = "one_time"
    is_active: bool = True


class PackagePatch(PackageIn):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    price: float | None = Field(default=None, ge=0, le=1e10)
    billing: Literal["one_time", "monthly"] | None = None
    is_active: bool | None = None


class PackageOut(ORM):
    id: int
    name: str
    description: str
    price: float
    billing: str
    is_active: bool


class ItemIn(BaseModel):
    package_id: int | None = None
    description: str = Field(min_length=1, max_length=500)
    quantity: float = Field(default=1, gt=0, le=1e6)
    unit_price: float = Field(default=0, ge=0, le=1e10)


class ProposalIn(BaseModel):
    lead_id: int | None = None
    client_id: int | None = None
    title: str = Field(min_length=1, max_length=200)
    description: str = Field(default="", max_length=10000)
    deliverables: str = Field(default="", max_length=10000)
    timeline: str = Field(default="", max_length=5000)
    payment_terms: str = Field(default="", max_length=5000)
    discount_percent: float = Field(default=0, ge=0, le=100)
    valid_until: date | None = None
    items: list[ItemIn] = Field(default_factory=list, max_length=100)


class ProposalPatch(ProposalIn):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    items: list[ItemIn] | None = None


class StatusIn(BaseModel):
    status: ProposalStatus


class ItemOut(ORM):
    id: int
    package_id: int | None
    description: str
    quantity: float
    unit_price: float
    line_total: float


class ProposalOut(ORM):
    id: int
    lead_id: int | None
    client_id: int | None
    recipient_name: str
    title: str
    description: str
    deliverables: str
    timeline: str
    payment_terms: str
    discount_percent: float
    status: str
    valid_until: date | None
    sent_at: datetime | None
    created_at: datetime
    items: list[ItemOut]
    subtotal: float
    discount_amount: float
    total: float


# ---- tasks and organisation
class TaskIn(BaseModel):
    title: str = Field(min_length=1, max_length=300)
    notes: str = Field(default="", max_length=5000)
    due_date: date | None = None
    priority: Priority = "medium"
    assignee_id: int | None = None
    website_id: int | None = None
    client_id: int | None = None


class TaskPatch(TaskIn):
    title: str | None = Field(default=None, min_length=1, max_length=300)
    priority: Priority | None = None
    done: bool | None = None


class TaskOut(ORM):
    id: int
    title: str
    notes: str
    due_date: date | None
    priority: str
    completed_at: datetime | None
    assignee_id: int | None
    website_id: int | None
    client_id: int | None


class OrgPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    currency: str | None = Field(default=None, pattern=r"^[A-Z]{3}$")
