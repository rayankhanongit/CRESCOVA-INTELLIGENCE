from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..config import get_settings
from ..db import get_db
from ..models import Organisation, User
from ..schemas import LoginIn, RegisterIn, UserOut
from ..security import (audit_log, clear_session, current_user, hash_password, login_limiter, register_limiter,
                        set_session, user_from_cookie, verify_password)

router = APIRouter(prefix="/api/auth", tags=["auth"])


def _out(user: User) -> UserOut:
    return UserOut(id=user.id, email=user.email, full_name=user.full_name, role=user.role,
                   organisation_id=user.organisation_id, organisation_name=user.organisation.name,
                   organisation_currency=user.organisation.currency)


@router.post("/register", response_model=UserOut, status_code=201)
def register(body: RegisterIn, request: Request, response: Response, db: Session = Depends(get_db)):
    if not get_settings().allow_registration:
        raise HTTPException(403, "Registration is disabled")
    register_limiter.check(request.client.host if request.client else "unknown")
    email = body.email.lower()
    if db.scalar(select(User).where(User.email == email)):
        raise HTTPException(409, "An account with this email already exists")
    org = Organisation(name=body.organisation_name.strip())
    user = User(organisation=org, email=email, password_hash=hash_password(body.password),
                full_name=body.full_name.strip(), role="owner")
    db.add_all([org, user])
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "An account with this email already exists") from None
    audit_log(db, request, user, "register")
    set_session(response, user)
    return _out(user)


@router.post("/login", response_model=UserOut)
def login(body: LoginIn, request: Request, response: Response, db: Session = Depends(get_db)):
    ip = request.client.host if request.client else "unknown"
    login_limiter.check(f"{ip}|{body.email.lower()}")
    user = db.scalar(select(User).where(User.email == body.email.lower()))
    if not verify_password(body.password, user.password_hash if user else None) or not user.is_active:
        audit_log(db, request, None, "login_failed", body.email.lower()[:100])
        raise HTTPException(401, "Incorrect email or password")
    audit_log(db, request, user, "login")
    set_session(response, user)
    return _out(user)


@router.post("/logout", status_code=204)
def logout(request: Request, response: Response, db: Session = Depends(get_db)):
    """Clears the cookie and revokes the session on the server: a copied token stops working. This signs out every device."""
    user = user_from_cookie(request, db)
    if user:
        user.session_epoch += 1
        db.commit()
    clear_session(response)


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(current_user)):
    return _out(user)
