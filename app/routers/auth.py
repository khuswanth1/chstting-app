import re
import time
from collections import defaultdict, deque

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import current_user
from ..models import User
from ..schemas import LoginIn, RegisterIn, TokenOut
from ..security import create_token, hash_password, verify_password
from ..services.serializers import user_me

router = APIRouter(prefix="/auth", tags=["Authentication"])

# Naive in-memory brute-force guard: 10 failed logins / 5 min per (ip, identifier).
_fails: dict[str, deque] = defaultdict(deque)
WINDOW, MAX_FAILS = 300, 10


def _throttled(key: str) -> bool:
    q = _fails[key]
    now = time.monotonic()
    while q and now - q[0] > WINDOW:
        q.popleft()
    return len(q) >= MAX_FAILS


@router.post("/register", response_model=TokenOut, status_code=201, summary="Create an account")
def register(data: RegisterIn, db: Session = Depends(get_db)):
    email = data.email.lower()
    clash = db.scalar(select(User).where(or_(User.username == data.username, func.lower(User.email) == email)))
    if clash:
        raise HTTPException(409, "Username or email already in use")
    if data.phone and db.scalar(select(User.id).where(User.phone == data.phone)):
        raise HTTPException(409, "Phone number already in use")
    user = User(username=data.username, email=email, phone=data.phone, password_hash=hash_password(data.password),
                display_name=data.display_name or data.username)
    db.add(user)
    db.commit()
    return {"access_token": create_token(user.id, user.token_version), "user": user_me(user)}


@router.post("/login", response_model=TokenOut, summary="Log in with username, email or phone number + password")
def login(data: LoginIn, request: Request, db: Session = Depends(get_db)):
    ident = data.identifier.strip().lower()
    key = f"{request.client.host if request.client else '?'}:{ident}"
    if _throttled(key):
        raise HTTPException(429, "Too many failed attempts. Try again later.")
    user = db.scalar(select(User).where(or_(User.username == ident, func.lower(User.email) == ident)))
    if not user and re.fullmatch(r"[\d\s().+-]+", ident):
        # phone login: country code optional ('+1 415 555 0123' or '4155550123'); ambiguous numbers never match
        digits = re.sub(r"\D", "", ident)
        if len(digits) >= 7:
            matches = db.scalars(select(User).where(User.phone.like(f"%{digits}")).limit(2)).all()
            user = matches[0] if len(matches) == 1 else None
    if not user or not verify_password(data.password, user.password_hash):
        _fails[key].append(time.monotonic())
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid credentials")
    _fails.pop(key, None)
    return {"access_token": create_token(user.id, user.token_version), "user": user_me(user)}


@router.get("/me", summary="Current user")
def me(user: User = Depends(current_user)):
    return user_me(user)


@router.post("/logout", status_code=204, summary="Log out this device (client discards its token)")
def logout(user: User = Depends(current_user)):
    # JWTs are stateless; the client drops its token and closes its WebSocket, which flips presence.
    return Response(status_code=204)


@router.post("/logout-all", status_code=204, summary="Invalidate every token issued to this user")
def logout_all(user: User = Depends(current_user), db: Session = Depends(get_db)):
    user.token_version += 1
    db.commit()
    return Response(status_code=204)
