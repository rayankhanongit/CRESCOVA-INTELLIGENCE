import json

from conftest import H, register
from fastapi.testclient import TestClient
from sqlalchemy import event

from app.config import get_settings
from app.db import engine
from app.main import app
from app.security import COOKIE


def test_logout_revokes_the_session_on_the_server(client):
    register(client)
    stolen = client.cookies.get(COOKIE)
    assert client.get("/api/auth/me").status_code == 200
    assert client.post("/api/auth/logout").status_code == 204
    # an attacker (or another device) replaying the old token no longer gets in, even though it has not expired
    with TestClient(app, headers=H) as other:
        other.cookies.set(COOKIE, stolen)
        assert other.get("/api/auth/me").status_code == 401
    assert client.post("/api/auth/login", json={"email": "owner@example.com", "password": "correct-horse-battery"}).status_code == 200
    assert client.get("/api/auth/me").status_code == 200  # a fresh login after logout works


def test_logout_without_a_session_is_harmless(client):
    assert client.post("/api/auth/logout").status_code == 204


def test_forged_and_tampered_tokens_are_rejected(client):
    register(client)
    good = client.cookies.get(COOKIE)
    for bad in (good[:-3] + "abc", "not.a.jwt", ""):
        with TestClient(app, headers=H) as other:
            if bad:
                other.cookies.set(COOKIE, bad)
            assert other.get("/api/auth/me").status_code == 401


def test_production_forces_secure_cookies_and_hsts(client, monkeypatch):
    s = get_settings()
    monkeypatch.setattr(s, "environment", "production")
    monkeypatch.setattr(s, "cookie_secure", False)
    r = client.post("/api/auth/register", json={"email": "p@example.com", "password": "correct-horse-battery", "full_name": "P", "organisation_name": "P"})
    assert r.status_code == 201
    assert "secure" in r.headers["set-cookie"].lower()
    assert "max-age=31536000" in r.headers["strict-transport-security"]


def test_api_responses_carry_defensive_headers(authed):
    r = authed.get("/api/websites")
    assert r.headers["content-security-policy"] == "default-src 'none'; frame-ancestors 'none'"
    assert r.headers["x-content-type-options"] == "nosniff" and r.headers["x-frame-options"] == "DENY" and r.headers["cache-control"] == "no-store"
    assert "strict-transport-security" not in r.headers  # development over http


def test_oversized_request_bodies_are_rejected(authed):
    big = json.dumps({"name": "x", "notes": "A" * 1_100_000})
    r = authed.post("/api/leads", content=big, headers={"Content-Type": "application/json"})
    assert r.status_code == 413
    assert authed.get("/api/leads").json() == []


def test_unauthenticated_users_cannot_probe_for_data(client):
    # the same answer whether or not the record exists, so ids cannot be enumerated without a session
    assert client.get("/api/leads/1").status_code == client.get("/api/leads/99999").status_code == 401


def test_login_does_not_reveal_which_part_was_wrong(client):
    register(client)
    client.post("/api/auth/logout")
    wrong_pw = client.post("/api/auth/login", json={"email": "owner@example.com", "password": "wrong-password-1"})
    no_user = client.post("/api/auth/login", json={"email": "nobody@example.com", "password": "wrong-password-1"})
    assert wrong_pw.status_code == no_user.status_code == 401 and wrong_pw.json() == no_user.json()


def test_proposal_list_loads_line_items_in_a_constant_number_of_queries(authed):
    c = authed.post("/api/clients", json={"name": "C"}).json()
    for i in range(8):
        authed.post("/api/proposals", json={"title": f"P{i}", "client_id": c["id"], "items": [{"description": "x", "unit_price": 1}] * 3})
    statements: list[str] = []
    listener = lambda conn, cur, stmt, *a: statements.append(stmt)  # noqa: E731
    event.listen(engine, "before_cursor_execute", listener)
    try:
        r = authed.get("/api/proposals")
    finally:
        event.remove(engine, "before_cursor_execute", listener)
    assert len(r.json()) == 8 and all(len(p["items"]) == 3 for p in r.json())
    item_queries = [s for s in statements if "FROM proposal_items" in s]
    assert len(item_queries) == 1, f"{len(item_queries)} queries for line items (expected 1)"
