from fastapi import APIRouter, Depends, File, HTTPException, Query, Response, UploadFile
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..database import get_db, utcnow
from ..deps import current_user
from ..models import Chat, Member, Message, User
from ..schemas import (
    DirectChatIn, ForwardIn, GroupIn, GroupUpdateIn, MemberPrefsIn, MembersIn, MessageEditIn, MessageIn,
    ReactionIn, ReadIn, RoleIn,
)
from ..services import messaging, webhooks
from ..services.notify import notify
from ..services.realtime import emit
from ..services.serializers import serialize_chats
from ..services.uploads import delete_file_if_unused, save_upload

router = APIRouter(tags=["Chats & Groups"])
msg_router = APIRouter(tags=["Messages"])


def _chat_for(db: Session, chat_id: int, user: User) -> tuple[Chat, Member]:
    mem = messaging.get_member(db, chat_id, user.id)
    return db.get(Chat, chat_id), mem


def _admin_only(chat: Chat, mem: Member):
    if chat.type != "group":
        raise HTTPException(400, "Not a group chat")
    if mem.role != "admin":
        raise HTTPException(403, "Group admins only")


def _refresh(db: Session, chat_id: int):
    emit(messaging.member_ids(db, chat_id), {"type": "chat.updated", "chat_id": chat_id})


@router.get("/chats", summary="List my chats (newest activity first)")
def list_chats(q: str | None = None, archived: bool | None = None, limit: int = Query(50, ge=1, le=100), offset: int = Query(0, ge=0),
               user: User = Depends(current_user), db: Session = Depends(get_db)):
    stmt = select(Chat).join(Member, Member.chat_id == Chat.id).where(Member.user_id == user.id)
    if archived is not None:
        stmt = stmt.where(Member.archived.is_(archived))
    if q:
        pat = f"%{q.lower()}%"
        peers = select(Member.chat_id).join(User, User.id == Member.user_id).where(
            Member.user_id != user.id, func.lower(User.display_name).like(pat) | func.lower(User.username).like(pat))
        stmt = stmt.where(func.lower(func.coalesce(Chat.name, "")).like(pat) | Chat.id.in_(peers))
    chats = db.scalars(stmt.order_by(Member.pinned.desc(), Chat.last_message_at.desc()).limit(limit).offset(offset)).all()
    return serialize_chats(db, list(chats), user)


