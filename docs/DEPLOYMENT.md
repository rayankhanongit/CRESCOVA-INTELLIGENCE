# Deployment (notes, not a tested procedure)

The immediate goal is a local application; nothing here has been deployed or load-tested.

Before exposing it beyond localhost:

1. Set `ENVIRONMENT=production`, a long random `SECRET_KEY`, `COOKIE_SECURE=true`, `ALLOW_REGISTRATION=false` (after creating accounts) and `CORS_ORIGINS` to your real origin.
2. Serve over HTTPS. Build the frontend (`npm run build`) and serve `frontend/dist` from the same origin as `/api` (reverse proxy), so the session cookie stays first-party. Add a Content-Security-Policy at the proxy.
3. Use PostgreSQL (`DATABASE_URL`, plus a driver such as `psycopg`), run `alembic upgrade head`, and test the migration there first — only SQLite has been exercised.
4. Run uvicorn without `--reload`, as a single process (rate limiters and audit tasks are in-memory), behind the proxy. Apply egress filtering so the crawler host cannot reach internal networks even if a bug bypassed the in-app guard.
5. Back up the database; keep `.env` out of version control.
