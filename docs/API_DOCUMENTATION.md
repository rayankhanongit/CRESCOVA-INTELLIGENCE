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
| `GET /api/dashboard/overview` | Aggregated figures (`business` is `null` until the CRM exists) |
| `GET /api/system/status` | Non-secret configuration status (key *presence* only) |
| `GET /api/health` | Liveness |
