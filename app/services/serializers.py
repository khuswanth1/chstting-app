"""Turn ORM objects into JSON-ready dicts (applying privacy rules)."""
from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..models import Chat, Contact, Member, Message, MessageHidden, Status, StatusView, User


def iso(dt: datetime | None) -> str | None:
    return dt.isoformat().replace("+00:00", "Z") if dt else None


def is_contact_of(db: Session, owner_id: int, viewer_id: int) -> bool:
    return db.scalar(select(Contact.id).where(Contact.owner_id == owner_id, Contact.contact_id == viewer_id)) is not None


def _allowed(db: Session, setting: str, owner: User, viewer_id: int | None) -> bool:
    if viewer_id == owner.id or setting == "everyone":
        return True
    if setting == "contacts" and viewer_id is not None:
        return is_contact_of(db, owner.id, viewer_id)
    return False


def user_public(db: Session, u: User, viewer_id: int | None) -> dict:
    show_presence = _allowed(db, u.privacy_last_seen, u, viewer_id)
    show_avatar = _allowed(db, u.privacy_avatar, u, viewer_id)
    return {
        "id": u.id,
        "username": u.username,
        "display_name": u.display_name,
        "about": u.about,
        "avatar_url": u.avatar_url if show_avatar else None,
        "is_online": u.is_online if show_presence else False,
        "last_seen": iso(u.last_seen) if show_presence else None,
    }


def user_me(u: User) -> dict:
    return {
        "id": u.id, "username": u.username, "email": u.email, "phone": u.phone, "display_name": u.display_name,
        "about": u.about, "avatar_url": u.avatar_url, "created_at": iso(u.created_at),
        "settings": {
            "privacy_last_seen": u.privacy_last_seen, "privacy_avatar": u.privacy_avatar,
            "privacy_read_receipts": u.privacy_read_receipts, "theme": u.theme,
            "notify_messages": u.notify_messages, "notify_groups": u.notify_groups,
            "notify_sound": u.notify_sound, "notify_desktop": u.notify_desktop,
        },
    }


def attachment_out(a) -> dict:
    return {"id": a.id, "kind": a.kind, "url": a.url, "filename": a.filename,
            "mime": a.mime, "size": a.size, "duration": a.duration}


def message_status(m: Message) -> str | None:
    rs = m.receipts
    if not rs:
        return None
    if all(r.read_at for r in rs):
        return "read"
    if all(r.delivered_at for r in rs):
        return "delivered"
    return "sent"


def serialize_message(m: Message) -> dict:
    deleted = m.deleted_at is not None
    reply = None
    if m.reply_to is not None:
        r = m.reply_to
        reply = {
            "id": r.id, "sender_id": r.sender_id, "type": r.type,
            "body": None if r.deleted_at else (r.body or "")[:140],
            "deleted": r.deleted_at is not None,
        }
    return {
        "id": m.id, "chat_id": m.chat_id, "sender_id": m.sender_id, "type": m.type,
        "body": None if deleted else m.body,
        "reply_to": reply, "forwarded": m.forwarded, "status_ref": None if deleted else m.status_ref,
        "edited_at": iso(m.edited_at), "deleted": deleted, "created_at": iso(m.created_at),
        "attachments": [] if deleted else [attachment_out(a) for a in m.attachments],
        "reactions": [] if deleted else [{"user_id": r.user_id, "emoji": r.emoji} for r in m.reactions],
        "status": message_status(m),
    }


def hidden_ids_subq(user_id: int):
    return select(MessageHidden.message_id).where(MessageHidden.user_id == user_id)


def serialize_chats(db: Session, chats: list[Chat], viewer: User) -> list[dict]:
    if not chats:
        return []
    ids = [c.id for c in chats]
    hidden = hidden_ids_subq(viewer.id)

    my = {m.chat_id: m for m in db.scalars(select(Member).where(Member.chat_id.in_(ids), Member.user_id == viewer.id))}

    unread = dict(db.execute(
        select(Message.chat_id, func.count(Message.id))
        .join(Member, (Member.chat_id == Message.chat_id) & (Member.user_id == viewer.id))
        .where(Message.chat_id.in_(ids), Message.id > Member.last_read_message_id,
               Message.sender_id != viewer.id, Message.deleted_at.is_(None),
               Message.type != "system", Message.id.not_in(hidden))
        .group_by(Message.chat_id)
    ).all())

    last_ids = db.scalars(
        select(func.max(Message.id)).where(Message.chat_id.in_(ids), Message.id.not_in(hidden)).group_by(Message.chat_id)
    ).all()
    last = {m.chat_id: m for m in db.scalars(select(Message).where(Message.id.in_(last_ids)))} if last_ids else {}

    members = db.scalars(select(Member).where(Member.chat_id.in_(ids))).all()
    by_chat: dict[int, list[Member]] = {}
    for mem in members:
        by_chat.setdefault(mem.chat_id, []).append(mem)

    out = []
    for c in chats:
        mem_list = by_chat.get(c.id, [])
        item = {
            "id": c.id, "type": c.type, "name": c.name, "description": c.description,
            "avatar_url": c.avatar_url, "created_by": c.created_by, "created_at": iso(c.created_at),
            "last_message_at": iso(c.last_message_at),
            "unread_count": unread.get(c.id, 0),
            "muted": my[c.id].muted if c.id in my else False,
            "archived": my[c.id].archived if c.id in my else False,
            "pinned": my[c.id].pinned if c.id in my else False,
            "my_role": my[c.id].role if c.id in my else None,
            "last_message": serialize_message(last[c.id]) if c.id in last else None,
            "members": [{"user": user_public(db, m.user, viewer.id), "role": m.role} for m in mem_list]
            if c.type == "group" else [],
            "peer": None,
        }
        if c.type == "direct":
            peer = next((m.user for m in mem_list if m.user_id != viewer.id), None)
            item["peer"] = user_public(db, peer, viewer.id) if peer else None
        out.append(item)
    return out


def serialize_status(db: Session, s: Status, viewer_id: int) -> dict:
    mine = next((v for v in s.views if v.viewer_id == viewer_id), None)
    return {
        "id": s.id, "user_id": s.user_id, "type": s.type, "body": s.body, "bg_color": s.bg_color,
        "media_url": s.media_url, "music_url": s.music_url, "music_title": s.music_title, "created_at": iso(s.created_at), "expires_at": iso(s.expires_at),
        "viewed": s.user_id == viewer_id or mine is not None,
        "my_reaction": mine.reaction if mine else None,
        "view_count": len(s.views) if s.user_id == viewer_id else None,
    }


def serialize_viewer(db: Session, v: StatusView, owner_id: int) -> dict:
    return {"user": user_public(db, v.viewer, owner_id), "viewed_at": iso(v.viewed_at), "reaction": v.reaction}
