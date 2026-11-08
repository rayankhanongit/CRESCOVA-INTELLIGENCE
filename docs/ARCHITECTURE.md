# Architecture

```
Browser (React SPA, Vite dev :5173)
   │  /api/*  (Vite proxy in dev; same origin, cookie session, X-Requested-With header)
   ▼
FastAPI (:8000)  ── middleware: CSRF/security headers, CORS
   ├─ routers/   auth · websites · audits · dashboard · leads · clients · proposals · tasks (+ common helpers)
   ├─ crm/       qualify (rules) · proposal_pdf · overview (dashboard figures)
   ├─ security.py   Argon2, JWT cookie, rate limiter, audit log
   ├─ seo/       ssrf · fetcher · crawler · parse · checks · scoring · runner · report
   └─ models.py  SQLAlchemy 2  ──►  SQLite (default) / PostgreSQL via DATABASE_URL
                                     migrations: Alembic (backend/alembic)
```

## Backend

- **Layers:** routers (HTTP, authorisation, validation) → `seo/` engine (pure logic, no HTTP framework) → models. The engine takes a `Fetcher` interface, so tests substitute an offline fake while production uses the SSRF-guarded fetcher (`app.state.fetcher_factory`).
- **Background work:** audits run as FastAPI background tasks on the event loop (`seo/runner.py`). Crawling is async; DB writes are short synchronous calls. This is intentionally simple for a single-process local app. Audits interrupted by a restart are marked failed on startup. A real queue (e.g. a worker process) is the upgrade path if audits must survive restarts or run in parallel at scale.
- **Config:** `config.py` (pydantic-settings) reads environment / `backend/.env`.
- **Migrations:** `alembic upgrade head`. Tests use `create_all` on a temporary SQLite file; the migration was verified up → down → up with no model drift (`alembic check`).

## Frontend

- Vite + React 19 + TypeScript (strict). Server state via TanStack Query (polling while audits are running); no global client store.
- `src/lib/api.ts` is the only code that calls `fetch`; it adds the CSRF header and normalises FastAPI error shapes.
- Design tokens are CSS variables in `src/index.css` (light and dark), exposed to Tailwind through `@theme inline`. Theme is applied before first paint from `index.html` and persisted in `localStorage`.
- Shared primitives in `components/ui.tsx`; finding list/expansion in `components/Findings.tsx`; shell and navigation in `components/Layout.tsx` (`NAV` marks unbuilt modules as disabled with their phase).
- Known: the production bundle is one ~770 kB chunk (227 kB gzip) because charts are not code-split yet.

## Planned (not built)

AI provider abstraction (`ai/` package with Gemini/OpenAI/Groq adapters behind one interface; findings are input, never output of AI), CRM, proposals, content, reporting. The database already has `organisation_id` on every tenant table so those modules inherit isolation.
