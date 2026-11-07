# Crescova Intelligence

An AI-assisted SEO intelligence and agency-operations platform for Crescova. It runs locally: a FastAPI backend with a real website crawler and deterministic SEO engine, a React frontend, and a relational database.

> **Status: Phases A and B are built and tested. Phases C–F are not built yet.** See [Project status](#project-status) for exactly what works and what does not.

## What works today

| Area | Details |
|---|---|
| Accounts | Register / sign in, one workspace (organisation) per agency, Argon2 password hashing, HttpOnly session cookie, login rate limiting, CSRF header guard, per-organisation data isolation |
| Websites | Add, edit, delete (with confirmation), view; URL validation incl. SSRF checks; unique per organisation |
| SEO crawler | Same-site BFS crawl, robots.txt + Crawl-delay, sitemap discovery (XXE-safe), redirect tracking, depth/page/time limits, loop avoidance, bounded external-link and image checks |
| SEO checks | 33 deterministic checks across technical, on-page, content, indexability, linking and structured data. Every finding has severity, URL, explanation, why it matters, fix and evidence |
| Scoring | Transparent, weighted, configurable. Overall + 6 category scores + per-page score. Explained in the UI and in [docs/SEO_ENGINE.md](docs/SEO_ENGINE.md) |
| Audit history | Every audit is stored; compare any two audits (new / resolved / persistent issues, category deltas); score trend charts |
| Page analysis | Per-page view of title, description, canonical, headings, images, links, schema, indexability, score, findings |
| Exports | Audit findings as CSV, JSON and PDF; page/audit findings CSV from the UI |
| Dashboard | Real figures computed from stored audits. No demo or placeholder numbers |
| UI | Premium light/dark design system (persisted), collapsible sidebar, responsive down to phone width, empty/loading/error states, toasts |

## Project status

Navigation shows all 14 planned modules. Modules that are not built are **disabled and labelled with their phase**; nothing links to a fake page.

| Phase | Scope | State |
|---|---|---|
| A | Foundation: auth, DB + migrations, design system, navigation, dashboard | ✅ Done |
| B | SEO engine: websites, crawler, checks, scoring, history, page analysis, exports | ✅ Done |
| C | AI provider abstraction, AI recommendations, keyword intelligence, competitor analysis, content studio | ❌ Not started (settings page shows provider/key status only) |
| D | Leads CRM, AI lead qualification, clients, proposals, onboarding, tasks | ❌ Not started |
| E | Content calendar, client reporting, notifications | ❌ Not started |
| F | Hardening pass, extended docs (CRM, AI), deployment guide | ⚠️ Partially: security/testing docs exist for A+B only |

Also not implemented: Lighthouse/Core Web Vitals, JavaScript-rendered crawling (Playwright), microdata/RDFa parsing (JSON-LD only), PostgreSQL testing (SQLite is what was run), background job queue (audits run in-process; they are marked failed if the server restarts), Google Analytics 4 / Search Console integrations, user management beyond the owner account, password reset, org-configurable scoring weights (server env only).

## Technology

- **Backend:** Python 3.12, FastAPI, SQLAlchemy 2, Alembic, Pydantic, httpx/httpcore, BeautifulSoup + lxml, PyJWT, argon2-cffi, ReportLab
- **Frontend:** React 19, TypeScript, Vite, Tailwind CSS 4, TanStack Query, React Router, Recharts, Lucide
- **Database:** SQLite by default (zero setup). PostgreSQL is supported by the models via `DATABASE_URL` but has not been tested yet.
- **Tests:** pytest (78) and Vitest + Testing Library (19)

## Prerequisites (Windows)

- Python 3.12 (`py -3.12 --version`). Python 3.14 is installed on this machine but was not used.
- Node.js 20+ and npm
- Git

## Setup and run

Open **two** PowerShell windows.

**1. Backend**

```powershell
cd D:\projects\CRESCOVA_INTELLIGENCE\backend
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env
alembic upgrade head
uvicorn app.main:app --reload --port 8000
```

API docs (development only): <http://127.0.0.1:8000/api/docs>

**2. Frontend**

```powershell
cd D:\projects\CRESCOVA_INTELLIGENCE\frontend
npm install
npm run dev
```

Open <http://localhost:5173>, choose **Create a workspace**, then add a website and press **Start audit**.

## Configuration

All configuration is environment based; see [backend/.env.example](backend/.env.example). Secrets (`SECRET_KEY`, AI keys) live only in `backend/.env` or real environment variables and are never sent to the browser.

## Database

`alembic upgrade head` creates `backend/crescova.db`. To reset local data, stop the backend, delete that file and run the command again. Schema: [docs/DATABASE_SCHEMA.md](docs/DATABASE_SCHEMA.md).

## Tests

```powershell
cd D:\projects\CRESCOVA_INTELLIGENCE\backend;  .\.venv\Scripts\python.exe -m pytest
cd D:\projects\CRESCOVA_INTELLIGENCE\frontend; npm test; npm run build
```

Details: [docs/TESTING.md](docs/TESTING.md).

## Documentation

[Architecture](docs/ARCHITECTURE.md) · [SEO engine & scoring](docs/SEO_ENGINE.md) · [Security](docs/SECURITY.md) · [Database](docs/DATABASE_SCHEMA.md) · [API](docs/API_DOCUMENTATION.md) · [Testing](docs/TESTING.md) · [Deployment](docs/DEPLOYMENT.md)

CRM, AI-integration and keyword documentation will be written together with those modules.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `No space left on device` during `pip`/`npm install` | The system drive is full. Point temp and caches elsewhere for the session: `$env:TEMP="D:\tmp"; $env:TMP="D:\tmp"; $env:PIP_CACHE_DIR="D:\tmp\pipcache"; $env:npm_config_cache="D:\tmp\npmcache"` |
| `pip` says "No matching distribution" | Transient network failure. Retry with `pip install --retries 10 --timeout 60 -r requirements.txt` |
| Browser shows "Can't reach the server" | Backend is not running on port 8000 |
| Audit stuck as *failed – interrupted by a server restart* | Audits run inside the API process; start a new one |
| "URL rejected: …" when adding a site | The SSRF guard blocks localhost, private/link-local ranges and non-80/443/8080/8443 ports by design |
| Registration returns an email error for `*.test` addresses | Special-use domains are rejected; use a normal domain |
