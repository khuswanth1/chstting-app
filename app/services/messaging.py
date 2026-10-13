"""Chat / message business logic shared by REST routes and WebSocket handlers."""
from datetime import timedelta

from fastapi import HTTPException
from sqlalchemy import or_, select, update
from sqlalchemy.orm import Session, selectinload

from ..database import utcnow
from ..models import (
    Attachment, Block, Chat, Member, Message, MessageHidden, Reaction, Receipt, User,
)
from . import webhooks
from .realtime import emit, manager
from .serializers import hidden_ids_subq, serialize_message
from .uploads import delete_file_if_unused

MSG_LOAD = (
    selectinload(Message.attachments), selectinload(Message.reactions),
    selectinload(Message.receipts), selectinload(Message.reply_to),
)


# ---------- lookups / guards ----------

def db_user(db: Session, user_id: int) -> User:
    u = db.get(User, user_id)
    if not u:
        raise HTTPException(401, "User no longer exists")
    return u


def get_member(db: Session, chat_id: int, user_id: int) -> Member:
    m = db.scalar(select(Member).where(Member.chat_id == chat_id, Member.user_id == user_id))
    if not m:
        raise HTTPException(404, "Chat not found")
    return m


def member_ids(db: Session, chat_id: int) -> list[int]:
    return list(db.scalars(select(Member.user_id).where(Member.chat_id == chat_id)))


def is_blocked_between(db: Session, a: int, b: int) -> bool:
    return db.scalar(select(Block.id).where(
        or_((Block.blocker_id == a) & (Block.blocked_id == b), (Block.blocker_id == b) & (Block.blocked_id == a))
    ).limit(1)) is not None


def load_message(db: Session, message_id: int) -> Message | None:
    return db.scalar(select(Message).options(*MSG_LOAD).where(Message.id == message_id)
                     .execution_options(populate_existing=True))


def get_visible_message(db: Session, message_id: int, user_id: int) -> Message:
    msg = load_message(db, message_id)
    if not msg:
        raise HTTPException(404, "Message not found")
    get_member(db, msg.chat_id, user_id)
    if db.scalar(select(MessageHidden.id).where(MessageHidden.message_id == message_id, MessageHidden.user_id == user_id)):
        raise HTTPException(404, "Message not found")
    return msg


def get_or_create_direct(db: Session, user: User, other: User) -> tuple[Chat, bool]:
    key = f"{min(user.id, other.id)}:{max(user.id, other.id)}"
    chat = db.scalar(select(Chat).where(Chat.direct_key == key))
    if chat:
        return chat, False
    chat = Chat(type="direct", direct_key=key, created_by=user.id)
    db.add(chat)
    db.flush()
    db.add_all([Member(chat_id=chat.id, user_id=user.id), Member(chat_id=chat.id, user_id=other.id)])
    db.commit()
    return chat, True


# ---------- create ----------

def validate_sticker(body: str | None) -> str:
    """A sticker is one emoji (any non-ASCII symbol run, max 16 chars) plus an optional short caption line."""
    parts = (body or "").strip().split("\n")
    emoji, caption = parts[0].strip(), (parts[1].strip() if len(parts) > 1 else "")
    if len(parts) > 2 or not 0 < len(emoji) <= 16 or any(c.isascii() and (c.isalnum() or c.isspace()) for c in emoji) or emoji.isascii() or len(caption) > 24:
        raise HTTPException(422, "Invalid sticker")
    return f"{emoji}\n{caption}" if caption else emoji


def create_message(
    db: Session, sender: User | None, chat: Chat, *, body: str | None = None, reply_to_id: int | None = None,
    attachment_ids: list[int] | None = None, forwarded: bool = False, system: bool = False,
    copy_from: list[Attachment] | None = None, status_ref: dict | None = None, sticker: bool = False,
    video_note: bool = False,
) -> Message:
    ids = member_ids(db, chat.id)
    if sticker:
        body = validate_sticker(body)
        if attachment_ids or copy_from:
            raise HTTPException(422, "Stickers cannot have attachments")
    if video_note:
        only_video = len(attachment_ids or []) == 1 or (copy_from and len(copy_from) == 1 and copy_from[0].kind == "video")
        if not only_video or sticker:
            raise HTTPException(422, "A video note is exactly one video")
    if not system:
        if chat.type == "direct":
            other = next((i for i in ids if i != sender.id), None)
            if other and is_blocked_between(db, sender.id, other):
                raise HTTPException(403, "You can't message this user")
        if not body and not attachment_ids and not copy_from:
            raise HTTPException(422, "Message needs text or an attachment")

    if reply_to_id:
        parent = db.get(Message, reply_to_id)
        if not parent or parent.chat_id != chat.id:
            raise HTTPException(422, "Reply target not found in this chat")

    atts: list[Attachment] = []
    if attachment_ids:
        atts = list(db.scalars(select(Attachment).where(
            Attachment.id.in_(attachment_ids), Attachment.uploader_id == sender.id, Attachment.message_id.is_(None))))
        if len(atts) != len(set(attachment_ids)):
            raise HTTPException(422, "Invalid attachment")

    msg_type = "system" if system else "sticker" if sticker else (atts[0].kind if atts else (copy_from[0].kind if copy_from else "text"))
    if video_note and atts and atts[0].kind != "video":
        raise HTTPException(422, "A video note must be a video")
    msg = Message(chat_id=chat.id, sender_id=sender.id if sender else None, type="videonote" if video_note else msg_type, body=body or None,
                  reply_to_id=reply_to_id, forwarded=forwarded, status_ref=status_ref)
    db.add(msg)
    db.flush()
    for a in atts:
        a.message_id = msg.id
    for a in copy_from or []:
        db.add(Attachment(uploader_id=sender.id, message_id=msg.id, kind=a.kind, url=a.url, filename=a.filename,
                          mime=a.mime, size=a.size, duration=a.duration))
    if not system:
        for uid in ids:
            if uid != sender.id:
                db.add(Receipt(message_id=msg.id, user_id=uid))
    chat.last_message_at = msg.created_at or utcnow()
    if sender:
        db.execute(update(Member).where(Member.chat_id == chat.id, Member.user_id == sender.id)
                   .values(last_read_message_id=msg.id))
    db.commit()
    return load_message(db, msg.id)