@router.get("/chats/{chat_id}", summary="Get one chat")
def get_chat(chat_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    chat, _ = _chat_for(db, chat_id, user)
    return serialize_chats(db, [chat], user)[0]


@router.post("/chats/direct", summary="Get or create a one-to-one chat")
def direct_chat(data: DirectChatIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    other = db.get(User, data.user_id)
    if not other or other.id == user.id:
        raise HTTPException(404, "User not found")
    if messaging.is_blocked_between(db, user.id, other.id):
        raise HTTPException(403, "You can't message this user")
    chat, created = messaging.get_or_create_direct(db, user, other)
    if created:
        _refresh(db, chat.id)
    return serialize_chats(db, [chat], user)[0]


@router.post("/chats/groups", status_code=201, summary="Create a group chat")
def create_group(data: GroupIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    ids = {i for i in data.member_ids if i != user.id}
    found = set(db.scalars(select(User.id).where(User.id.in_(ids)))) if ids else set()
    if found != ids:
        raise HTTPException(422, "Some members do not exist")
    chat = Chat(type="group", name=data.name.strip(), description=data.description, created_by=user.id)
    db.add(chat)
    db.flush()
    db.add(Member(chat_id=chat.id, user_id=user.id, role="admin"))
    db.add_all([Member(chat_id=chat.id, user_id=i) for i in found])
    db.commit()
    messaging.system_message(db, chat, f"{user.display_name} created group \"{chat.name}\"")
    for i in found:
        notify(db, i, "group.added", chat.name, f"{user.display_name} added you to the group", {"chat_id": chat.id})
    webhooks.dispatch(db, "chat.member_added", found, {"chat_id": chat.id})
    _refresh(db, chat.id)
    return serialize_chats(db, [chat], user)[0]


@router.patch("/chats/{chat_id}", summary="Edit group name/description (admins)")
def update_group(chat_id: int, data: GroupUpdateIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    chat, mem = _chat_for(db, chat_id, user)
    _admin_only(chat, mem)
    if data.name is not None:
        chat.name = data.name.strip()
    if data.description is not None:
        chat.description = data.description
    db.commit()
    _refresh(db, chat_id)
    return serialize_chats(db, [chat], user)[0]


@router.post("/chats/{chat_id}/avatar", summary="Set group icon (admins)")
async def group_avatar(chat_id: int, file: UploadFile = File(...), user: User = Depends(current_user),
                       db: Session = Depends(get_db)):
    chat, mem = _chat_for(db, chat_id, user)
    _admin_only(chat, mem)
    info = await save_upload(file, {"image"})
    old, chat.avatar_url = chat.avatar_url, info["url"]
    db.commit()
    if old:
        delete_file_if_unused(db, old)
    _refresh(db, chat_id)
    return serialize_chats(db, [chat], user)[0]


@router.post("/chats/{chat_id}/members", summary="Add members (admins)")
def add_members(chat_id: int, data: MembersIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    chat, mem = _chat_for(db, chat_id, user)
    _admin_only(chat, mem)
    existing = set(messaging.member_ids(db, chat_id))
    new = {i for i in data.user_ids if i not in existing}
    users = list(db.scalars(select(User).where(User.id.in_(new)))) if new else []
    if len(existing) + len(users) > 256:
        raise HTTPException(422, "Group is limited to 256 members")
    for u in users:
        db.add(Member(chat_id=chat_id, user_id=u.id))
    db.commit()
    for u in users:
        messaging.system_message(db, chat, f"{user.display_name} added {u.display_name}")
        notify(db, u.id, "group.added", chat.name or "Group", f"{user.display_name} added you to the group", {"chat_id": chat_id})
    webhooks.dispatch(db, "chat.member_added", [u.id for u in users], {"chat_id": chat_id})
    _refresh(db, chat_id)
    return serialize_chats(db, [chat], user)[0]


@router.delete("/chats/{chat_id}/members/{user_id}", status_code=204, summary="Remove a member, or leave (own id)")
def remove_member(chat_id: int, user_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    chat, mem = _chat_for(db, chat_id, user)
    if chat.type != "group":
        raise HTTPException(400, "Not a group chat")
    target = mem if user_id == user.id else None
    if not target:
        _admin_only(chat, mem)
        target = db.scalar(select(Member).where(Member.chat_id == chat_id, Member.user_id == user_id))
        if not target:
            raise HTTPException(404, "Member not found")
    removed = db.get(User, user_id)
    was_admin = target.role == "admin"
    db.delete(target)
    db.commit()
    remaining = db.scalars(select(Member).where(Member.chat_id == chat_id).order_by(Member.joined_at)).all()
    if was_admin and remaining and not any(m.role == "admin" for m in remaining):
        remaining[0].role = "admin"  # never leave a group without an admin
        db.commit()
    text = f"{removed.display_name} left" if user_id == user.id else f"{user.display_name} removed {removed.display_name}"
    messaging.system_message(db, chat, text)
    emit([user_id], {"type": "chat.removed", "chat_id": chat_id})
    _refresh(db, chat_id)
    return Response(status_code=204)


@router.patch("/chats/{chat_id}/members/{user_id}", summary="Promote / demote a member (admins)")
def set_role(chat_id: int, user_id: int, data: RoleIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    chat, mem = _chat_for(db, chat_id, user)
    _admin_only(chat, mem)
    target = db.scalar(select(Member).where(Member.chat_id == chat_id, Member.user_id == user_id))
    if not target:
        raise HTTPException(404, "Member not found")
    if data.role == "member" and target.role == "admin":
        admins = db.scalar(select(func.count()).select_from(Member).where(Member.chat_id == chat_id, Member.role == "admin"))
        if admins <= 1:
            raise HTTPException(409, "A group needs at least one admin")
    target.role = data.role
    db.commit()
    _refresh(db, chat_id)
    return serialize_chats(db, [chat], user)[0]


MAX_PINNED = 3


@router.patch("/chats/{chat_id}/me", summary="Mute / archive / pin a chat (only for me)")
def my_prefs(chat_id: int, data: MemberPrefsIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    chat, mem = _chat_for(db, chat_id, user)
    if data.muted is None and data.archived is None and data.pinned is None:
        raise HTTPException(422, "Nothing to change")
    if data.muted is not None:
        mem.muted = data.muted
    if data.archived is not None:
        mem.archived = data.archived
        if data.archived:
            mem.pinned = False  # archiving drops the pin, like WhatsApp
    if data.pinned is not None:
        if data.pinned and not mem.pinned:
            count = db.scalar(select(func.count()).select_from(Member).where(Member.user_id == user.id, Member.pinned.is_(True)))
            if count >= MAX_PINNED:
                raise HTTPException(409, f"You can pin up to {MAX_PINNED} chats")
            mem.archived = False  # a pinned chat is always in the main list
        mem.pinned = data.pinned
    db.commit()
    emit([user.id], {"type": "chat.updated", "chat_id": chat_id})  # keep my other tabs in sync
    return serialize_chats(db, [chat], user)[0]


@router.post("/chats/read-all", summary="Mark every chat as read")
def read_all(user: User = Depends(current_user), db: Session = Depends(get_db)):
    done = 0
    for mem in db.scalars(select(Member).where(Member.user_id == user.id)).all():
        latest = db.scalar(select(func.max(Message.id)).where(Message.chat_id == mem.chat_id))
        if latest and latest > mem.last_read_message_id:
            messaging.mark_read(db, user, mem.chat_id, None)
            done += 1
    return {"chats": done}


# ---------------- messages ----------------

@msg_router.get("/chats/{chat_id}/messages", summary="Message history (cursor pagination, newest page first)")
def history(chat_id: int, before_id: int | None = None, limit: int = Query(30, ge=1, le=100),
            user: User = Depends(current_user), db: Session = Depends(get_db)):
    return messaging.list_messages(db, user, chat_id, before_id, limit)


@msg_router.post("/chats/{chat_id}/messages", status_code=201, summary="Send a message")
def send(chat_id: int, data: MessageIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return messaging.send_message(db, user, chat_id, body=data.body, reply_to_id=data.reply_to_id,
                                  attachment_ids=data.attachment_ids, sticker=data.sticker, video_note=data.video_note)


@msg_router.post("/chats/{chat_id}/read", summary="Mark messages as read")
def read(chat_id: int, data: ReadIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return {"up_to_id": messaging.mark_read(db, user, chat_id, data.up_to_id)}


@msg_router.get("/search/messages", summary="Search message text across my chats")
def search(q: str = Query(min_length=2, max_length=100), chat_id: int | None = None,
           limit: int = Query(30, ge=1, le=100), user: User = Depends(current_user), db: Session = Depends(get_db)):
    return messaging.search_messages(db, user, q, chat_id, limit)


@msg_router.patch("/messages/{message_id}", summary="Edit my text message")
def edit(message_id: int, data: MessageEditIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return messaging.edit_message(db, user, message_id, data.body)


@msg_router.delete("/messages/{message_id}", status_code=204, summary="Delete for me or for everyone")
def delete(message_id: int, scope: str = Query("me", pattern="^(me|everyone)$"),
           user: User = Depends(current_user), db: Session = Depends(get_db)):
    messaging.delete_message(db, user, message_id, scope)
    return Response(status_code=204)


@msg_router.put("/messages/{message_id}/reaction", summary="React to a message (replaces my previous reaction)")
def react(message_id: int, data: ReactionIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return messaging.set_reaction(db, user, message_id, data.emoji)


@msg_router.delete("/messages/{message_id}/reaction", summary="Remove my reaction")
def unreact(message_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return messaging.set_reaction(db, user, message_id, None)


@msg_router.post("/messages/forward", summary="Forward messages to other chats")
def forward(data: ForwardIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return messaging.forward_messages(db, user, data.message_ids, data.chat_ids)
