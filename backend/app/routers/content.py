from datetime import date
from typing import Literal

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..ai.service import run_ai, untrusted
from ..db import get_db
from ..models import Client, ContentEntry, User
from ..schemas import ORM
from ..security import current_user
from .common import owned, ref

router = APIRouter(prefix="/api/content", tags=["content"])

KINDS = {
    "blog_article": "a blog article with a headline, short intro, subheadings and a conclusion",
    "seo_page": "SEO page copy with an H1, subheadings and body text",
    "instagram_caption": "an Instagram caption with a hook and relevant hashtags",
    "facebook_post": "a Facebook post",
    "linkedin_post": "a LinkedIn post",
    "video_script": "a short-form video script with hook, beats and call to action",
    "content_ideas": "a numbered list of content ideas with a one-line angle each",
    "content_calendar": "a 4-week content calendar as a list of dated post ideas",
    "meta_title": "five alternative meta titles (30-60 characters each)",
    "meta_description": "five alternative meta descriptions (70-160 characters each)",
    "faq": "an FAQ with questions and concise answers",
    "service_description": "a website service description",
}
Kind = Literal[tuple(KINDS)]  # type: ignore[valid-type]
Status = Literal["idea", "draft", "in_review", "approved", "scheduled", "published"]


class GenerateIn(BaseModel):
    kind: Kind
    topic: str = Field(min_length=1, max_length=500)
    audience: str = Field(default="", max_length=300)
    brand_voice: str = Field(default="", max_length=300)
    platform: str = Field(default="", max_length=40)
    keywords: str = Field(default="", max_length=300)
    length: str = Field(default="", max_length=60)
    objective: str = Field(default="", max_length=300)
    previous_text: str = Field(default="", max_length=20000)
    revise_instruction: str = Field(default="", max_length=1000)


class EntryIn(BaseModel):
    title: str = Field(min_length=1, max_length=300)
    kind: Kind
    platform: str = Field(default="", max_length=40)
    body: str = Field(default="", max_length=50000)
    params: dict = Field(default_factory=dict)
    ai_generated: bool = False
    status: Status = "draft"
    client_id: int | None = None
    publish_date: date | None = None


class EntryPatch(EntryIn):
    title: str | None = Field(default=None, min_length=1, max_length=300)
    kind: Kind | None = None


class EntryOut(ORM, EntryIn):
    id: int


@router.post("/generate")
def generate(body: GenerateIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Returns text for you to edit. Nothing is saved or published until you save it."""
    brief = "\n".join(f"{label}: {untrusted(v, 500)}" for label, v in (("Topic", body.topic), ("Audience", body.audience), ("Brand voice", body.brand_voice),
                                                                      ("Platform", body.platform), ("Keywords to include naturally", body.keywords),
                                                                      ("Desired length", body.length), ("Objective", body.objective)) if v)
    prompt = f"Write {KINDS[body.kind]}.\n{brief}\n"
    if body.previous_text and body.revise_instruction:
        prompt += f"\nRevise this earlier draft: {untrusted(body.previous_text, 12000)}\nRevision request: {untrusted(body.revise_instruction, 600)}\n"
    prompt += "\nWrite plain text only. Do not invent statistics, awards, prices or client names that were not provided."
    res, _ = run_ai(db, user, f"content_{body.kind}", prompt)
    return {"text": res.text.strip(), "ai_generated": True, "provider": res.provider, "model": res.model}


@router.get("", response_model=list[EntryOut])
def list_entries(status: str = Query("", max_length=15), client_id: int | None = None, user: User = Depends(current_user), db: Session = Depends(get_db)):
    q = select(ContentEntry).where(ContentEntry.organisation_id == user.organisation_id)
    if status:
        q = q.where(ContentEntry.status == status)
    if client_id is not None:
        q = q.where(ContentEntry.client_id == client_id)
    return db.scalars(q.order_by(ContentEntry.updated_at.desc(), ContentEntry.id.desc()).limit(500)).all()


@router.post("", response_model=EntryOut, status_code=201)
def save_entry(body: EntryIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    ref(db, user, Client, body.client_id)
    e = ContentEntry(organisation_id=user.organisation_id, **body.model_dump())
    db.add(e)
    db.commit()
    return e


@router.patch("/{entry_id}", response_model=EntryOut)
def update_entry(entry_id: int, body: EntryPatch, user: User = Depends(current_user), db: Session = Depends(get_db)):
    e = owned(db, user, ContentEntry, entry_id)
    data = body.model_dump(exclude_unset=True)
    ref(db, user, Client, data.get("client_id"))
    for k, v in data.items():
        setattr(e, k, v)
    db.commit()
    return e


@router.delete("/{entry_id}", status_code=204)
def delete_entry(entry_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    db.delete(owned(db, user, ContentEntry, entry_id))
    db.commit()
