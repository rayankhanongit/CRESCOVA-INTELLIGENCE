# Testing

## Run

```powershell
cd D:\projects\CRESCOVA_INTELLIGENCE\backend
.\.venv\Scripts\python.exe -m pytest              # 78 tests

cd D:\projects\CRESCOVA_INTELLIGENCE\frontend
npm test                                          # 19 tests (Vitest + Testing Library)
npm run build                                     # tsc --noEmit + production build
```

If the system drive is full, set `$env:TEMP="D:\tmp"` first (pytest creates a temporary SQLite database).

## What is covered

| Area | File | Notes |
|---|---|---|
| SSRF | `backend/tests/test_ssrf.py` | blocked IP ranges and URL forms, decimal-IP trick, private DNS answers, unresolvable hosts, real fetcher vs localhost/metadata/`::1`, rebinding at connect time, redirect to metadata IP, API rejection |
| Crawler + checks + scoring | `test_seo_engine.py` | link discovery, robots, limits and loops, single-URL mode, redirect chains, duplicates, structured data, noindex/canonical, XXE sitemap, slow external hosts, score maths and configurable weights, check metadata |
| API / workflow | `test_api.py` | auth, cookie flags, rate limit, CSRF, password policy, website CRUD, **full audit workflow** (add site → audit → findings → page → CSV/JSON/PDF → dashboard), audit comparison, single-URL audits, **organisation isolation**, concurrency cap, CSV formula neutralisation |
| Frontend | `frontend/src/app.test.tsx` | formatting/CSV safety, API client (CSRF header, error text), theme persistence, navigation (14 items; unbuilt ones disabled and not links), sidebar collapse, login validation, website add/validate/delete flows, dashboard empty and populated states, findings expansion/filter, score ring accessibility |

Backend tests never touch the real network: DNS is stubbed and fetching uses an in-memory fake site (`tests/fakesite.py`). The SSRF tests that need the real fetcher only target addresses that must be refused.

## Manual verification performed

Real crawls of `example.com` and `www.iana.org` through the running app (register → add sites → audit → view findings, score breakdown, exports, light/dark and phone-width layouts). This exposed and fixed a stall caused by slow third-party links.

## Not covered

No browser end-to-end suite (Playwright), no load tests, no PostgreSQL run, no accessibility audit with automated tooling, no frontend tests for the history/compare, audit detail and page detail screens (they were checked manually), no PDF content assertions beyond the `%PDF` header.
