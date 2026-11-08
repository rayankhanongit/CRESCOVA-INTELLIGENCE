import csv
import io
from typing import Literal

from fastapi import APIRouter, Depends, Query, Response
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..ai.service import run_ai, untrusted
from ..db import get_db
from ..models import Keyword, User, Website
from ..schemas import ORM
from ..security import current_user
from .common import owned, ref

router = APIRouter(prefix="/api/keywords", tags=["keywords"])
Intent = Literal["informational", "navigational", "commercial", "transactional"]


class KeywordIn(BaseModel):
    term: str = Field(min_length=1, max_length=200)
    website_id: int | None = None
    intent: Intent = "informational"
    topic: str = Field(default="", max_length=120)
    mapped_url: str = Field(default="", max_length=2048)
    source: Literal["manual", "ai_estimate", "imported"] = "manual"
    search_volume: int | None = Field(default=None, ge=0, le=10**10)
    difficulty: float | None = Field(default=None, ge=0, le=100)
    cpc: float | None = Field(default=None, ge=0, le=10**6)
    position: float | None = Field(default=None, ge=0, le=1000)
    metrics_source: str = Field(default="", max_length=120)
    notes: str = Field(default="", max_length=5000)


class KeywordPatch(KeywordIn):
    term: str | None = Field(default=None, min_length=1, max_length=200)


class KeywordOut(ORM, KeywordIn):
    id: int


class BulkIn(BaseModel):
    keywords: list[KeywordIn] = Field(min_length=1, max_length=200)


class SuggestIn(BaseModel):
    seeds: list[str] = Field(min_length=1, max_length=10)
    website_id: int | None = None
    category: str = Field(default="", max_length=120)
    location: str = Field(default="", max_length=120)
    count: int = Field(default=20, ge=5, le=40)


def _scoped(db: Session, user: User, website_id: int | None):
    q = select(Keyword).where(Keyword.organisation_id == user.organisation_id)
    return q.where(Keyword.website_id == website_id) if website_id is not None else q


@router.get("", response_model=list[KeywordOut])
def list_keywords(website_id: int | None = None, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return db.scalars(_scoped(db, user, website_id).order_by(Keyword.topic, Keyword.term).limit(2000)).all()


@router.post("", response_model=KeywordOut, status_code=201)
def add_keyword(body: KeywordIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    ref(db, user, Website, body.website_id)
    k = Keyword(organisation_id=user.organisation_id, **body.model_dump())
    db.add(k)
    db.commit()
    return k


@router.post("/bulk", response_model=list[KeywordOut], status_code=201)
def add_many(body: BulkIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    for site_id in {k.website_id for k in body.keywords}:
        ref(db, user, Website, site_id)
    rows = [Keyword(organisation_id=user.organisation_id, **k.model_dump()) for k in body.keywords]
    db.add_all(rows)
    db.commit()
    return rows


@router.patch("/{keyword_id}", response_model=KeywordOut)
def update_keyword(keyword_id: int, body: KeywordPatch, user: User = Depends(current_user), db: Session = Depends(get_db)):
    k = owned(db, user, Keyword, keyword_id)
    data = body.model_dump(exclude_unset=True)
    ref(db, user, Website, data.get("website_id"))
    for key, v in data.items():
        setattr(k, key, v)
    db.commit()
    return k


@router.delete("/{keyword_id}", status_code=204)
def delete_keyword(keyword_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    db.delete(owned(db, user, Keyword, keyword_id))
    db.commit()


@router.get("/export.csv")
def export_csv(website_id: int | None = Query(None), user: User = Depends(current_user), db: Session = Depends(get_db)):
    buf = io.StringIO()
    w = csv.writer(buf)
    cols = ["term", "intent", "topic", "mapped_url", "source", "search_volume", "difficulty", "cpc", "position", "metrics_source", "notes"]
    w.writerow(cols)
    for k in db.scalars(_scoped(db, user, website_id).order_by(Keyword.topic, Keyword.term)):
        row = [getattr(k, c) if getattr(k, c) is not None else "" for c in cols]
        w.writerow([("'" + c if isinstance(c, str) and c[:1] in "=+-@\t\r" and c else c) for c in row])  # defuse spreadsheet formulas
    return Response(buf.getvalue(), media_type="text/csv", headers={"Content-Disposition": 'attachment; filename="keywords.csv"'})


@router.post("/suggest")
def suggest(body: SuggestIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Qualitative AI ideas only. They are estimates: no volume, difficulty, CPC or ranking is produced, and nothing is saved until you choose to."""
    site = ref(db, user, Website, body.website_id)
    context = f"{site.name}; category {site.category}; market {site.market}; audience {site.target_audience}" if site else ""
    prompt = (
        f"Seed keywords: {untrusted(', '.join(body.seeds), 600)}\nBusiness category: {untrusted(body.category or (site.category if site else ''), 200)}\n"
        f"Target location: {untrusted(body.location or (site.market if site else ''), 200)}\nWebsite context: {untrusted(context, 500)}\n\n"
        f"Suggest {body.count} related search phrases people might use. Group them by topic and classify each search intent as exactly one of "
        "informational, navigational, commercial, transactional. Do NOT give search volume, difficulty, CPC or ranking numbers. "
        'Reply as JSON: {"keywords":[{"term":"...","intent":"...","topic":"...","rationale":"..."}]}.'
    )
    res, data = run_ai(db, user, "keyword_suggestions", prompt, json_mode=True)
    out, seen = [], set()
    for it in (data.get("keywords", []) if isinstance(data, dict) else []):
        term = str(it.get("term", "")).strip()[:200] if isinstance(it, dict) else ""
        if not term or term.lower() in seen:
            continue
        seen.add(term.lower())
        intent = it.get("intent") if it.get("intent") in ("informational", "navigational", "commercial", "transactional") else "informational"
        out.append({"term": term, "intent": intent, "topic": str(it.get("topic", ""))[:120], "rationale": str(it.get("rationale", ""))[:300]})
    return {"suggestions": out, "label": "AI-generated estimates. No search volume, difficulty or CPC data.", "provider": res.provider, "model": res.model}
