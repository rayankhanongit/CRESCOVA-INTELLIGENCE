"""Relational models for Phases A and B. Every tenant-owned row carries organisation_id."""
from datetime import date, datetime

from sqlalchemy import JSON, Boolean, Date, Float, ForeignKey, Index, Integer, Numeric, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base, UTCDateTime, utcnow

# shortcut: money is read back as a float rounded to 2dp (stored as NUMERIC); fine for quotes and totals,
# switch to Decimal if invoicing or payment tracking is added.
Money = Numeric(12, 2, asdecimal=False)


class Organisation(Base):
    __tablename__ = "organisations"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    currency: Mapped[str] = mapped_column(String(3), default="USD", server_default="USD")  # one currency per agency
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)


class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(primary_key=True)
    organisation_id: Mapped[int] = mapped_column(ForeignKey("organisations.id", ondelete="CASCADE"), index=True)
    email: Mapped[str] = mapped_column(String(254), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    full_name: Mapped[str] = mapped_column(String(200))
    role: Mapped[str] = mapped_column(String(20), default="owner")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    organisation: Mapped[Organisation] = relationship()


class Website(Base):
    __tablename__ = "websites"
    __table_args__ = (UniqueConstraint("organisation_id", "url", name="uq_website_org_url"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    organisation_id: Mapped[int] = mapped_column(ForeignKey("organisations.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(200))
    url: Mapped[str] = mapped_column(String(2048))
    category: Mapped[str] = mapped_column(String(120), default="")
    target_audience: Mapped[str] = mapped_column(String(500), default="")
    market: Mapped[str] = mapped_column(String(200), default="")
    platform: Mapped[str] = mapped_column(String(120), default="")
    description: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, onupdate=utcnow)
    last_audit_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    current_score: Mapped[float | None] = mapped_column(Float, nullable=True)


class SeoAudit(Base):
    __tablename__ = "seo_audits"
    __table_args__ = (Index("ix_audit_site_created", "website_id", "created_at"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    organisation_id: Mapped[int] = mapped_column(ForeignKey("organisations.id", ondelete="CASCADE"), index=True)
    website_id: Mapped[int] = mapped_column(ForeignKey("websites.id", ondelete="CASCADE"))
    status: Mapped[str] = mapped_column(String(20), default="queued")  # queued|running|completed|failed
    mode: Mapped[str] = mapped_column(String(10), default="site")  # site|url
    target_url: Mapped[str] = mapped_column(String(2048))
    max_pages: Mapped[int] = mapped_column(Integer, default=50)
    max_depth: Mapped[int] = mapped_column(Integer, default=3)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    finished_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    duration_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    pages_crawled: Mapped[int] = mapped_column(Integer, default=0)
    score: Mapped[float | None] = mapped_column(Float, nullable=True)
    category_scores: Mapped[dict] = mapped_column(JSON, default=dict)
    weights: Mapped[dict] = mapped_column(JSON, default=dict)
    critical_count: Mapped[int] = mapped_column(Integer, default=0)
    warning_count: Mapped[int] = mapped_column(Integer, default=0)
    info_count: Mapped[int] = mapped_column(Integer, default=0)
    passed_count: Mapped[int] = mapped_column(Integer, default=0)
    summary: Mapped[dict] = mapped_column(JSON, default=dict)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)


class WebsitePage(Base):
    __tablename__ = "website_pages"
    id: Mapped[int] = mapped_column(primary_key=True)
    audit_id: Mapped[int] = mapped_column(ForeignKey("seo_audits.id", ondelete="CASCADE"), index=True)
    url: Mapped[str] = mapped_column(String(2048))
    final_url: Mapped[str] = mapped_column(String(2048))
    status_code: Mapped[int | None] = mapped_column(Integer, nullable=True)
    depth: Mapped[int] = mapped_column(Integer, default=0)
    title: Mapped[str] = mapped_column(Text, default="")
    meta_description: Mapped[str] = mapped_column(Text, default="")
    canonical: Mapped[str] = mapped_column(String(2048), default="")
    word_count: Mapped[int] = mapped_column(Integer, default=0)
    indexable: Mapped[bool] = mapped_column(Boolean, default=True)
    score: Mapped[float | None] = mapped_column(Float, nullable=True)
    response_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    content_hash: Mapped[str | None] = mapped_column(String(40), nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    data: Mapped[dict] = mapped_column(JSON, default=dict)  # headings, images, links, schema, social tags


class SeoFinding(Base):
    __tablename__ = "seo_findings"
    id: Mapped[int] = mapped_column(primary_key=True)
    audit_id: Mapped[int] = mapped_column(ForeignKey("seo_audits.id", ondelete="CASCADE"), index=True)
    page_id: Mapped[int | None] = mapped_column(ForeignKey("website_pages.id", ondelete="CASCADE"), nullable=True, index=True)
    check_id: Mapped[str] = mapped_column(String(60))
    name: Mapped[str] = mapped_column(String(200))
    severity: Mapped[str] = mapped_column(String(10))  # critical|warning|info
    category: Mapped[str] = mapped_column(String(20))
    url: Mapped[str] = mapped_column(String(2048))
    explanation: Mapped[str] = mapped_column(Text)
    why_it_matters: Mapped[str] = mapped_column(Text)
    recommendation: Mapped[str] = mapped_column(Text)
    evidence: Mapped[str] = mapped_column(Text, default="")
    fingerprint: Mapped[str] = mapped_column(String(300), index=True)  # check_id|url, used to diff audits


class AuditLog(Base):
    __tablename__ = "audit_logs"
    id: Mapped[int] = mapped_column(primary_key=True)
    organisation_id: Mapped[int | None] = mapped_column(ForeignKey("organisations.id", ondelete="CASCADE"), nullable=True, index=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    action: Mapped[str] = mapped_column(String(80))
    detail: Mapped[str] = mapped_column(Text, default="")
    ip: Mapped[str] = mapped_column(String(64), default="")
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)


# ------------------------------------------------------------------ Phase D: agency management
def _org_fk():
    return mapped_column(ForeignKey("organisations.id", ondelete="CASCADE"), index=True)


class PricingPackage(Base):
    __tablename__ = "pricing_packages"
    id: Mapped[int] = mapped_column(primary_key=True)
    organisation_id: Mapped[int] = _org_fk()
    name: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(Text, default="")
    price: Mapped[float] = mapped_column(Money, default=0)
    billing: Mapped[str] = mapped_column(String(10), default="one_time")  # one_time | monthly
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)


class Lead(Base):
    __tablename__ = "leads"
    __table_args__ = (Index("ix_lead_org_status", "organisation_id", "status"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    organisation_id: Mapped[int] = _org_fk()
    name: Mapped[str] = mapped_column(String(200))
    email: Mapped[str] = mapped_column(String(254), default="")
    phone: Mapped[str] = mapped_column(String(40), default="")
    company: Mapped[str] = mapped_column(String(200), default="")
    website: Mapped[str] = mapped_column(String(2048), default="")  # stored text only; never fetched
    service_interest: Mapped[str] = mapped_column(String(300), default="")
    budget: Mapped[float | None] = mapped_column(Money, nullable=True)
    source: Mapped[str] = mapped_column(String(80), default="")
    notes: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(20), default="new")
    priority: Mapped[str] = mapped_column(String(10), default="")  # set by a person; "" = not set
    qualification: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    last_contacted_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    next_follow_up: Mapped[date | None] = mapped_column(Date, nullable=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, onupdate=utcnow)


class Client(Base):
    __tablename__ = "clients"
    id: Mapped[int] = mapped_column(primary_key=True)
    organisation_id: Mapped[int] = _org_fk()
    source_lead_id: Mapped[int | None] = mapped_column(ForeignKey("leads.id", ondelete="SET NULL"), nullable=True, index=True)
    name: Mapped[str] = mapped_column(String(200))
    company: Mapped[str] = mapped_column(String(200), default="")
    email: Mapped[str] = mapped_column(String(254), default="")
    phone: Mapped[str] = mapped_column(String(40), default="")
    website: Mapped[str] = mapped_column(String(2048), default="")
    services: Mapped[str] = mapped_column(Text, default="")
    contract_start: Mapped[date | None] = mapped_column(Date, nullable=True)
    contract_end: Mapped[date | None] = mapped_column(Date, nullable=True)
    monthly_value: Mapped[float] = mapped_column(Money, default=0)
    status: Mapped[str] = mapped_column(String(20), default="onboarding")
    notes: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, onupdate=utcnow)


class Activity(Base):
    """Timeline entry for a lead or a client (notes, calls, emails, meetings, status changes, qualification runs)."""
    __tablename__ = "activities"
    id: Mapped[int] = mapped_column(primary_key=True)
    organisation_id: Mapped[int] = _org_fk()
    lead_id: Mapped[int | None] = mapped_column(ForeignKey("leads.id", ondelete="CASCADE"), nullable=True, index=True)
    client_id: Mapped[int | None] = mapped_column(ForeignKey("clients.id", ondelete="CASCADE"), nullable=True, index=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    kind: Mapped[str] = mapped_column(String(20))
    text: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)


class Proposal(Base):
    __tablename__ = "proposals"
    id: Mapped[int] = mapped_column(primary_key=True)
    organisation_id: Mapped[int] = _org_fk()
    lead_id: Mapped[int | None] = mapped_column(ForeignKey("leads.id", ondelete="SET NULL"), nullable=True, index=True)
    client_id: Mapped[int | None] = mapped_column(ForeignKey("clients.id", ondelete="SET NULL"), nullable=True, index=True)
    recipient_name: Mapped[str] = mapped_column(String(200), default="")  # snapshot, survives deleting the lead/client
    title: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(Text, default="")
    deliverables: Mapped[str] = mapped_column(Text, default="")
    timeline: Mapped[str] = mapped_column(Text, default="")
    payment_terms: Mapped[str] = mapped_column(Text, default="")
    discount_percent: Mapped[float] = mapped_column(Float, default=0)
    status: Mapped[str] = mapped_column(String(20), default="draft", index=True)
    valid_until: Mapped[date | None] = mapped_column(Date, nullable=True)
    sent_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, onupdate=utcnow)
    items: Mapped[list["ProposalItem"]] = relationship(cascade="all, delete-orphan", order_by="ProposalItem.position")


class ProposalItem(Base):
    __tablename__ = "proposal_items"
    id: Mapped[int] = mapped_column(primary_key=True)
    proposal_id: Mapped[int] = mapped_column(ForeignKey("proposals.id", ondelete="CASCADE"), index=True)
    package_id: Mapped[int | None] = mapped_column(ForeignKey("pricing_packages.id", ondelete="SET NULL"), nullable=True)
    description: Mapped[str] = mapped_column(String(500))
    quantity: Mapped[float] = mapped_column(Float, default=1)
    unit_price: Mapped[float] = mapped_column(Money, default=0)
    position: Mapped[int] = mapped_column(Integer, default=0)


class OnboardingTask(Base):
    __tablename__ = "onboarding_tasks"
    id: Mapped[int] = mapped_column(primary_key=True)
    organisation_id: Mapped[int] = _org_fk()
    client_id: Mapped[int] = mapped_column(ForeignKey("clients.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(300))
    done: Mapped[bool] = mapped_column(Boolean, default=False)
    done_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    position: Mapped[int] = mapped_column(Integer, default=0)


class Task(Base):
    __tablename__ = "tasks"
    id: Mapped[int] = mapped_column(primary_key=True)
    organisation_id: Mapped[int] = _org_fk()
    title: Mapped[str] = mapped_column(String(300))
    notes: Mapped[str] = mapped_column(Text, default="")
    due_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    priority: Mapped[str] = mapped_column(String(10), default="medium")
    completed_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    assignee_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    website_id: Mapped[int | None] = mapped_column(ForeignKey("websites.id", ondelete="SET NULL"), nullable=True)
    client_id: Mapped[int | None] = mapped_column(ForeignKey("clients.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)


# ------------------------------------------------------------------ Phase C: AI-assisted modules
class SeoRecommendation(Base):
    """AI-written advice about one deterministic check in one audit. The finding itself stays the source of truth."""
    __tablename__ = "seo_recommendations"
    id: Mapped[int] = mapped_column(primary_key=True)
    organisation_id: Mapped[int] = _org_fk()
    audit_id: Mapped[int] = mapped_column(ForeignKey("seo_audits.id", ondelete="CASCADE"), index=True)
    check_id: Mapped[str] = mapped_column(String(60))
    interpretation: Mapped[str] = mapped_column(Text)
    recommendation: Mapped[str] = mapped_column(Text)
    example: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(12), default="suggested")  # suggested | accepted | dismissed (a review marker only)
    provider: Mapped[str] = mapped_column(String(20))
    model: Mapped[str] = mapped_column(String(80))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)


class Keyword(Base):
    __tablename__ = "keywords"
    id: Mapped[int] = mapped_column(primary_key=True)
    organisation_id: Mapped[int] = _org_fk()
    website_id: Mapped[int | None] = mapped_column(ForeignKey("websites.id", ondelete="CASCADE"), nullable=True, index=True)
    term: Mapped[str] = mapped_column(String(200))
    intent: Mapped[str] = mapped_column(String(15), default="informational")
    topic: Mapped[str] = mapped_column(String(120), default="")
    mapped_url: Mapped[str] = mapped_column(String(2048), default="")
    source: Mapped[str] = mapped_column(String(15), default="manual")  # manual | ai_estimate | imported
    # Metrics are only ever typed in or imported by a person. Nothing here is generated by AI.
    search_volume: Mapped[int | None] = mapped_column(Integer, nullable=True)
    difficulty: Mapped[float | None] = mapped_column(Float, nullable=True)
    cpc: Mapped[float | None] = mapped_column(Float, nullable=True)
    position: Mapped[float | None] = mapped_column(Float, nullable=True)
    metrics_source: Mapped[str] = mapped_column(String(120), default="")
    notes: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)


class Competitor(Base):
    __tablename__ = "competitors"
    __table_args__ = (UniqueConstraint("website_id", "url", name="uq_competitor_site_url"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    organisation_id: Mapped[int] = _org_fk()
    website_id: Mapped[int] = mapped_column(ForeignKey("websites.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(200))
    url: Mapped[str] = mapped_column(String(2048))
    status: Mapped[str] = mapped_column(String(10), default="idle")  # idle | running | done | failed
    last_analysed_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    analysis: Mapped[dict | None] = mapped_column(JSON, nullable=True)  # observed facts from a bounded public crawl
    insights: Mapped[dict | None] = mapped_column(JSON, nullable=True)  # AI interpretation, labelled as such
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)


class ContentEntry(Base):
    """Generated or hand-written content. The Phase E calendar will schedule these same rows."""
    __tablename__ = "content_entries"
    id: Mapped[int] = mapped_column(primary_key=True)
    organisation_id: Mapped[int] = _org_fk()
    client_id: Mapped[int | None] = mapped_column(ForeignKey("clients.id", ondelete="SET NULL"), nullable=True, index=True)
    title: Mapped[str] = mapped_column(String(300))
    kind: Mapped[str] = mapped_column(String(30))
    platform: Mapped[str] = mapped_column(String(40), default="")
    body: Mapped[str] = mapped_column(Text, default="")
    params: Mapped[dict] = mapped_column(JSON, default=dict)
    ai_generated: Mapped[bool] = mapped_column(Boolean, default=False)
    status: Mapped[str] = mapped_column(String(15), default="draft")  # idea|draft|in_review|approved|scheduled|published
    publish_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    media: Mapped[list] = mapped_column(JSON, default=list, server_default="[]")  # references only (URLs or file names); no uploads
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, onupdate=utcnow)


class AiUsageLog(Base):
    __tablename__ = "ai_usage_logs"
    id: Mapped[int] = mapped_column(primary_key=True)
    organisation_id: Mapped[int] = _org_fk()
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    purpose: Mapped[str] = mapped_column(String(40))
    provider: Mapped[str] = mapped_column(String(20), default="")
    model: Mapped[str] = mapped_column(String(80), default="")
    tokens_in: Mapped[int | None] = mapped_column(Integer, nullable=True)
    tokens_out: Mapped[int | None] = mapped_column(Integer, nullable=True)
    ok: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)


# ------------------------------------------------------------------ Phase E: notifications and reports
class Notification(Base):
    """In-app only. Created on demand from stored data; nothing is sent outside the application."""
    __tablename__ = "notifications"
    __table_args__ = (UniqueConstraint("organisation_id", "dedupe_key", name="uq_notification_key"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    organisation_id: Mapped[int] = _org_fk()
    kind: Mapped[str] = mapped_column(String(20))
    title: Mapped[str] = mapped_column(String(300))
    link: Mapped[str] = mapped_column(String(200), default="")
    dedupe_key: Mapped[str] = mapped_column(String(120))
    read_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)


class Report(Base):
    """A saved snapshot: the data is gathered once when the report is generated, so exports never change afterwards."""
    __tablename__ = "reports"
    id: Mapped[int] = mapped_column(primary_key=True)
    organisation_id: Mapped[int] = _org_fk()
    website_id: Mapped[int | None] = mapped_column(ForeignKey("websites.id", ondelete="SET NULL"), nullable=True)
    client_id: Mapped[int | None] = mapped_column(ForeignKey("clients.id", ondelete="SET NULL"), nullable=True)
    title: Mapped[str] = mapped_column(String(200))
    period_start: Mapped[date] = mapped_column(Date)
    period_end: Mapped[date] = mapped_column(Date)
    sections: Mapped[list] = mapped_column(JSON, default=list)
    notes: Mapped[str] = mapped_column(Text, default="")
    data: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
