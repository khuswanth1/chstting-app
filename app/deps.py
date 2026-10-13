from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from .database import get_db
from .models import User
from .security import decode_token

bearer = HTTPBearer(auto_error=False)


def user_from_token(db: Session, token: str | None) -> User | None:
    payload = decode_token(token) if token else None
    if not payload:
        return None
    try:
        user = db.get(User, int(payload["sub"]))
    except (KeyError, ValueError):
        return None
    if not user or user.token_version != payload.get("tv"):
        return None
    return user


def current_user(
    creds: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: Session = Depends(get_db),
) -> User:
    user = user_from_token(db, creds.credentials if creds else None)
    if not user:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or expired token",
                            headers={"WWW-Authenticate": "Bearer"})
    return user
