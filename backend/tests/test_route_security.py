"""Security sweep over EVERY API route, discovered from the app itself.

1. Anonymous callers get 401 on every route except the public ones.
2. A second organisation gets 404 on every route that takes an id of the first organisation's data.
   Routes that need a request body must have a sample in SAMPLE_BODIES, so a new route without coverage fails this test
   instead of silently skipping the check (a body that fails validation would return 422 before ownership is ever checked).
"""
import re
from datetime import timedelta
from types import SimpleNamespace

import pytest
from conftest import register
from fakesite import FakeFetcher, good_site
from fastapi.routing import APIRoute

from app.ai import provider
from app.ai.provider import AIResult
from app.db import utcnow
from app.main import app

PUBLIC = {("POST", "/api/auth/register"), ("POST", "/api/auth/login"), ("POST", "/api/auth/logout"), ("GET", "/api/health")}
# Same-org lists that take no id are covered by the isolation tests in each module; here we look at id-taking routes.
PATH_VALUES = {"fmt": "csv", "table": "leads"}
EXEMPT = {("GET", "/api/export/{table}.csv")}  # returns the caller's own (empty) data, never a foreign record

SAMPLE_BODIES = {
    "POST /api/websites/{website_id}/audits": {},
    "PATCH /api/websites/{website_id}": {"name": "x"},
    "POST /api/websites/{website_id}/competitors": {"name": "x", "url": "https://rival.example.org"},
    "PATCH /api/leads/{lead_id}": {"name": "x"},
    "POST /api/leads/{lead_id}/activities": {"kind": "note", "text": "x"},
    "PATCH /api/clients/{client_id}": {"name": "x"},
    "POST /api/clients/{client_id}/activities": {"kind": "note", "text": "x"},
    "POST /api/clients/{client_id}/onboarding": {"title": "x"},
    "PATCH /api/onboarding/{item_id}": {"done": True},
    "PATCH /api/packages/{package_id}": {"name": "x"},
    "PATCH /api/proposals/{proposal_id}": {"title": "x"},
    "POST /api/proposals/{proposal_id}/status": {"status": "sent"},
    "PATCH /api/tasks/{task_id}": {"title": "x"},
    "PATCH /api/recommendations/{rec_id}": {"status": "accepted"},
    "PATCH /api/keywords/{keyword_id}": {"term": "x"},
    "PATCH /api/content/{entry_id}": {"title": "x"},
}


def _api_routes():
    # Newer FastAPI wraps each included router lazily; its APIRoutes live on `original_router` (paths already carry each router's prefix).
    for r in app.routes:
        for inner in getattr(getattr(r, "original_router", None), "routes", [r]):
            if isinstance(inner, APIRoute) and inner.path.startswith("/api"):
                yield inner


def routes():
    for r in _api_routes():
        for m in sorted(r.methods - {"HEAD", "OPTIONS"}):
            yield m, r


def url(route: APIRoute) -> str:
    return re.sub(r"\{(\w+)\}", lambda m: PATH_VALUES.get(m.group(1), "1"), route.path)


@pytest.fixture
def two_orgs(client, monkeypatch):
    """Org One owns one of everything (all with id 1). Returns the client logged in as Org Two."""
    monkeypatch.setattr(provider, "active", lambda: ("fake", "k", "m"))
    monkeypatch.setattr(provider, "complete", lambda *a, **k: AIResult('{"recommendations":[{"check_id":"http_status","interpretation":"i","recommendation":"r"}]}', "fake", "m"))
    d = lambda n: str(utcnow().date() + timedelta(days=n))  # noqa: E731
    register(client, "one@example.com", "Org One")
    post = lambda path, **b: client.post(path, json=b)  # noqa: E731
    site = post("/api/websites", name="S", url="example.com").json()
    app.state.fetcher_factory = lambda: FakeFetcher(good_site())
    audit = post(f"/api/websites/{site['id']}/audits").json()
    assert client.get(f"/api/audits/{audit['id']}").json()["status"] == "completed"
    post(f"/api/audits/{audit['id']}/recommendations")
    lead = post("/api/leads", name="L").json()
    cl = post("/api/clients", name="C").json()
    post(f"/api/clients/{cl['id']}/onboarding/start")
    post("/api/packages", name="P", price=1)
    post("/api/proposals", title="Q", client_id=cl["id"], items=[])
    post("/api/tasks", title="T", due_date=d(-1))
    post("/api/keywords", term="k")
    post(f"/api/websites/{site['id']}/competitors", name="R", url="rival.example.org")
    post("/api/content", title="E", kind="faq")
    post("/api/reports", title="R", client_id=cl["id"], period_start=d(-5), period_end=d(0), sections=["notes"])
    client.get("/api/notifications")  # creates the overdue-task notification
    assert lead["id"] == 1
    client.post("/api/auth/logout")
    register(client, "two@example.com", "Org Two")
    return client


def test_every_non_public_route_requires_authentication(client):
    seen = 0
    for method, route in routes():
        if (method, route.path) in PUBLIC:
            continue
        r = client.request(method, url(route), json={} if method in ("POST", "PATCH", "PUT") else None)
        assert r.status_code == 401, f"{method} {route.path} returned {r.status_code} without a session"
        seen += 1
    assert seen > 60  # guards against the discovery silently finding nothing


def test_every_route_taking_an_id_hides_other_organisations_data(two_orgs):
    c = two_orgs
    checked, missing = 0, []
    for method, route in routes():
        key = f"{method} {route.path}"
        if (method, route.path) in PUBLIC or (method, route.path) in EXEMPT or not re.search(r"\{\w*id\}", route.path):
            continue
        needs_body = route.body_field is not None
        if needs_body and key not in SAMPLE_BODIES:
            missing.append(key)
            continue
        r = c.request(method, url(route), json=SAMPLE_BODIES.get(key) if needs_body else None)
        assert r.status_code == 404, f"{key} returned {r.status_code} for another organisation's id: {r.text[:150]}"
        checked += 1
    assert not missing, f"Add a sample body in SAMPLE_BODIES for: {missing}"
    assert checked > 45


def test_audit_comparison_rejects_foreign_audits(two_orgs):
    assert two_orgs.get("/api/audits/compare", params={"base": 1, "target": 1}).status_code == 404


def test_the_data_really_exists_for_org_one(client):
    """Guards the sweep above: it would be meaningless if id 1 did not exist for the first organisation."""
    ns = SimpleNamespace()
    register(client, "one@example.com", "Org One")
    ns.site = client.post("/api/websites", json={"name": "S", "url": "example.com"})
    ns.lead = client.post("/api/leads", json={"name": "L"})
    assert ns.site.json()["id"] == 1 and ns.lead.json()["id"] == 1
    assert client.get("/api/leads/1").status_code == 200
