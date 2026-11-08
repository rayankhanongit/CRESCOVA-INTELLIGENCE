# API

Interactive OpenAPI docs are served in development at <http://127.0.0.1:8000/api/docs> (disabled when `ENVIRONMENT=production`).

Conventions: JSON; auth by `crescova_session` cookie; every non-GET request needs header `X-Requested-With: crescova`; other organisations' resources return 404; validation errors are 422 with FastAPI's `detail`.

| Method & path | Purpose |
|---|---|
| `POST /api/auth/register` · `POST /api/auth/login` · `POST /api/auth/logout` · `GET /api/auth/me` | Session management |
| `GET/POST /api/websites` · `GET/PATCH/DELETE /api/websites/{id}` | Website CRUD (URL is immutable; unsafe URLs → 422) |
| `GET /api/websites/{id}/audits` | Audit history for a site |
| `POST /api/websites/{id}/audits` | Start an audit `{mode: "site"\|"url", url?, max_pages, max_depth}` → 202; 429 if too many running |
| `GET /api/audits` | All audits in the organisation (with `website_name`) |
| `GET /api/audits/{id}` · `DELETE /api/audits/{id}` | Audit detail (incl. weights and summary) / delete |
| `GET /api/audits/{id}/findings?severity=&category=` | Findings, most severe first |
| `GET /api/audits/{id}/pages` · `GET /api/pages/{id}` | Crawled pages / one page with its findings |
| `GET /api/audits/compare?base=&target=` | New / resolved / persistent findings, score and category deltas |
| `GET /api/audits/{id}/export.{csv\|json\|pdf}` | Downloads (completed audits only) |
| `GET /api/meta/checks` | Check catalogue, categories and severity weights |
| `GET /api/dashboard/overview` | Aggregated SEO and business figures, all computed from stored rows |
| `GET /api/system/status` | Non-secret configuration status (key *presence* only) |
| `GET /api/health` | Liveness |
| `GET/POST /api/leads` · `GET/PATCH/DELETE /api/leads/{id}` | Leads; list filters `q`, `status`, `source`, `priority`. `status: "converted"` via PATCH → 422 |
| `GET/POST /api/leads/{id}/activities` | Timeline; POST kinds `note`, `call`, `email`, `meeting` |
| `POST /api/leads/{id}/qualify` | Store a rules-based assessment (never changes status or priority) |
| `POST /api/leads/{id}/convert` | Create a client from the lead → 201; 409 if already converted |
| `GET/POST /api/clients` · `GET/PATCH/DELETE /api/clients/{id}` | Clients; list filters `q`, `status` |
| `GET /api/clients/{id}/history` · `POST /api/clients/{id}/activities` | Client timeline (includes the source lead's) / add a note |
| `GET/POST /api/clients/{id}/onboarding` · `POST /api/clients/{id}/onboarding/start` · `PATCH/DELETE /api/onboarding/{item_id}` | Checklist; `start` creates the standard items once (409 if any exist) |
| `GET/POST /api/packages` · `PATCH/DELETE /api/packages/{id}` | Pricing packages |
| `GET/POST /api/proposals` · `GET/PATCH/DELETE /api/proposals/{id}` | Proposals with embedded `items` and computed `subtotal`, `discount_amount`, `total`. PATCH only on drafts (409 otherwise); `items` in PATCH replaces all lines |
| `POST /api/proposals/{id}/status` | `{status}`; recorded only, nothing is sent |
| `GET /api/proposals/{id}/pdf` | PDF download |
| `GET/POST /api/tasks` · `PATCH/DELETE /api/tasks/{id}` | Tasks; list filters `state` (open, overdue, done), `website_id`, `client_id`; PATCH `{done: true/false}` toggles completion |
| `GET/POST /api/audits/{id}/recommendations` · `PATCH /api/recommendations/{id}` | AI interpretation of stored findings (POST needs AI configured → else 503); PATCH sets `suggested/accepted/dismissed` |
| `POST /api/pages/{id}/ai-rewrite` | Suggested title and description, returned only |
| `GET/POST /api/keywords` · `POST /api/keywords/bulk` · `PATCH/DELETE /api/keywords/{id}` · `GET /api/keywords/export.csv` | Keywords; filter `website_id` |
| `POST /api/keywords/suggest` | AI keyword ideas (not saved, no metrics) |
| `GET/POST /api/websites/{id}/competitors` · `DELETE /api/competitors/{id}` | Competitors (URLs are SSRF-validated) |
| `POST /api/competitors/{id}/analyse` · `POST /api/competitors/{id}/insights` | Start a background crawl (202) / AI interpretation |
| `GET /api/websites/{id}/comparison` | Observed facts: your latest audit vs. each analysed competitor, plus content-gap terms |
| `POST /api/content/generate` | AI text for a brief (optionally revising `previous_text`); not saved |
| `GET/POST /api/content` · `PATCH/DELETE /api/content/{id}` | Content drafts; filters `status`, `client_id` |
| `GET /api/team` | Users in your organisation (for assignment) |
| `PATCH /api/organisation` | `{name?, currency?}` (owner/admin) |
