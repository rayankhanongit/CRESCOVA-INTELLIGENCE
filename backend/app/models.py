"""Relational models for Phases A and B. Every tenant-owned row carries organisation_id."""
from datetime import datetime

from sqlalchemy import JSON, Boolean, Float, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base, UTCDateTime, utcnow


class Organisation(Base):
    __tablename__ = "organisations"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
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
