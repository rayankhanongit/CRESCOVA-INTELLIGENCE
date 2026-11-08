from datetime import timedelta
from types import SimpleNamespace

from conftest import register

from app.crm.qualify import qualify
from app.db import utcnow


def today():
    return utcnow().date()


def mk(c, path, **body):
    r = c.post(path, json=body)
    assert r.status_code == 201, r.text
    return r.json()


def lead(c, **kw):
    return mk(c, "/api/leads", **{"name": "Pat Lee", "email": "pat@example.com", "service_interest": "SEO", "budget": 2000, "source": "Referral", **kw})


def proposal(c, lead_id=None, client_id=None, items=None, **kw):
    items = items if items is not None else [{"description": "SEO retainer", "quantity": 2, "unit_price": 100.10}, {"description": "Setup", "quantity": 1, "unit_price": 50}]
    return mk(c, "/api/proposals", title="SEO plan", lead_id=lead_id, client_id=client_id, items=items, **kw)


# ---------------------------------------------------------------- leads
def test_lead_crud_search_filters_and_timeline(authed):
    a, b = lead(authed, name="Ana Ruiz", company="Acme", source="Web"), lead(authed, name="Bo Chen", source="Referral")
    names = lambda r: sorted(x["name"] for x in r.json())  # noqa: E731
    assert names(authed.get("/api/leads", params={"q": "acme"})) == ["Ana Ruiz"]
    assert names(authed.get("/api/leads", params={"source": "Referral"})) == ["Bo Chen"]
    assert authed.get("/api/leads", params={"q": "%"}).json() == []  # LIKE wildcards are escaped, not interpreted

    r = authed.patch(f"/api/leads/{a['id']}", json={"status": "contacted", "priority": "high", "next_follow_up": str(today())})
    assert r.json()["status"] == "contacted" and r.json()["priority"] == "high"
    assert names(authed.get("/api/leads", params={"status": "contacted"})) == ["Ana Ruiz"]
    assert authed.patch(f"/api/leads/{a['id']}", json={"status": "converted"}).status_code == 422  # only via Convert

    authed.post(f"/api/leads/{a['id']}/activities", json={"kind": "call", "text": "Discussed scope"})
    assert authed.get(f"/api/leads/{a['id']}").json()["last_contacted_at"] is not None
    assert authed.get(f"/api/leads/{b['id']}").json()["last_contacted_at"] is None
    kinds = [x["kind"] for x in authed.get(f"/api/leads/{a['id']}/activities").json()]
    assert kinds[:2] == ["call", "status_change"] and "note" in kinds

    assert authed.delete(f"/api/leads/{a['id']}").status_code == 204
    assert authed.get(f"/api/leads/{a['id']}").status_code == 404


def test_lead_validation(authed):
    base = {"name": "X"}
    assert authed.post("/api/leads", json={**base, "email": "not-an-email"}).status_code == 422
    assert authed.post("/api/leads", json={**base, "budget": -5}).status_code == 422
    assert authed.post("/api/leads", json={**base, "website": "javascript:alert(1)"}).status_code == 422
    assert authed.post("/api/leads", json={"name": ""}).status_code == 422
    assert mk(authed, "/api/leads", **base, website="example.com")["website"] == "https://example.com"


def test_rules_qualification_scores_and_flags_gaps():
    pkgs = [SimpleNamespace(name="SEO Growth", description="Monthly SEO work", price=500)]
    strong = SimpleNamespace(name="A", company="Co", email="a@x.com", phone="", website="https://x.com", service_interest="SEO audit", notes="Need a quote ASAP", budget=1500, status="contacted")
    q = qualify(strong, pkgs, utcnow())
    assert q["source"] == "rules" and "not AI" in q["label"] and q["suggested_priority"] == "high" and q["service_fit"] == ["SEO Growth"]
    weak = SimpleNamespace(name="B", company="", email="", phone="", website="", service_interest="", notes="just looking", budget=None, status="new")
    q = qualify(weak, pkgs, utcnow())
    assert q["suggested_priority"] == "low" and "reach this lead" in q["next_action"]
    assert any("budget" in x.lower() for x in q["follow_up_questions"])
    none = qualify(strong, [], utcnow())  # no packages configured: says so rather than guessing
    assert any("can't be" in s["label"] for s in none["signals"])


def test_qualify_endpoint_only_suggests(authed):
    mk(authed, "/api/packages", name="SEO Growth", description="SEO", price=500, billing="monthly")
    lead_ = lead(authed)
    r = authed.post(f"/api/leads/{lead_['id']}/qualify").json()
    assert r["qualification"]["suggested_priority"] in ("low", "medium", "high")
    assert r["status"] == "new" and r["priority"] == ""  # never changes status or the person's own priority
    authed.patch(f"/api/leads/{lead_['id']}", json={"priority": "low"})
    again = authed.post(f"/api/leads/{lead_['id']}/qualify").json()
    assert again["priority"] == "low"  # the override survives a re-run
    assert "qualification" in [x["kind"] for x in authed.get(f"/api/leads/{lead_['id']}/activities").json()]


