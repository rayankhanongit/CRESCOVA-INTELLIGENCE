import csv
import io
import json
from datetime import timedelta

from conftest import register
from fakesite import FakeFetcher, good_site

from app.db import SessionLocal, utcnow
from app.main import app
from app.models import Notification, Task

SITE = {"name": "Example Co", "url": "example.com", "category": "Plumbing", "market": "UK"}
d = lambda n=0: str(utcnow().date() + timedelta(days=n))  # noqa: E731


def mk(c, path, **body):
    r = c.post(path, json=body)
    assert r.status_code == 201, r.text
    return r.json()


def audit(c, site_id, factory=None):
    if factory:
        app.state.fetcher_factory = factory
    r = c.post(f"/api/websites/{site_id}/audits", json={})
    a = c.get(f"/api/audits/{r.json()['id']}").json()
    assert a["status"] == "completed", a
    return a


def body(**kw):
    return {"title": "Monthly report", "period_start": d(-30), "period_end": d(1), "sections": ["seo"], **kw}


# ------------------------------------------------------------------ content calendar
def test_calendar_filters_media_and_validation(authed):
    client = mk(authed, "/api/clients", name="Acme")
    a = mk(authed, "/api/content", title="Launch post", kind="social_post", platform="Instagram", status="scheduled", publish_date=d(2), client_id=client["id"], media=["https://cdn.example.com/a.jpg", "hero.png"])
    mk(authed, "/api/content", title="Blog", kind="blog_article", platform="Blog", status="idea", publish_date=d(40))
    mk(authed, "/api/content", title="Undated idea", kind="social_post", platform="Instagram", status="idea")
    assert a["media"] == ["https://cdn.example.com/a.jpg", "hero.png"]
    titles = lambda **p: [e["title"] for e in authed.get("/api/content", params=p).json()]  # noqa: E731
    assert titles(start=d(0), end=d(10)) == ["Launch post"]  # undated entries only appear without a range
    assert titles(platform="Instagram") == ["Launch post", "Undated idea"]  # dated first, then undated
    assert titles(client_id=client["id"]) == ["Launch post"]
    assert authed.post("/api/content", json={"title": "x", "kind": "social_post", "media": ["a"] * 11}).status_code == 422
    assert authed.post("/api/content", json={"title": "x", "kind": "social_post", "media": [""]}).status_code == 422
    assert authed.patch(f"/api/content/{a['id']}", json={"publish_date": d(5), "status": "approved"}).json()["publish_date"] == d(5)


# ------------------------------------------------------------------ notifications
def test_notifications_are_generated_deduplicated_and_in_app_only(authed):
    s = mk(authed, "/api/websites", **SITE)
    a = audit(authed, s["id"])
    mk(authed, "/api/tasks", title="Late task", due_date=d(-2))
    mk(authed, "/api/tasks", title="Soon task", due_date=d(1))
    mk(authed, "/api/tasks", title="Far task", due_date=d(30))
    done = mk(authed, "/api/tasks", title="Done late", due_date=d(-5))
    authed.patch(f"/api/tasks/{done['id']}", json={"done": True})
    lead = mk(authed, "/api/leads", name="Ann", next_follow_up=d(-1))
    mk(authed, "/api/leads", name="Won", next_follow_up=d(-1), status="new")
    authed.post(f"/api/leads/{lead['id']}/convert")  # converted leads need no follow-up
    mk(authed, "/api/content", title="Today post", kind="social_post", status="scheduled", publish_date=d(0))
    mk(authed, "/api/content", title="Today idea", kind="social_post", status="idea", publish_date=d(0))
    mk(authed, "/api/clients", name="C")
    p = mk(authed, "/api/proposals", title="Old quote", client_id=1, valid_until=d(-1), items=[])
    assert p["id"]

    first = authed.get("/api/notifications").json()
    titles = sorted(n["title"] for n in first["items"])
    assert any(t.startswith("Task overdue: Late task") for t in titles) and any("Soon task" in t for t in titles)
    assert not any("Far task" in t or "Done late" in t or "Today idea" in t or "Ann" in t for t in titles)
    assert any("Follow up with Won" in t for t in titles) and any("Content due today: Today post" in t for t in titles)
    assert any(f"Audit finished for Example Co: score {a['score']}" in t for t in titles) and any("Proposal passed its valid-until date" in t for t in titles)
    assert first["unread"] == len(first["items"])

    again = authed.get("/api/notifications").json()
    assert len(again["items"]) == len(first["items"])  # syncing twice creates no duplicates

    nid = first["items"][0]["id"]
    assert authed.post(f"/api/notifications/{nid}/read").status_code == 204
    assert authed.get("/api/notifications").json()["unread"] == first["unread"] - 1
    assert authed.post("/api/notifications/read-all").status_code == 204
    assert authed.get("/api/notifications").json()["unread"] == 0
    mk(authed, "/api/tasks", title="Another late", due_date=d(-1))
    assert authed.get("/api/notifications").json()["unread"] == 1  # only the new one


