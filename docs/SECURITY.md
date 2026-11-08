# Security

This documents what is implemented, what was reviewed in Phase F, and what remains. It is not an independent audit or a penetration test.

## Phase F review log

| Area | Method | Result |
|---|---|---|
| Authorisation on every route | `tests/test_route_security.py` discovers all API routes from the app itself. Anonymous calls must get 401 on every non-public route; a second organisation must get 404 on every route taking an id of the first organisation's data (the first organisation owns one of every record type). A route needing a request body must have a sample body in the test, so a new route cannot silently escape the check. Verified the sweep can fail by temporarily removing the ownership check | Pass. No cross-tenant access found |
| Session revocation | **Fixed.** Logout only cleared the cookie, so a copied token stayed valid for 12 hours. Sessions now carry a per-user epoch that logout increments; older tokens are rejected immediately | Fixed + tested (replayed token → 401). Side effect: logging out signs out every device |
| Cookies and transport headers | **Added.** Production forces `Secure` cookies and sends HSTS; API responses carry `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'` plus nosniff, `X-Frame-Options`, no-referrer and `Cache-Control: no-store` | Tested |
| Request size | **Added.** Bodies with a declared `Content-Length` over 1 MB get 413 | Tested. Chunked bodies are not checked: enforce a limit at the reverse proxy too |
| Front-end CSP | **Added.** `npm run preview` serves the production build with a strict policy (hash of the one inline script computed automatically). Loaded in a real browser: app, charts and styles work with zero violations. `docs/DEPLOYMENT.md` has the policy | Verified manually |
| Performance / DoS | Proposal lists and dashboard loaded line items one proposal at a time; now one query (asserted by a test). Chart library split out of the first download (770 kB to 462 kB main bundle) | Fixed |
| Dependencies | `npm audit`: 0 vulnerabilities. `pip-audit` on all 47 installed Python packages: no known vulnerabilities (database snapshot at the time of the run) | Pass; re-run before deploying |
| Accessibility | axe-core over the main screens (forms, shell, board, editor, calendar, dialogs). Found and fixed an invalid ARIA grid on the calendar and a heading-level jump in empty states | Pass for what jsdom can check. **Colour contrast and focus visibility were not tested** |
| Injection | All database access is through the ORM with bound parameters; `LIKE` searches escape wildcards. All text rendered by React (no raw HTML), PDFs escape user text, CSV exports neutralise formula prefixes | No issue found |
| Secrets | `.env`, `.secret_key`, databases and the dev-account note are git-ignored; `git ls-files` contains none. API keys are only ever read from the environment and are never returned by any endpoint (status endpoints report presence only) | Pass |

## SSRF protection (crawler, competitor analysis, website URLs)

Implemented in `backend/app/seo/ssrf.py`; every outbound request to a user-supplied address goes through `GuardedFetcher`.

1. **Syntax** (`parse_public_url`): only `http`/`https`; no embedded credentials; ports limited to 80, 443, 8080, 8443; `localhost` and `.local/.internal/.localhost/.lan/.localdomain/.home.arpa` hostnames rejected; IP literals checked; IDN hostnames punycoded.
2. **Resolution**: every address a hostname resolves to must be globally routable. If *any* answer is private, loopback, link-local (including the cloud metadata address), CGNAT, multicast, reserved, or an IPv4-mapped/6to4/NAT64 wrapper around a non-public IPv4, the request is refused. This also catches decimal/hex IP tricks such as `http://2130706433/`.
3. **Connect time** (`GuardedBackend`): the network backend re-resolves and re-validates at connection time and connects to the validated IP (TLS SNI and the Host header remain the hostname). A hostname whose DNS answer changes after the check (DNS rebinding) is refused.
4. **Redirects**: followed manually, at most 5, each hop re-validated through steps 1-3.
5. **Other limits**: 10 s timeouts, 2 MB response cap, no proxy settings read from the environment, no `file://` or Unix sockets, XML sitemaps parsed without entities, DTDs or network access.

Tests: `tests/test_ssrf.py` (blocked ranges and URL forms, real fetcher against localhost / metadata IP / `::1`, rebinding at connect time, redirect to the metadata address, API rejection) and the competitor tests.

## Authentication and sessions

- Argon2id password hashing, minimum 10 characters; unknown users cost the same hashing time as wrong passwords, and the login error is identical either way.
- Session: signed JWT (HS256) in an `HttpOnly`, `SameSite=Lax` cookie, 12 hours, with a revocable per-user epoch (see above). The user is re-loaded on every request, so disabling a user takes effect immediately.
- Login is limited to 10 attempts per 5 minutes per IP and email, registration to 5 per hour per IP; AI calls are limited per organisation per hour. These limiters are **in memory and per process**.
- `SECRET_KEY` is required when `ENVIRONMENT=production`. In development it is generated into `backend/.secret_key` (git-ignored).
- **CSRF:** every state-changing `/api` request must carry `X-Requested-With: crescova`, otherwise 403. A cross-site form cannot set it and a cross-origin `fetch` needs a CORS preflight that only `CORS_ORIGINS` passes. Combined with `SameSite=Lax`.

## Authorisation and tenant isolation

Every tenant table carries `organisation_id`. Routers load rows and compare to the caller's organisation; another tenant's record is a **404** (not 403) so ids cannot be probed. Any foreign reference a caller submits (lead, client, website, package, assignee) is verified to belong to their organisation before it is stored. Pages and findings are authorised through their parent audit.

## CRM and AI specifics

- Lead and client websites are accepted only as `http(s)` and rendered as links only when they start with `http(s)://` (blocks `javascript:` links); they are never fetched.
- Proposal, report and audit PDFs escape all user text; CSV exports (audit, keywords, reports, data exports) prefix cells starting with `= + - @`.
- AI keys travel only in request headers to three fixed provider hosts, so user input cannot steer those requests. All website- and user-supplied text in prompts is wrapped as untrusted data, the model has no tools, and AI output is parsed as JSON or shown as plain text and validated against stored findings. Residual risk: a crafted page could still sway the wording of an AI answer, which is why a person reviews everything and nothing is applied automatically. Using AI sends the relevant inputs to the provider you choose.
- Audit log (`audit_logs`) records registration, logins (including failures), website/competitor/lead/client/proposal/report creation or deletion where sensitive, audit starts, conversions, proposal status changes and agency settings changes.

## Known limitations and accepted risks

- Registration says "an account with this email already exists", which lets someone test whether an email is registered. Accepted for usability; set `ALLOW_REGISTRATION=false` once accounts exist.
- No MFA, password reset, password-strength list check, or multiple users per organisation with role enforcement (only the owner role exists).
- Rate limiters and background tasks are single-process. Behind a proxy, the per-IP limiter sees the proxy's address unless the proxy is configured to pass client addresses and the app is changed to trust them.
- Logout signs out all devices (a consequence of the simple revocation design).
- No automated dependency scanning in CI (there is no CI); no penetration test; no external security review.
- The in-app notification and AI features send nothing outside the application except AI requests to the configured provider.