# ---------------------------------------------------------------- clients and onboarding
def test_convert_lead_and_client_history(authed):
    lead_ = lead(authed)
    client = authed.post(f"/api/leads/{lead_['id']}/convert")
    assert client.status_code == 201 and client.json()["status"] == "onboarding" and client.json()["source_lead_id"] == lead_["id"]
    got = authed.get(f"/api/leads/{lead_['id']}").json()
    assert got["status"] == "converted" and got["client_id"] == client.json()["id"]
    assert authed.post(f"/api/leads/{lead_['id']}/convert").status_code == 409
    history = " | ".join(x["text"] for x in authed.get(f"/api/clients/{client.json()['id']}/history").json())
    assert "Converted from lead" in history and "Lead created" in history  # includes the lead's own timeline


def test_client_crud_validation_and_onboarding_checklist(authed):
    assert authed.post("/api/clients", json={"name": "C", "contract_start": "2026-05-01", "contract_end": "2026-04-01"}).status_code == 422
    assert authed.post("/api/clients", json={"name": "C", "website": "javascript:x"}).status_code == 422
    c = mk(authed, "/api/clients", name="Acme", monthly_value=750, status="active")
    assert authed.patch(f"/api/clients/{c['id']}", json={"contract_start": "2026-05-01", "contract_end": "2026-04-01"}).status_code == 422
    assert authed.patch(f"/api/clients/{c['id']}", json={"status": "paused"}).json()["status"] == "paused"
    assert authed.get("/api/clients", params={"status": "paused"}).json()[0]["name"] == "Acme"

    items = authed.post(f"/api/clients/{c['id']}/onboarding/start").json()
    assert len(items) == 9 and not any(i["done"] for i in items)
    assert "never plain-text passwords" in next(i["title"] for i in items if "access" in i["title"].lower())
    assert authed.post(f"/api/clients/{c['id']}/onboarding/start").status_code == 409
    done = authed.patch(f"/api/onboarding/{items[0]['id']}", json={"done": True}).json()
    assert done["done"] and done["done_at"]
    extra = mk(authed, f"/api/clients/{c['id']}/onboarding", title="Sign NDA")
    assert extra["position"] == 9
    authed.patch(f"/api/onboarding/{extra['id']}", json={"title": "Sign NDA and DPA"})
    prog = authed.get(f"/api/clients/{c['id']}").json()
    assert (prog["onboarding_done"], prog["onboarding_total"]) == (1, 10)
    assert authed.delete(f"/api/onboarding/{extra['id']}").status_code == 204
    assert authed.get(f"/api/clients/{c['id']}").json()["onboarding_total"] == 9


# ---------------------------------------------------------------- proposals
def test_proposal_totals_status_flow_pdf_and_expiry(authed):
    lead_ = lead(authed, name="Pat <b>Lee</b> & Co")
    assert authed.post("/api/proposals", json={"title": "No recipient"}).status_code == 422
    p = proposal(authed, lead_id=lead_["id"], discount_percent=10, valid_until=str(today() + timedelta(days=30)),
                 description="<script>alert(1)</script> & more")
    assert (p["subtotal"], p["discount_amount"], p["total"]) == (250.2, 25.02, 225.18)
    assert p["recipient_name"] == lead_["name"] and p["items"][0]["line_total"] == 200.2

    edited = authed.patch(f"/api/proposals/{p['id']}", json={"discount_percent": 0, "items": [{"description": "Only", "quantity": 1, "unit_price": 10}]}).json()
    assert edited["total"] == 10 and len(edited["items"]) == 1

    empty = proposal(authed, lead_id=lead_["id"], items=[])
    assert authed.post(f"/api/proposals/{empty['id']}/status", json={"status": "sent"}).status_code == 422

    sent = authed.post(f"/api/proposals/{p['id']}/status", json={"status": "sent"}).json()
    assert sent["status"] == "sent" and sent["sent_at"]
    assert authed.get(f"/api/leads/{lead_['id']}").json()["status"] == "proposal_sent"
    assert authed.patch(f"/api/proposals/{p['id']}", json={"title": "x"}).status_code == 409  # locked once sent
    assert authed.post(f"/api/proposals/{p['id']}/status", json={"status": "accepted"}).json()["status"] == "accepted"

    pdf = authed.get(f"/api/proposals/{p['id']}/pdf")
    assert pdf.status_code == 200 and pdf.headers["content-type"] == "application/pdf" and pdf.content.startswith(b"%PDF")

    old = proposal(authed, lead_id=lead_["id"], valid_until=str(today() - timedelta(days=1)))
    assert authed.get(f"/api/proposals/{old['id']}").json()["status"] == "expired"
    assert [x["id"] for x in authed.get("/api/proposals", params={"status": "accepted"}).json()] == [p["id"]]