def publish_new_message(db: Session, msg: Message) -> dict:
    """Mark delivered for online recipients, push over WebSocket, fire webhooks."""
    ids = member_ids(db, msg.chat_id)
    recipients = [u for u in ids if u != msg.sender_id]
    now = utcnow()
    delivered = [r for r in msg.receipts if manager.is_online(r.user_id) and not r.delivered_at]
    for r in delivered:
        r.delivered_at = now
    if delivered:
        db.commit()
    payload = serialize_message(load_message(db, msg.id))
    emit(ids, {"type": "message.new", "message": payload})
    if delivered and msg.sender_id:
        for r in delivered:
            emit([msg.sender_id], {"type": "receipt.update", "chat_id": msg.chat_id, "message_ids": [msg.id],
                                   "user_id": r.user_id, "status": "delivered"})
    if msg.sender_id and msg.type != "system":
        _maybe_ai_reply(db, msg)
        webhooks.dispatch(db, "message.created", recipients, {"message": payload})
    return payload


def _maybe_ai_reply(db: Session, msg: Message) -> None:
    from . import ai
    if not ai.enabled() or msg.type not in ("text", "sticker"):
        return
    chat = db.get(Chat, msg.chat_id)
    bot = ai.is_bot_chat(db, chat)
    if bot and msg.sender_id != bot.id:
        ai.schedule_bot_reply(chat.id, msg.sender_id)


def send_message(db: Session, sender: User, chat_id: int, **kw) -> dict:
    get_member(db, chat_id, sender.id)
    chat = db.get(Chat, chat_id)
    msg = create_message(db, sender, chat, **kw)
    return publish_new_message(db, msg)


def system_message(db: Session, chat: Chat, text: str) -> None:
    msg = create_message(db, None, chat, body=text, system=True)
    publish_new_message(db, msg)


# ---------- history ----------

def list_messages(db: Session, user: User, chat_id: int, before_id: int | None, limit: int) -> dict:
    get_member(db, chat_id, user.id)
    q = (select(Message).options(*MSG_LOAD)
         .where(Message.chat_id == chat_id, Message.id.not_in(hidden_ids_subq(user.id))))
    if before_id:
        q = q.where(Message.id < before_id)
    rows = list(db.scalars(q.order_by(Message.id.desc()).limit(limit + 1)))
    has_more = len(rows) > limit
    rows = rows[:limit][::-1]
    return {"items": [serialize_message(m) for m in rows], "has_more": has_more,
            "next_before_id": rows[0].id if rows and has_more else None}


def search_messages(db: Session, user: User, q: str, chat_id: int | None, limit: int) -> list[dict]:
    my_chats = select(Member.chat_id).where(Member.user_id == user.id)
    stmt = (select(Message).options(*MSG_LOAD)
            .where(Message.chat_id.in_(my_chats), Message.deleted_at.is_(None), Message.type != "system",
                   Message.body.ilike(f"%{q.replace('%', '').replace('_', '')}%"),
                   Message.id.not_in(hidden_ids_subq(user.id))))
    if chat_id:
        stmt = stmt.where(Message.chat_id == chat_id)
    return [serialize_message(m) for m in db.scalars(stmt.order_by(Message.id.desc()).limit(limit))]


# ---------- mutate ----------

def edit_message(db: Session, user: User, message_id: int, body: str) -> dict:
    msg = get_visible_message(db, message_id, user.id)
    if msg.sender_id != user.id or msg.type != "text" or msg.deleted_at:
        raise HTTPException(403, "You can only edit your own text messages")
    msg.body, msg.edited_at = body.strip(), utcnow()
    db.commit()
    payload = serialize_message(load_message(db, message_id))
    ids = member_ids(db, msg.chat_id)
    emit(ids, {"type": "message.updated", "message": payload})
    webhooks.dispatch(db, "message.updated", [i for i in ids if i != user.id], {"message": payload})
    return payload


