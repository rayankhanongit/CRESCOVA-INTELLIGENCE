from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator


class ORM(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class RegisterIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=10, max_length=128)
    full_name: str = Field(min_length=1, max_length=200)
    organisation_name: str = Field(min_length=1, max_length=200)


class LoginIn(BaseModel):
    email: EmailStr
    password: str = Field(max_length=128)


class UserOut(ORM):
    id: int
    email: str
    full_name: str
    role: str
    organisation_id: int
    organisation_name: str
    organisation_currency: str = "USD"


class WebsiteIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    url: str = Field(min_length=3, max_length=2048)
    category: str = Field(default="", max_length=120)
    target_audience: str = Field(default="", max_length=500)
    market: str = Field(default="", max_length=200)
    platform: str = Field(default="", max_length=120)
    description: str = Field(default="", max_length=5000)

    @field_validator("url")
    @classmethod
    def add_scheme(cls, v: str) -> str:
        v = v.strip()
        return v if "://" in v else f"https://{v}"


class WebsiteUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    category: str | None = Field(default=None, max_length=120)
    target_audience: str | None = Field(default=None, max_length=500)
    market: str | None = Field(default=None, max_length=200)
    platform: str | None = Field(default=None, max_length=120)
    description: str | None = Field(default=None, max_length=5000)


class WebsiteOut(ORM):
    id: int
    name: str
    url: str
    category: str
    target_audience: str
    market: str
    platform: str
    description: str
    created_at: datetime
    last_audit_at: datetime | None
    current_score: float | None


class AuditIn(BaseModel):
    mode: Literal["site", "url"] = "site"
    url: str | None = Field(default=None, max_length=2048)
    max_pages: int = Field(default=50, ge=1, le=1000)
    max_depth: int = Field(default=3, ge=0, le=20)


class AuditOut(ORM):
    id: int
    website_id: int
    status: str
    mode: str
    target_url: str
    max_pages: int
    max_depth: int
    created_at: datetime
    finished_at: datetime | None
    duration_ms: int | None
    pages_crawled: int
    score: float | None
    category_scores: dict
    critical_count: int
    warning_count: int
    info_count: int
    passed_count: int
    error: str | None


class AuditDetail(AuditOut):
    weights: dict
    summary: dict


class FindingOut(ORM):
    id: int
    page_id: int | None
    check_id: str
    name: str
    severity: str
    category: str
    url: str
    explanation: str
    why_it_matters: str
    recommendation: str
    evidence: str


class PageRow(ORM):
    id: int
    url: str
    final_url: str
    status_code: int | None
    depth: int
    title: str
    word_count: int
    indexable: bool
    score: float | None
    response_ms: int | None


class PageDetail(PageRow):
    audit_id: int
    meta_description: str
    canonical: str
    error: str | None
    data: dict
    findings: list[FindingOut]