def test_packages_are_configurable_and_deleting_keeps_proposal_lines(authed):
    pkg = mk(authed, "/api/packages", name="Starter", price=300, billing="monthly")
    assert authed.patch(f"/api/packages/{pkg['id']}", json={"price": 350}).json()["price"] == 350
    client = mk(authed, "/api/clients", name="C")
    p = proposal(authed, client_id=client["id"], items=[{"package_id": pkg["id"], "description": "Starter", "quantity": 1, "unit_price": 350}])
    assert authed.delete(f"/api/packages/{pkg['id']}").status_code == 204
    kept = authed.get(f"/api/proposals/{p['id']}").json()
    assert kept["total"] == 350 and kept["items"][0]["package_id"] is None


def test_organisation_currency(authed):
    assert authed.patch("/api/organisation", json={"currency": "eur"}).status_code == 422
    assert authed.patch("/api/organisation", json={"currency": "EUR"}).json()["currency"] == "EUR"
    assert authed.get("/api/auth/me").json()["organisation_currency"] == "EUR"


# ---------------------------------------------------------------- tasks and dashboard
def test_tasks_overdue_done_assignment_and_team(authed):
    me = authed.get("/api/auth/me").json()
    assert authed.get("/api/team").json() == [{"id": me["id"], "full_name": "Owner"}]
    late = mk(authed, "/api/tasks", title="Late", due_date=str(today() - timedelta(days=2)), assignee_id=me["id"], priority="high")
    mk(authed, "/api/tasks", title="Later", due_date=str(today() + timedelta(days=5)))
    undated = mk(authed, "/api/tasks", title="Undated")
    assert [t["title"] for t in authed.get("/api/tasks", params={"state": "overdue"}).json()] == ["Late"]
    assert [t["title"] for t in authed.get("/api/tasks", params={"state": "open"}).json()] == ["Late", "Later", "Undated"]  # dated first, soonest first
    done = authed.patch(f"/api/tasks/{late['id']}", json={"done": True}).json()
    assert done["completed_at"]
    assert authed.get("/api/tasks", params={"state": "overdue"}).json() == []  # completed tasks are never overdue
    assert [t["title"] for t in authed.get("/api/tasks", params={"state": "done"}).json()] == ["Late"]
    assert authed.patch(f"/api/tasks/{late['id']}", json={"done": False}).json()["completed_at"] is None
    assert authed.get("/api/tasks", params={"state": "bogus"}).status_code == 422
    assert authed.delete(f"/api/tasks/{undated['id']}").status_code == 204


def test_dashboard_business_figures_come_from_stored_data(authed):
    empty = authed.get("/api/dashboard/overview").json()["business"]
    assert empty["leads_total"] == 0 and empty["conversion_rate"] is None and empty["monthly_recurring_value"] == 0

    a, b, c = lead(authed, name="A"), lead(authed, name="B", next_follow_up=str(today() - timedelta(days=1))), lead(authed, name="C")
    authed.patch(f"/api/leads/{b['id']}", json={"status": "qualified"})
    client = authed.post(f"/api/leads/{a['id']}/convert").json()
    active = mk(authed, "/api/clients", name="Paying", monthly_value=100, status="active")
    p = proposal(authed, client_id=active["id"], discount_percent=50)
    authed.post(f"/api/proposals/{p['id']}/status", json={"status": "sent"})
    authed.post(f"/api/proposals/{p['id']}/status", json={"status": "accepted"})
    mk(authed, "/api/tasks", title="Chase invoice", due_date=str(today() - timedelta(days=1)))

    biz = authed.get("/api/dashboard/overview").json()["business"]
    assert (biz["leads_total"], biz["leads_new"], biz["leads_qualified"]) == (3, 1, 1)  # A converted, B qualified, C new
    assert biz["conversion_rate"] == 33.3 and biz["clients_total"] == 2 and biz["clients_active"] == 1
    assert biz["monthly_recurring_value"] == 100 and biz["accepted_proposal_value"] == 125.1  # 250.2 less 50%
    assert (biz["proposals_sent"], biz["proposals_accepted"]) == (1, 1)
    assert {s["stage"]: s["leads"] for s in biz["funnel"]}["converted"] == 1 and sum(m["leads"] for m in biz["leads_by_month"]) == 3
    assert biz["client_growth"][-1]["clients"] == 2 and client["id"]
    kinds = sorted((x["kind"], x["overdue"]) for x in biz["attention"])
    assert kinds == [("followup", True), ("task", True)]


