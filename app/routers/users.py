import re

from fastapi import APIRouter, Depends, File, HTTPException, Query, Response, UploadFile
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import current_user
from ..models import Block, Contact, User
from ..schemas import ContactIn, ProfileIn, SettingsIn, normalize_phone
from ..services.realtime import emit
from ..services.serializers import iso, user_me, user_public
from ..services.uploads import delete_file_if_unused, save_upload
from ..services.presence import presence_audience

router = APIRouter(tags=["Users & Contacts"])


# ----- profile -----

@router.patch("/users/me", summary="Update profile")
def update_profile(data: ProfileIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    if data.display_name is not None:
        user.display_name = data.display_name.strip()
    if data.about is not None:
        user.about = data.about.strip()
    if "phone" in data.model_fields_set:
        if data.phone and db.scalar(select(User.id).where(User.phone == data.phone, User.id != user.id)):
            raise HTTPException(409, "Phone number already in use")
        user.phone = data.phone
    db.commit()
    emit(presence_audience(db, user.id), {"type": "user.updated", "user": user_public(db, user, None)})
    return user_me(user)


@router.post("/users/me/avatar", summary="Upload avatar image")
async def upload_avatar(file: UploadFile = File(...), user: User = Depends(current_user), db: Session = Depends(get_db)):
    info = await save_upload(file, {"image"})
    old, user.avatar_url = user.avatar_url, info["url"]
    db.commit()
    if old:
        delete_file_if_unused(db, old)
    return user_me(user)


@router.delete("/users/me/avatar", status_code=204, summary="Remove avatar")
def remove_avatar(user: User = Depends(current_user), db: Session = Depends(get_db)):
    old, user.avatar_url = user.avatar_url, None
    db.commit()
    if old:
        delete_file_if_unused(db, old)
    return Response(status_code=204)


@router.get("/users/search", summary="Search users by username or display name")
def search_users(q: str = Query(min_length=2, max_length=64), limit: int = Query(20, ge=1, le=50),
                 offset: int = Query(0, ge=0), user: User = Depends(current_user), db: Session = Depends(get_db)):
    pat = f"%{q.lower().replace('%', '').replace('_', '')}%"
    from sqlalchemy import func
    # a phone-looking query ('+1 415 555 0123', '(415) 555-0123', '4155550123') matches by trailing digits,
    # so the country code is optional. Needs 7+ digits so short strings can't enumerate users.
    digits = re.sub(r"\D", "", q)
    phone_like = bool(re.fullmatch(r"[\d\s().+-]+", q.strip())) and len(digits) >= 7
    blocked_me = select(Block.blocker_id).where(Block.blocked_id == user.id)
    rows = db.scalars(
        select(User).where(User.id != user.id, User.id.not_in(blocked_me),
                           or_(func.lower(User.username).like(pat), func.lower(User.display_name).like(pat),
                              User.phone.like(f"%{digits}") if phone_like else False))
        .order_by(User.username).limit(limit).offset(offset)).all()
    return [user_public(db, u, user.id) for u in rows]


@router.get("/users/{user_id}", summary="Get a user's public profile")
def get_user(user_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    u = db.get(User, user_id)
    if not u or db.scalar(select(Block.id).where(Block.blocker_id == user_id, Block.blocked_id == user.id)):
        raise HTTPException(404, "User not found")
    return user_public(db, u, user.id)


# ----- settings -----

@router.get("/settings", summary="Get my settings", tags=["Settings"])
def get_settings_(user: User = Depends(current_user)):
    return user_me(user)["settings"]


@router.patch("/settings", summary="Update privacy, theme and notification preferences", tags=["Settings"])
def update_settings(data: SettingsIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    for k, v in data.model_dump(exclude_none=True).items():
        setattr(user, k, v)
    db.commit()
    emit(presence_audience(db, user.id), {"type": "user.updated", "user": user_public(db, user, None)})
    return user_me(user)["settings"]


# ----- contacts -----

def _contact_out(db: Session, c: Contact, viewer_id: int) -> dict:
    return {"id": c.id, "nickname": c.nickname, "created_at": iso(c.created_at),
            "user": user_public(db, c.contact, viewer_id)}


@router.get("/contacts", summary="List my contacts", tags=["Users & Contacts"])
def list_contacts(q: str | None = None, limit: int = Query(100, ge=1, le=200), offset: int = Query(0, ge=0),
                  user: User = Depends(current_user), db: Session = Depends(get_db)):
    stmt = select(Contact).join(User, User.id == Contact.contact_id).where(Contact.owner_id == user.id)
    if q:
        from sqlalchemy import func
        pat = f"%{q.lower()}%"
        digits = re.sub(r"\D", "", q)
        conds = [func.lower(User.username).like(pat), func.lower(User.display_name).like(pat), func.lower(Contact.nickname).like(pat)]
        if len(digits) >= 3 and re.fullmatch(r"[\d\s().+-]+", q.strip()):
            conds.append(User.phone.like(f"%{digits}%"))
        stmt = stmt.where(or_(*conds))
    rows = db.scalars(stmt.order_by(User.display_name).limit(limit).offset(offset)).all()
    return [_contact_out(db, c, user.id) for c in rows]


@router.post("/contacts", status_code=201, summary="Add a contact by user id or username")
def add_contact(data: ContactIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    if data.user_id:
        target = db.get(User, data.user_id)
    elif data.username:
        target = db.scalar(select(User).where(User.username == data.username.lower()))
    else:
        raise HTTPException(422, "Provide user_id or username")
    if not target or target.id == user.id:
        raise HTTPException(404, "User not found")
    c = db.scalar(select(Contact).where(Contact.owner_id == user.id, Contact.contact_id == target.id))
    if not c:
        c = Contact(owner_id=user.id, contact_id=target.id, nickname=data.nickname)
        db.add(c)
        db.commit()
    return _contact_out(db, c, user.id)


@router.delete("/contacts/{user_id}", status_code=204, summary="Remove a contact")
def remove_contact(user_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    c = db.scalar(select(Contact).where(Contact.owner_id == user.id, Contact.contact_id == user_id))
    if c:
        db.delete(c)
        db.commit()
    return Response(status_code=204)


# ----- blocks -----

@router.get("/blocks", summary="List blocked users", tags=["Settings"])
def list_blocks(user: User = Depends(current_user), db: Session = Depends(get_db)):
    rows = db.scalars(select(Block).where(Block.blocker_id == user.id)).all()
    return [user_public(db, b.blocked, user.id) for b in rows]


@router.post("/blocks/{user_id}", status_code=204, summary="Block a user", tags=["Settings"])
def block(user_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    if user_id == user.id or not db.get(User, user_id):
        raise HTTPException(404, "User not found")
    if not db.scalar(select(Block.id).where(Block.blocker_id == user.id, Block.blocked_id == user_id)):
        db.add(Block(blocker_id=user.id, blocked_id=user_id))
        db.commit()
    emit([user.id], {"type": "blocks.updated"})
    return Response(status_code=204)


@router.delete("/blocks/{user_id}", status_code=204, summary="Unblock a user", tags=["Settings"])
def unblock(user_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    b = db.scalar(select(Block).where(Block.blocker_id == user.id, Block.blocked_id == user_id))
    if b:
        db.delete(b)
        db.commit()
    emit([user.id], {"type": "blocks.updated"})
    return Response(status_code=204)
