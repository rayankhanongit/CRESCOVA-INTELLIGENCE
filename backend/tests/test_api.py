from conftest import H, register
from fastapi.testclient import TestClient

from app.main import app

SITE = {"name": "Example Co", "url": "example.com", "category": "Plumbing", "market": "UK"}


def make_site(c):
    r = c.post("/api/websites", json=SITE)
    assert r.status_code == 201, r.text
    return r.json()


def audit(c, site_id, **body):
    r = c.post(f"/api/websites/{site_id}/audits", json=body)
    assert r.status_code == 202, r.text
    r = c.get(f"/api/audits/{r.json()['id']}")  # TestClient runs the background task before returning
    assert r.json()["status"] == "completed", r.json()
    return r.json()


def test_auth_flow_and_cookie_flags(client):
    assert client.get("/api/auth/me").status_code == 401
    r = client.post("/api/auth/register", json={"email": "a@example.com", "password": "correct-horse-battery", "full_name": "A", "organisation_name": "Org"})
    assert r.status_code == 201
    cookie = r.headers["set-cookie"].lower()
    assert "httponly" in cookie and "samesite=lax" in cookie
    assert client.get("/api/auth/me").json()["organisation_name"] == "Org"
    client.post("/api/auth/logout")
    assert client.get("/api/auth/me").status_code == 401
    assert client.post("/api/auth/login", json={"email": "a@example.com", "password": "wrong-password"}).status_code == 401
    assert client.post("/api/auth/login", json={"email": "a@example.com", "password": "correct-horse-battery"}).status_code == 200


def test_weak_password_and_duplicate_email_rejected(client):
    bad = {"email": "a@example.com", "password": "short", "full_name": "A", "organisation_name": "O"}
    assert client.post("/api/auth/register", json=bad).status_code == 422
    register(client)
    assert client.post("/api/auth/register", json={**bad, "email": "owner@example.com", "password": "long-enough-password"}).status_code == 409


def test_login_rate_limited(client):
    register(client)
    codes = [client.post("/api/auth/login", json={"email": "owner@example.com", "password": "nope-nope-nope"}).status_code for _ in range(12)]
    assert 429 in codes


def test_csrf_header_required_for_mutations():
    with TestClient(app) as bare:  # no X-Requested-With header
        r = bare.post("/api/auth/register", json={"email": "a@example.com", "password": "correct-horse-battery", "full_name": "A", "organisation_name": "O"})
        assert r.status_code == 403


def test_endpoints_require_auth(client):
    for path in ("/api/websites", "/api/dashboard/overview", "/api/audits/1", "/api/pages/1", "/api/system/status"):
        assert client.get(path).status_code == 401, path


def test_website_crud_and_validation(authed):
    s = make_site(authed)
    assert s["url"] == "https://example.com/" and s["current_score"] is None
    assert authed.post("/api/websites", json=SITE).status_code == 409
    assert authed.post("/api/websites", json={"name": "", "url": "x.com"}).status_code == 422
    assert authed.patch(f"/api/websites/{s['id']}", json={"name": "Renamed", "market": "US"}).json()["name"] == "Renamed"
    assert len(authed.get("/api/websites").json()) == 1
    assert authed.delete(f"/api/websites/{s['id']}").status_code == 204
    assert authed.get(f"/api/websites/{s['id']}").status_code == 404


def test_full_seo_workflow(authed):
    s = make_site(authed)
    a = audit(authed, s["id"])
    assert a["pages_crawled"] == 3 and 0 < a["score"] < 100
    assert a["critical_count"] >= 2  # /missing 404 + broken internal link
    assert set(a["category_scores"]) == {"technical", "onpage", "content", "indexability", "linking", "structured"}
    assert authed.get(f"/api/websites/{s['id']}").json()["current_score"] == a["score"]

    findings = authed.get(f"/api/audits/{a['id']}/findings", params={"severity": "critical"}).json()
    assert findings and all(f["severity"] == "critical" and f["explanation"] and f["recommendation"] and f["why_it_matters"] for f in findings)

    pages = authed.get(f"/api/audits/{a['id']}/pages").json()
    home = next(p for p in pages if p["url"] == "https://example.com/")
    detail = authed.get(f"/api/pages/{home['id']}").json()
    assert detail["title"].startswith("Home") and detail["data"]["h1s"] == ["Plumbing services"] and detail["score"] is not None

    for fmt, ctype in (("csv", "text/csv"), ("json", "application/json"), ("pdf", "application/pdf")):
        r = authed.get(f"/api/audits/{a['id']}/export.{fmt}")
        assert r.status_code == 200 and r.headers["content-type"].startswith(ctype), fmt
    assert authed.get(f"/api/audits/{a['id']}/export.pdf").content.startswith(b"%PDF")
    assert authed.get(f"/api/audits/{a['id']}/export.xls").status_code == 404

    ov = authed.get("/api/dashboard/overview").json()
    assert ov["seo"]["websites"] == 1 and ov["seo"]["audits_total"] == 1 and ov["seo"]["average_score"] == a["score"]
    assert ov["business"] is None  # no fabricated CRM numbers