def test_notifications_are_isolated(client):
    register(client, "one@example.com", "One")
    mk(client, "/api/tasks", title="Private late task", due_date=d(-1))
    nid = client.get("/api/notifications").json()["items"][0]["id"]
    client.post("/api/auth/logout")
    register(client, "two@example.com", "Two")
    assert client.get("/api/notifications").json() == {"unread": 0, "items": []}
    assert client.post(f"/api/notifications/{nid}/read").status_code == 404
    with SessionLocal() as db:
        assert db.query(Notification).filter(Notification.organisation_id == 1).count() == 1


# ------------------------------------------------------------------ reports
def test_report_snapshot_sources_and_exports(authed):
    s = mk(authed, "/api/websites", **SITE)
    first = audit(authed, s["id"])
    fixed = good_site()
    fixed["https://example.com/"] = (200, fixed["https://example.com/"][1].replace('<a href="/missing">Gone</a>', ""), "text/html")
    second = audit(authed, s["id"], lambda: FakeFetcher(fixed))
    assert second["score"] > first["score"]
    client = mk(authed, "/api/clients", name="Acme", status="active")
    authed.post(f"/api/clients/{client['id']}/onboarding/start")
    authed.patch("/api/onboarding/1", json={"done": True})
    kw_manual = mk(authed, "/api/keywords", term="plumber london", website_id=s["id"], search_volume=900, metrics_source="Search Console export")
    mk(authed, "/api/keywords", term="boiler tips", website_id=s["id"], source="ai_estimate")
    t = mk(authed, "/api/tasks", title="Fix 404s", client_id=client["id"], website_id=s["id"])
    authed.patch(f"/api/tasks/{t['id']}", json={"done": True})
    mk(authed, "/api/content", title="Post", kind="social_post", status="published", publish_date=d(-1), client_id=client["id"])
    assert kw_manual["search_volume"] == 900

    rep = mk(authed, "/api/reports", **body(website_id=s["id"], client_id=client["id"], sections=["seo", "keywords", "tasks", "progress", "content", "notes", "recommendations"], notes="Great month."))
    sec = rep["data"]["sections"]
    assert sec["seo"]["score"] == second["score"] and sec["seo"]["score_change"] > 0 and sec["seo"]["first_score"] == first["score"]
    assert not any("broken internal" in i["issue"].lower() for i in sec["seo"]["open_issues"]) and any("broken internal" in i.lower() for i in sec["seo"]["resolved"])
    assert "Measured" in sec["seo"]["source"] and "Entered or imported" in sec["keywords"]["source"] and "AI-generated" in sec["recommendations"]["source"]
    by = {k["term"]: k for k in sec["keywords"]["items"]}
    assert by["plumber london"]["search_volume"] == 900 and by["boiler tips"]["search_volume"] is None and by["boiler tips"]["origin"] == "ai_estimate"  # never filled in
    assert [x["title"] for x in sec["tasks"]["completed_in_period"]] == ["Fix 404s"] and sec["progress"]["onboarding_done"] == 1
    assert sec["notes"]["text"] == "Great month." and sec["content"]["by_status"] == {"published": 1}
    assert "Not connected" in rep["data"]["integrations"]["google_analytics_4"] and "Not connected" in rep["data"]["integrations"]["google_search_console"]
    assert "traffic" not in json.dumps(sec).lower().replace("traffic, rankings", "")

    # the report is a snapshot: later changes don't alter it
    authed.patch(f"/api/keywords/{kw_manual['id']}", json={"search_volume": 1})
    stored = {k["term"]: k for k in authed.get(f"/api/reports/{rep['id']}").json()["data"]["sections"]["keywords"]["items"]}
    assert stored["plumber london"]["search_volume"] == 900

    pdf = authed.get(f"/api/reports/{rep['id']}/export.pdf")
    assert pdf.status_code == 200 and pdf.content.startswith(b"%PDF") and pdf.headers["content-type"] == "application/pdf"
    rows = list(csv.reader(io.StringIO(authed.get(f"/api/reports/{rep['id']}/export.csv").text)))
    assert rows[0] == ["section", "item", "value", "data_source"] and any(r[0] == "seo" and r[1] == "score" for r in rows) and all(r[3] for r in rows[1:])
    j = authed.get(f"/api/reports/{rep['id']}/export.json").json()
    assert j["title"] == "Monthly report" and j["sections"]["seo"]["score"] == second["score"]
    assert authed.get(f"/api/reports/{rep['id']}/export.xls").status_code == 404
    assert [r["id"] for r in authed.get("/api/reports").json()] == [rep["id"]]
    assert authed.delete(f"/api/reports/{rep['id']}").status_code == 204


