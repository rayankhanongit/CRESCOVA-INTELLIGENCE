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
    token = jwt.encode({"sub": str(user.id), "exp": utcnow() + timedelta(hours=s.session_hours)}, s.resolved_secret(), "HS256")
    response.set_cookie(COOKIE, token, max_age=s.session_hours * 3600, httponly=True, samesite="lax", secure=s.cookie_secure, path="/")


def clear_session(response: Response) -> None:
    response.delete_cookie(COOKIE, path="/")


def current_user(request: Request, db: Session = Depends(get_db)) -> User:
    token = request.cookies.get(COOKIE)
    if not token:
        raise HTTPException(401, "Not authenticated")
    try:
        uid = int(jwt.decode(token, get_settings().resolved_secret(), algorithms=["HS256"])["sub"])
    except (jwt.PyJWTError, KeyError, ValueError):
        raise HTTPException(401, "Session expired") from None
    user = db.get(User, uid)
    if not user or not user.is_active:
        raise HTTPException(401, "Not authenticated")
    return user


class CsrfMiddleware(BaseHTTPMiddleware):
    """State-changing API calls must carry a custom header. Browsers cannot attach it cross-origin
    without a CORS preflight, which we only allow for configured origins; combined with SameSite=Lax cookies this blocks CSRF."""

    async def dispatch(self, request: Request, call_next):
        if request.method in ("POST", "PUT", "PATCH", "DELETE") and request.url.path.startswith("/api"):
            if request.headers.get(CSRF_HEADER) != CSRF_VALUE:
                from fastapi.responses import JSONResponse
                return JSONResponse({"detail": "Missing CSRF header"}, status_code=403)
        response = await call_next(request)
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault("Referrer-Policy", "no-referrer")
        if request.url.path.startswith("/api"):
            response.headers.setdefault("Cache-Control", "no-store")
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