def test_audit_comparison_new_resolved_persistent(authed):
    from fakesite import FakeFetcher, good_site
    s = make_site(authed)
    before = good_site()  # /about has no meta description in both audits -> a persistent issue
    before["https://example.com/about"] = (200, before["https://example.com/about"][1].replace('<meta name="description"', '<meta name="x-none"'), "text/html")
    app.state.fetcher_factory = lambda: FakeFetcher(before)
    first = audit(authed, s["id"])
    fixed = dict(before)
    fixed["https://example.com/"] = (200, before["https://example.com/"][1].replace('<a href="/missing">Gone</a>', ""), "text/html")
    app.state.fetcher_factory = lambda: FakeFetcher(fixed)
    second = audit(authed, s["id"])
    diff = authed.get("/api/audits/compare", params={"base": first["id"], "target": second["id"]}).json()
    assert diff["score_delta"] > 0
    assert any(f["check_id"] == "broken_internal_links" for f in diff["resolved"])
    assert diff["persistent"] and not any(f["check_id"] == "broken_internal_links" for f in diff["new"])
    ov = authed.get("/api/dashboard/overview").json()
    assert ov["seo"]["improvements_completed"] >= 1


def test_single_url_audit_and_foreign_url_rejected(authed):
    s = make_site(authed)
    a = audit(authed, s["id"], mode="url", url="https://example.com/about")
    assert a["pages_crawled"] == 1 and a["mode"] == "url"
    r = authed.post(f"/api/websites/{s['id']}/audits", json={"mode": "url", "url": "https://evil.example.org/"})
    assert r.status_code == 422


def test_organisation_isolation(client):
    register(client, "one@example.com", "Org One")
    s = make_site(client)
    a = audit(client, s["id"])
    page_id = client.get(f"/api/audits/{a['id']}/pages").json()[0]["id"]
    client.post("/api/auth/logout")

    register(client, "two@example.com", "Org Two")
    assert client.get("/api/websites").json() == []
    for path in (f"/api/websites/{s['id']}", f"/api/websites/{s['id']}/audits", f"/api/audits/{a['id']}", f"/api/audits/{a['id']}/findings",
                 f"/api/audits/{a['id']}/pages", f"/api/pages/{page_id}", f"/api/audits/{a['id']}/export.csv"):
        assert client.get(path).status_code == 404, path
    assert client.delete(f"/api/websites/{s['id']}").status_code == 404
    assert client.post(f"/api/websites/{s['id']}/audits", json={}).status_code == 404
    assert client.delete(f"/api/audits/{a['id']}").status_code == 404
    # same URL can be added independently by another organisation
    assert client.post("/api/websites", json=SITE).status_code == 201


def test_concurrent_audit_limit(authed, monkeypatch):
    from app.db import SessionLocal
    from app.models import SeoAudit
    s = make_site(authed)
    with SessionLocal() as db:
        for _ in range(2):
            db.add(SeoAudit(organisation_id=1, website_id=s["id"], status="running", target_url=s["url"]))
        db.commit()
    assert authed.post(f"/api/websites/{s['id']}/audits", json={}).status_code == 429


def test_csv_export_neutralises_formula_injection():
    from app.models import SeoFinding
    from app.seo.report import findings_csv
    f = SeoFinding(severity="info", category="x", name="n", url="https://e.com", explanation="e", why_it_matters="w", recommendation="r", evidence="=HYPERLINK(\"http://evil\")")
    assert "'=HYPERLINK" in findings_csv([f])


def test_health_and_error_hiding(client):
    assert client.get("/api/health").json() == {"status": "ok"}