def delete_message(db: Session, user: User, message_id: int, scope: str) -> None:
    msg = get_visible_message(db, message_id, user.id)
    if scope == "me":
        db.add(MessageHidden(message_id=message_id, user_id=user.id))
        db.commit()
        emit([user.id], {"type": "message.deleted", "chat_id": msg.chat_id, "message_id": message_id, "scope": "me"})
        return
    if msg.sender_id != user.id:
        raise HTTPException(403, "Only the sender can delete a message for everyone")
    urls = [a.url for a in msg.attachments]
    msg.deleted_at, msg.body = utcnow(), None
    for a in list(msg.attachments):
        db.delete(a)
    db.commit()
    for url in urls:
        delete_file_if_unused(db, url)
    ids = member_ids(db, msg.chat_id)
    emit(ids, {"type": "message.deleted", "chat_id": msg.chat_id, "message_id": message_id, "scope": "everyone"})
    webhooks.dispatch(db, "message.deleted", [i for i in ids if i != user.id],
                      {"chat_id": msg.chat_id, "message_id": message_id})


def set_reaction(db: Session, user: User, message_id: int, emoji: str | None) -> list[dict]:
    msg = get_visible_message(db, message_id, user.id)
    if msg.deleted_at or msg.type == "system":
        raise HTTPException(422, "Cannot react to this message")
    existing = db.scalar(select(Reaction).where(Reaction.message_id == message_id, Reaction.user_id == user.id))
    if emoji is None:
        if existing:
            db.delete(existing)
    elif existing:
        existing.emoji = emoji
    else:
        db.add(Reaction(message_id=message_id, user_id=user.id, emoji=emoji))
    db.commit()
    reactions = serialize_message(load_message(db, message_id))["reactions"]
    emit(member_ids(db, msg.chat_id),
         {"type": "reaction.updated", "chat_id": msg.chat_id, "message_id": message_id, "reactions": reactions})
    return reactions


def forward_messages(db: Session, user: User, message_ids: list[int], chat_ids: list[int]) -> list[dict]:
    sources = []
    for mid in message_ids:
        m = get_visible_message(db, mid, user.id)
        if m.deleted_at or m.type == "system":
            raise HTTPException(422, "Cannot forward this message")
        sources.append(m)
    sources.sort(key=lambda m: m.id)
    out = []
    for cid in dict.fromkeys(chat_ids):
        get_member(db, cid, user.id)
        chat = db.get(Chat, cid)
        for m in sources:
            msg = create_message(db, user, chat, body=m.body, forwarded=True, copy_from=list(m.attachments) or None,
                                 sticker=m.type == "sticker", video_note=m.type == "videonote")
            out.append(publish_new_message(db, msg))
    return out


# ---------- receipts ----------

def mark_read(db: Session, user: User, chat_id: int, up_to_id: int | None) -> int:
    member = get_member(db, chat_id, user.id)
    if up_to_id is None:
        up_to_id = db.scalar(select(Message.id).where(Message.chat_id == chat_id).order_by(Message.id.desc()).limit(1)) or 0
    if up_to_id > member.last_read_message_id:
        member.last_read_message_id = up_to_id
    now = utcnow()
    by_sender: dict[int, list[int]] = {}
    if user.privacy_read_receipts:
        rows = db.execute(
            select(Receipt, Message.sender_id).join(Message, Message.id == Receipt.message_id)
            .where(Message.chat_id == chat_id, Message.id <= up_to_id, Receipt.user_id == user.id,
                   Receipt.read_at.is_(None))).all()
        for r, sender_id in rows:
            r.read_at = now
            r.delivered_at = r.delivered_at or now
            by_sender.setdefault(sender_id, []).append(r.message_id)
    db.commit()
    for sender_id, mids in by_sender.items():
        if sender_id:
            emit([sender_id], {"type": "receipt.update", "chat_id": chat_id, "message_ids": mids,
                               "user_id": user.id, "status": "read"})
    emit([user.id], {"type": "chat.read", "chat_id": chat_id, "up_to_id": up_to_id})
    return up_to_id


def deliver_pending(db: Session, user_id: int) -> None:
    """Called when a user connects: everything addressed to them is now 'delivered'."""
    rows = db.execute(
        select(Receipt, Message.sender_id, Message.chat_id).join(Message, Message.id == Receipt.message_id)
        .where(Receipt.user_id == user_id, Receipt.delivered_at.is_(None))).all()
    now = utcnow()
    groups: dict[tuple[int, int], list[int]] = {}
    for r, sender_id, chat_id in rows:
        r.delivered_at = now
        if sender_id:
            groups.setdefault((sender_id, chat_id), []).append(r.message_id)
    db.commit()
    for (sender_id, chat_id), mids in groups.items():
        emit([sender_id], {"type": "receipt.update", "chat_id": chat_id, "message_ids": mids,
                           "user_id": user_id, "status": "delivered"})
