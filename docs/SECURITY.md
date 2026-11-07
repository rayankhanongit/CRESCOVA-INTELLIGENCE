# Security

Scope: what is implemented in Phases A and B, and its known limits. A formal security review (Phase F) has **not** been done.

## SSRF protection (crawler and website URLs)

Implemented in `backend/app/seo/ssrf.py`; every outbound request goes through `GuardedFetcher`.

1. **Syntax** (`parse_public_url`): only `http`/`https`; no embedded credentials; ports limited to 80, 443, 8080, 8443; `localhost` and `.local/.internal/.localhost/.lan/.localdomain/.home.arpa` hostnames rejected; IP literals checked; IDN hostnames punycoded.
2. **Resolution** (`resolve_public`): every address a hostname resolves to must be globally routable. If *any* answer is private, loopback, link-local (incl. cloud metadata `169.254.169.254`), CGNAT, multicast, reserved, IPv4-mapped/6to4/NAT64 wrapping a non-public IPv4, the request is refused. This also catches decimal/hex IP tricks such as `http://2130706433/`.
3. **Connect time** (`GuardedBackend`): the httpcore network backend re-resolves and re-validates at connection time and connects to the *validated IP* (TLS SNI and Host header remain the hostname). A hostname that changes its DNS answer after the check (DNS rebinding) is refused.
4. **Redirects**: followed manually, max 5, and each hop is re-validated through steps 1–3.
5. **Other limits**: 10 s timeouts, 2 MB response cap, no proxies read from the environment, no `file://` or Unix sockets.

Tests: `backend/tests/test_ssrf.py` (parametrised blocked ranges/URLs, real fetcher against localhost / metadata IP / `::1`, rebinding simulation, redirect-to-metadata).

Known limits: policy rejects hostnames where *any* answer is private (stricter than needed); IPv6 zone IDs are stripped; this protects the application server, not the network the *operator* chooses to run it on — run it with normal egress filtering in production.

## Authentication and sessions

- Passwords hashed with Argon2id; minimum 10 characters; constant-time-ish verification for unknown users.
- Session: signed JWT (HS256) in an `HttpOnly`, `SameSite=Lax` cookie (`Secure` when `COOKIE_SECURE=true`), 12 h lifetime. The user is re-loaded on every request, so disabling a user takes effect immediately.
- Login limited to 10 attempts / 5 min per IP+email; registration 5 / hour per IP. These limiters are **in memory and per process**.
- `SECRET_KEY` is mandatory when `ENVIRONMENT=production`. In development it is generated into `backend/.secret_key` (git-ignored).
- Logout clears the cookie; there is no server-side token revocation yet (tokens remain valid until expiry if copied).

## CSRF

Every `POST/PUT/PATCH/DELETE` under `/api` must send `X-Requested-With: crescova`, otherwise 403. A cross-site form cannot set that header and a cross-origin `fetch` would need a CORS preflight, which only `CORS_ORIGINS` passes. Combined with `SameSite=Lax`.

## Authorisation and tenant isolation

Every tenant table carries `organisation_id`. Routers load rows and compare to the caller's organisation; other tenants' records return **404** (not 403) so IDs cannot be probed. Pages and findings are authorised through their parent audit. Covered by `test_organisation_isolation`.

## Other controls

- Pydantic validation on all input; SQLAlchemy parameterised queries only (no string SQL).
- XML sitemaps parsed with lxml (`resolve_entities=False`, `no_network=True`, `load_dtd=False`); tested against an XXE payload.
- PDF generation escapes all site-supplied text; CSV exports prefix cells starting with `= + - @` to defuse spreadsheet formulas (also in the browser export).
- React escapes rendered text; no `dangerouslySetInnerHTML`. External links use `rel="noopener noreferrer"`.
- Security headers: `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Cache-Control: no-store` on `/api`.
- Unhandled errors return a generic 500; details go only to the server log. Audit failures store a generic message.
- Concurrency cap per organisation (default 2 running audits) and a 15-minute hard cap per audit.
- Audit log table records registration, logins (incl. failures), website create/delete, audit start/delete.

## Not yet implemented

CSP header (set one at the web server / CDN when deploying), password reset, MFA, multiple users per organisation and role enforcement, server-side session revocation, distributed rate limiting, file-upload validation (no uploads exist yet), dependency vulnerability scanning in CI.