def test_report_period_and_scope_rules(authed):
    s = mk(authed, "/api/websites", **SITE)
    audit(authed, s["id"])
    assert authed.post("/api/reports", json=body(website_id=s["id"], period_start=d(5), period_end=d(1))).status_code == 422
    assert authed.post("/api/reports", json=body(website_id=s["id"], period_start=d(-400), period_end=d(0))).status_code == 422
    assert authed.post("/api/reports", json=body()).status_code == 422  # neither website nor client
    assert authed.post("/api/reports", json=body(website_id=s["id"], sections=["bogus"])).status_code == 422
    assert authed.post("/api/reports", json=body(website_id=s["id"], sections=[])).status_code == 422

    old = mk(authed, "/api/reports", **body(website_id=s["id"], period_start=d(-400 + 100), period_end=d(-200)))  # a period before any audit
    assert "No full-site audit" in old["data"]["sections"]["seo"]["note"]
    c = mk(authed, "/api/clients", name="C")
    only_client = mk(authed, "/api/reports", **body(client_id=c["id"], sections=["seo", "keywords", "progress", "tasks"]))
    assert "seo" not in only_client["data"]["sections"] and "keywords" not in only_client["data"]["sections"]
    assert sorted(x.split(":")[0] for x in only_client["data"]["skipped"]) == ["keywords", "seo"]  # explained, not silently dropped
    assert {"tasks", "progress"} <= set(only_client["data"]["sections"])


def test_reports_are_isolated_and_references_checked(client):
    register(client, "one@example.com", "One")
    s = mk(client, "/api/websites", **SITE)
    c = mk(client, "/api/clients", name="Secret client")
    rep = mk(client, "/api/reports", **body(website_id=s["id"], client_id=c["id"], sections=["tasks"]))
    client.post("/api/auth/logout")
    register(client, "two@example.com", "Two")
    assert client.get("/api/reports").json() == []
    for fmt in ("pdf", "csv", "json"):
        assert client.get(f"/api/reports/{rep['id']}/export.{fmt}").status_code == 404
    assert client.get(f"/api/reports/{rep['id']}").status_code == 404 and client.delete(f"/api/reports/{rep['id']}").status_code == 404
    assert client.post("/api/reports", json=body(website_id=s["id"])).status_code == 404
    assert client.post("/api/reports", json=body(client_id=c["id"], sections=["tasks"])).status_code == 404


def test_csv_report_neutralises_formulas(authed):
    c = mk(authed, "/api/clients", name="C")
    rep = mk(authed, "/api/reports", **body(client_id=c["id"], sections=["notes"], notes="=HYPERLINK(\"http://evil\")"))
    assert "'=HYPERLINK" in authed.get(f"/api/reports/{rep['id']}/export.csv").text
    assert authed.get(f"/api/reports/{rep['id']}/export.pdf").status_code == 200


# ------------------------------------------------------------------ data export
def test_table_exports_are_scoped_and_formula_safe(client):
    register(client, "one@example.com", "One")
    mk(client, "/api/leads", name="=cmd|calc", email="a@example.com")
    c = mk(client, "/api/clients", name="C1", monthly_value=50)
    mk(client, "/api/proposals", title="Quote", client_id=c["id"], items=[{"description": "x", "quantity": 2, "unit_price": 10}])
    mk(client, "/api/tasks", title="T")
    lead_csv = client.get("/api/export/leads.csv").text
    assert "'=cmd|calc" in lead_csv and lead_csv.splitlines()[0].startswith("id,name,email")
    prop = list(csv.DictReader(io.StringIO(client.get("/api/export/proposals.csv").text)))
    assert len(prop) == 1 and float(prop[0]["total"]) == 20.0 and prop[0]["title"] == "Quote"
    for t in ("clients", "tasks", "keywords", "content"):
        assert client.get(f"/api/export/{t}.csv").status_code == 200
    assert client.get("/api/export/users.csv").status_code == 404
    client.post("/api/auth/logout")
    register(client, "two@example.com", "Two")
    for t in ("leads", "clients", "tasks", "proposals"):
        assert len(client.get(f"/api/export/{t}.csv").text.strip().splitlines()) == 1, t  # header only
    assert client.get("/api/export/leads.csv", headers={"X-Requested-With": "crescova"}).status_code == 200
    with SessionLocal() as db:
        assert db.query(Task).count() == 1
