from datetime import date, datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Client, Report, User, Website
from ..reports import build as rb
from ..reports.export import to_csv, to_json, to_pdf
from ..schemas import ORM
from ..security import audit_log, current_user
from .common import owned, ref

router = APIRouter(prefix="/api/reports", tags=["reports"])
Section = Literal["seo", "keywords", "tasks", "recommendations", "progress", "content", "notes"]
MAX_PERIOD_DAYS = 366


class ReportIn(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    website_id: int | None = None
    client_id: int | None = None
    period_start: date
    period_end: date
    sections: list[Section] = Field(min_length=1, max_length=7)
    notes: str = Field(default="", max_length=10000)

    @model_validator(mode="after")
    def _check(self):
        if self.period_end < self.period_start:
            raise ValueError("The period end must not be before the start")
        if (self.period_end - self.period_start).days > MAX_PERIOD_DAYS:
            raise ValueError("A report period can span at most one year")
        if self.website_id is None and self.client_id is None:
            raise ValueError("Choose a website, a client, or both")
        return self


class ReportOut(ORM):
    id: int
    title: str
    website_id: int | None
    client_id: int | None
    period_start: date
    period_end: date
    sections: list[str]
    created_at: datetime


class ReportDetail(ReportOut):
    notes: str
    data: dict


@router.get("", response_model=list[ReportOut])
def list_reports(user: User = Depends(current_user), db: Session = Depends(get_db)):
    return db.scalars(select(Report).where(Report.organisation_id == user.organisation_id).order_by(Report.created_at.desc(), Report.id.desc()).limit(200)).all()


@router.post("", response_model=ReportDetail, status_code=201)
def generate(body: ReportIn, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    site, client = ref(db, user, Website, body.website_id), ref(db, user, Client, body.client_id)
    sections = list(dict.fromkeys(body.sections))
    data = rb.build(db, user.organisation_id, site=site, client=client, start=body.period_start, end=body.period_end, sections=sections, notes=body.notes, currency=user.organisation.currency)
    rep = Report(organisation_id=user.organisation_id, website_id=body.website_id, client_id=body.client_id, title=body.title, period_start=body.period_start,
                 period_end=body.period_end, sections=sections, notes=body.notes, data=data)
    db.add(rep)
    db.commit()
    audit_log(db, request, user, "report_generated", f"{rep.id}: {body.title}")
    return rep


@router.get("/{report_id}", response_model=ReportDetail)
def get_report(report_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return owned(db, user, Report, report_id)


@router.delete("/{report_id}", status_code=204)
def delete_report(report_id: int, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    db.delete(owned(db, user, Report, report_id))
    db.commit()
    audit_log(db, request, user, "report_deleted", str(report_id))


@router.get("/{report_id}/export.{fmt}")
def export(report_id: int, fmt: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    rep = owned(db, user, Report, report_id)
    name = f"report-{rep.id}"
    if fmt == "pdf":
        return Response(to_pdf(rep, user.organisation.name), media_type="application/pdf", headers={"Content-Disposition": f'attachment; filename="{name}.pdf"'})
    if fmt == "csv":
        return Response(to_csv(rep), media_type="text/csv", headers={"Content-Disposition": f'attachment; filename="{name}.csv"'})
    if fmt == "json":
        return Response(to_json(rep), media_type="application/json", headers={"Content-Disposition": f'attachment; filename="{name}.json"'})
    raise HTTPException(404, "Unknown export format (use pdf, csv or json)")
