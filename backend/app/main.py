import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .config import get_settings
from .db import SessionLocal
from .routers import audits, auth, dashboard, websites
from .security import CsrfMiddleware
from .seo.runner import default_fetcher_factory, fail_stale_audits

log = logging.getLogger("crescova")


@asynccontextmanager
async def lifespan(app: FastAPI):
    get_settings().resolved_secret()  # fail fast in production if SECRET_KEY is missing
    with SessionLocal() as db:
        fail_stale_audits(db)
    yield


def create_app() -> FastAPI:
    s = get_settings()
    app = FastAPI(title="Crescova Intelligence API", version="0.1.0", lifespan=lifespan,
                  docs_url="/api/docs" if s.environment != "production" else None, redoc_url=None,
                  openapi_url="/api/openapi.json" if s.environment != "production" else None)
    app.state.fetcher_factory = default_fetcher_factory  # tests swap this for an offline fake
    app.add_middleware(CsrfMiddleware)
    app.add_middleware(CORSMiddleware, allow_origins=s.cors_origin_list, allow_credentials=True,
                       allow_methods=["GET", "POST", "PATCH", "DELETE"], allow_headers=["Content-Type", "X-Requested-With"])
    for r in (auth.router, websites.router, audits.router, dashboard.router):
        app.include_router(r)

    @app.get("/api/health")
    def health():
        return {"status": "ok"}

    @app.exception_handler(Exception)
    async def unhandled(request: Request, exc: Exception):
        log.exception("Unhandled error on %s %s", request.method, request.url.path)
        return JSONResponse({"detail": "Internal server error"}, status_code=500)

    return app


app = create_app()
