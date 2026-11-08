"""Password hashing, session cookies, CSRF guard, rate limiting, audit logging."""
import time
from collections import defaultdict, deque
from datetime import timedelta

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerifyMismatchError
from fastapi import Depends, HTTPException, Request, Response
from sqlalchemy.orm import Session
from starlette.middleware.base import BaseHTTPMiddleware

from .config import get_settings
from .db import get_db, utcnow
from .models import AuditLog, User

COOKIE = "crescova_session"
CSRF_HEADER = "x-requested-with"
CSRF_VALUE = "crescova"
MAX_BODY_BYTES = 1_000_000  # largest JSON request accepted (the biggest legitimate payloads are a few KB of text)
_hasher = PasswordHasher()
_DUMMY_HASH = _hasher.hash("not-a-real-password")


def hash_password(pw: str) -> str:
    return _hasher.hash(pw)


def verify_password(pw: str, hashed: str | None) -> bool:
    try:
        return _hasher.verify(hashed or _DUMMY_HASH, pw) and hashed is not None  # constant-ish time for unknown users
    except (VerifyMismatchError, InvalidHashError):
        return False


def set_session(response: Response, user: User) -> None:
    s = get_settings()
    token = jwt.encode({"sub": str(user.id), "ep": user.session_epoch, "exp": utcnow() + timedelta(hours=s.session_hours)}, s.resolved_secret(), "HS256")
    # Production always uses Secure cookies, whatever COOKIE_SECURE says.
    response.set_cookie(COOKIE, token, max_age=s.session_hours * 3600, httponly=True, samesite="lax", secure=s.cookie_secure or s.environment == "production", path="/")


def clear_session(response: Response) -> None:
    response.delete_cookie(COOKIE, path="/")


def user_from_cookie(request: Request, db: Session) -> User | None:
    """The user behind a valid, unrevoked session cookie, else None."""
    token = request.cookies.get(COOKIE)
    if not token:
        return None
    try:
        claims = jwt.decode(token, get_settings().resolved_secret(), algorithms=["HS256"])
        uid, epoch = int(claims["sub"]), int(claims.get("ep", 0))
    except (jwt.PyJWTError, KeyError, ValueError):
        return None
    user = db.get(User, uid)
    return user if user and user.is_active and user.session_epoch == epoch else None


def current_user(request: Request, db: Session = Depends(get_db)) -> User:
    user = user_from_cookie(request, db)
    if not user:
        raise HTTPException(401, "Not authenticated")
    return user


class CsrfMiddleware(BaseHTTPMiddleware):
    """State-changing API calls must carry a custom header. Browsers cannot attach it cross-origin
    without a CORS preflight, which we only allow for configured origins; combined with SameSite=Lax cookies this blocks CSRF."""

    async def dispatch(self, request: Request, call_next):
        from fastapi.responses import JSONResponse
        api = request.url.path.startswith("/api")
        if api and request.method in ("POST", "PUT", "PATCH", "DELETE"):
            if request.headers.get(CSRF_HEADER) != CSRF_VALUE:
                return JSONResponse({"detail": "Missing CSRF header"}, status_code=403)
        # shortcut: only a declared Content-Length is checked (chunked bodies are not), so also set a body limit at the reverse proxy.
        if api and int(request.headers.get("content-length") or 0) > MAX_BODY_BYTES:
            return JSONResponse({"detail": "Request body too large"}, status_code=413)
        response = await call_next(request)
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault("Referrer-Policy", "no-referrer")
        if api:
            response.headers.setdefault("Cache-Control", "no-store")
            response.headers.setdefault("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'")  # the API serves data and downloads, never pages
        if get_settings().environment == "production":
            response.headers.setdefault("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
        return response


class RateLimiter:
    """Small in-memory sliding window (single process). Use Redis or a gateway when scaling out."""

    def __init__(self, limit: int, window_seconds: int):
        self.limit, self.window = limit, window_seconds
        self.hits: dict[str, deque[float]] = defaultdict(deque)

    def check(self, key: str) -> None:
        now, q = time.monotonic(), self.hits[key]
        while q and now - q[0] > self.window:
            q.popleft()
        if len(q) >= self.limit:
            raise HTTPException(429, "Too many attempts. Please wait a few minutes and try again.")
        q.append(now)

    def reset(self) -> None:
        self.hits.clear()


login_limiter = RateLimiter(limit=10, window_seconds=300)
register_limiter = RateLimiter(limit=5, window_seconds=3600)


def audit_log(db: Session, request: Request | None, user: User | None, action: str, detail: str = "", org_id: int | None = None) -> None:
    db.add(AuditLog(organisation_id=user.organisation_id if user else org_id, user_id=user.id if user else None,
                    action=action, detail=detail[:1000], ip=(request.client.host if request and request.client else "")))
    db.commit()