# ---------------------------------------------------------------- isolation
def test_crm_data_is_isolated_between_organisations(client):
    register(client, "one@example.com", "Org One")
    L = lead(client)
    C = mk(client, "/api/clients", name="Client")
    pkg = mk(client, "/api/packages", name="Pkg", price=10)
    P = proposal(client, lead_id=L["id"])
    T = mk(client, "/api/tasks", title="T")
    OB = client.post(f"/api/clients/{C['id']}/onboarding/start").json()[0]
    me = client.get("/api/auth/me").json()
    client.post("/api/auth/logout")

    register(client, "two@example.com", "Org Two")
    for path in (f"/api/leads/{L['id']}", f"/api/leads/{L['id']}/activities", f"/api/clients/{C['id']}", f"/api/clients/{C['id']}/history",
                 f"/api/clients/{C['id']}/onboarding", f"/api/proposals/{P['id']}", f"/api/proposals/{P['id']}/pdf"):
        assert client.get(path).status_code == 404, path
    for path, body in ((f"/api/leads/{L['id']}", {"name": "x"}), (f"/api/clients/{C['id']}", {"name": "x"}), (f"/api/packages/{pkg['id']}", {"name": "x"}),
                       (f"/api/proposals/{P['id']}", {"title": "x"}), (f"/api/tasks/{T['id']}", {"title": "x"}), (f"/api/onboarding/{OB['id']}", {"done": True})):
        assert client.patch(path, json=body).status_code == 404, path
    for path in (f"/api/leads/{L['id']}/qualify", f"/api/leads/{L['id']}/convert", f"/api/clients/{C['id']}/onboarding/start",
                 f"/api/proposals/{P['id']}/status"):
        assert client.post(path, json={"status": "sent"}).status_code == 404, path
    for path in (f"/api/leads/{L['id']}", f"/api/clients/{C['id']}", f"/api/packages/{pkg['id']}", f"/api/proposals/{P['id']}", f"/api/tasks/{T['id']}", f"/api/onboarding/{OB['id']}"):
        assert client.delete(path).status_code == 404, path
    for path in ("/api/leads", "/api/clients", "/api/packages", "/api/proposals", "/api/tasks"):
        assert client.get(path).json() == [], path

    # a caller cannot attach their records to another organisation's rows
    own = mk(client, "/api/clients", name="Mine")
    assert client.post("/api/proposals", json={"title": "x", "lead_id": L["id"]}).status_code == 404
    assert client.post("/api/proposals", json={"title": "x", "client_id": own["id"], "items": [{"package_id": pkg["id"], "description": "d", "unit_price": 1}]}).status_code == 404
    assert client.post("/api/tasks", json={"title": "x", "client_id": C["id"]}).status_code == 404
    assert client.post("/api/tasks", json={"title": "x", "assignee_id": me["id"]}).status_code == 404
    assert client.get("/api/dashboard/overview").json()["business"]["leads_total"] == 0


# ---------------------------------------------------------------- the whole agency workflow
def test_lead_to_onboarding_workflow(authed):
    mk(authed, "/api/packages", name="SEO Growth", description="Monthly SEO", price=500, billing="monthly")
    lead_ = lead(authed, name="Dana Roe", company="Roe Plumbing", service_interest="SEO for plumbers", notes="Need a quote this month", phone="555")

    q = authed.post(f"/api/leads/{lead_['id']}/qualify").json()["qualification"]
    assert q["service_fit"] == ["SEO Growth"]

    client = authed.post(f"/api/leads/{lead_['id']}/convert").json()
    p = proposal(authed, lead_id=lead_["id"], client_id=client["id"], payment_terms="50% upfront", deliverables="Audit, fixes, monthly report")
    assert p["recipient_name"] == "Dana Roe"
    authed.post(f"/api/proposals/{p['id']}/status", json={"status": "sent"})
    assert authed.post(f"/api/proposals/{p['id']}/status", json={"status": "accepted"}).json()["status"] == "accepted"
    assert authed.get(f"/api/leads/{lead_['id']}").json()["status"] == "converted"  # sent-status side effect never downgrades it

    checklist = authed.post(f"/api/clients/{client['id']}/onboarding/start").json()
    assert len(checklist) == 9
    task = mk(authed, "/api/tasks", title="Kick-off call", client_id=client["id"], due_date=str(today() + timedelta(days=1)))
    assert authed.get("/api/tasks", params={"client_id": client["id"]}).json()[0]["id"] == task["id"]

    history = [x["text"] for x in authed.get(f"/api/clients/{client['id']}/history").json()]
    assert any("marked accepted" in t for t in history) and any("Onboarding checklist started" in t for t in history)
