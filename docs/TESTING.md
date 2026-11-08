# Testing

## Run

```powershell
cd D:\projects\CRESCOVA_INTELLIGENCE\backend
.\.venv\Scripts\python.exe -m pytest              # 109 tests

cd D:\projects\CRESCOVA_INTELLIGENCE\frontend
npm test                                          # 47 tests (Vitest + Testing Library)
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

| CRM (backend) | `backend/tests/test_crm.py` | lead CRUD, search/filters (incl. LIKE-wildcard escaping), timeline and last-contacted, validation (`javascript:` websites, bad email, negative budget), qualification rules and the "only suggests" guarantee, conversion (409 on repeat) and client history, onboarding checklist, proposal totals / status flow / lock / expiry / PDF, packages, currency, tasks and overdue logic, dashboard figures, **cross-organisation isolation including forged references**, and the full lead → qualify → convert → proposal → accepted → onboarding workflow |
| CRM (frontend) | `frontend/src/crm.test.tsx` | money and totals helpers, safe links, generic form modal (validation, null/number conversion, server errors), Kanban columns and persisted moves, search, add-lead flow, proposal editor (package lines, live totals, saved payload, recipient required, locked state, onboarding offer), onboarding progress and toggle, task reminders, dashboard business section |

| AI (backend) | `backend/tests/test_ai.py` | request shape for OpenAI, Groq and Gemini against **mocked HTTP** (URLs, headers, the Gemini key kept out of the URL, JSON mode, token parsing), safe error messages, provider resolution, prompt wrapping of untrusted text, 503 when unconfigured with manual features still working, recommendations limited to supplied findings and review/regenerate behaviour, provider failure (502) and logging, hourly rate limit, page rewrite not stored, keyword suggestions with no metrics and nothing saved until chosen, CSV formula safety, competitor SSRF rejection, analysis, robots block, comparison and content gaps, content generate/revise/save/manage, and isolation across organisations including forged references |
| AI (frontend) | `frontend/src/ai.test.tsx` | recommendations disabled/enabled by AI status and labelled, review calls, keyword metrics shown only if entered, AI suggestion flow (warning shown, saved as estimates without numbers), competitor facts vs. AI section, content studio generate/edit/revise/save and manual use without AI |

**Not verified:** no request was ever sent to Gemini, OpenAI or Groq. The provider code is exercised only against mocked responses written from the providers' documented formats, so the first real call may still reveal a mismatch.

Backend tests never touch the real network: DNS is stubbed and fetching uses an in-memory fake site (`tests/fakesite.py`). The SSRF tests that need the real fetcher only target addresses that must be refused.

## Manual verification performed

Phase D: against the running app I seeded a QA workspace (currency, three packages, three leads), qualified a lead, converted it through the UI, built a proposal in the editor (live totals matched the server), marked it sent and accepted, confirmed a sent proposal returns 409 on edit, started onboarding, created tasks, and checked the dashboard, tasks and settings pages. The PDF text was extracted and checked: amounts, discount, terms, and that markup in the title is shown literally.

Phase B: real crawls of `example.com` and `www.iana.org` through the running app (register → add sites → audit → view findings, score breakdown, exports, light/dark and phone-width layouts). This exposed and fixed a stall caused by slow third-party links.

## Not covered

No browser end-to-end suite (Playwright), no load tests, no PostgreSQL run, no accessibility audit with automated tooling, no frontend tests for the history/compare, audit detail, page detail, lead detail and settings-package screens (checked manually), no automated test of Kanban drag-and-drop (the status-menu path is tested; the drop handler was checked once in the browser with synthetic drag events, a real mouse drag was not confirmed), no PDF content assertions beyond the `%PDF` header.
