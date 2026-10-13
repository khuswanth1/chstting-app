import re
from typing import Literal

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import current_user
from ..models import Attachment, Member, Message, User
from ..services import messaging
from ..services.serializers import hidden_ids_subq, iso

router = APIRouter(prefix="/media", tags=["Media"])

URL_RE = re.compile(r"https?://[^\s<>\"']+", re.I)
KINDS = {"media": ("image", "video"), "docs": ("document",), "audio": ("audio",)}
Kind = Literal["media", "docs", "links", "audio"]


def _scope(db: Session, user: User, chat_id: int | None):
    """Chats whose media I may see: one chat (membership checked) or all of mine."""
    if chat_id is not None:
        messaging.get_member(db, chat_id, user.id)
        return [chat_id]
    return select(Member.chat_id).where(Member.user_id == user.id)


def _visible(user: User, scope):
    cond = [Message.deleted_at.is_(None), Message.id.not_in(hidden_ids_subq(user.id))]
    cond.append(Message.chat_id.in_(scope) if isinstance(scope, list) else Message.chat_id.in_(scope))
    return cond


@router.get("", summary="Media gallery: photos & videos, documents, links or voice notes (one chat or all my chats)")
def gallery(kind: Kind = "media", chat_id: int | None = None, before_id: int | None = Query(None, description="cursor from next_before_id"),
            limit: int = Query(40, ge=1, le=100), user: User = Depends(current_user), db: Session = Depends(get_db)):
    scope = _scope(db, user, chat_id)
    if kind == "links":
        q = select(Message).where(*_visible(user, scope), Message.type == "text", Message.body.ilike("%http%"))
        if before_id:
            q = q.where(Message.id < before_id)
        msgs = db.scalars(q.order_by(Message.id.desc()).limit(limit + 1)).all()
        has_more = len(msgs) > limit
        items = []
        for m in msgs[:limit]:
            for url in dict.fromkeys(u.rstrip(".,;:!?)") for u in URL_RE.findall(m.body or "")):
                items.append({"id": f"{m.id}:{len(items)}", "message_id": m.id, "chat_id": m.chat_id, "sender_id": m.sender_id,
                              "url": url, "text": (m.body or "")[:200], "created_at": iso(m.created_at)})
        return {"items": items, "has_more": has_more, "next_before_id": msgs[limit - 1].id if has_more else None}

    q = (select(Attachment, Message).join(Message, Message.id == Attachment.message_id)
         .where(*_visible(user, scope), Attachment.kind.in_(KINDS[kind])))
    if before_id:
        q = q.where(Attachment.id < before_id)
    rows = db.execute(q.order_by(Attachment.id.desc()).limit(limit + 1)).all()
    has_more = len(rows) > limit
    rows = rows[:limit]
    items = [{
        "id": a.id, "message_id": m.id, "chat_id": m.chat_id, "sender_id": m.sender_id, "kind": a.kind, "url": a.url,
        "filename": a.filename, "mime": a.mime, "size": a.size, "duration": a.duration,
        "video_note": m.type == "videonote", "created_at": iso(m.created_at),
    } for a, m in rows]
    return {"items": items, "has_more": has_more, "next_before_id": rows[-1][0].id if has_more and rows else None}


@router.get("/summary", summary="How many items of each kind (for the gallery tabs)")
def summary(chat_id: int | None = None, user: User = Depends(current_user), db: Session = Depends(get_db)):
    scope = _scope(db, user, chat_id)
    out = {}
    for name, kinds in KINDS.items():
        out[name] = db.scalar(select(func.count(Attachment.id)).join(Message, Message.id == Attachment.message_id)
                              .where(*_visible(user, scope), Attachment.kind.in_(kinds))) or 0
    out["links"] = db.scalar(select(func.count(Message.id)).where(*_visible(user, scope), Message.type == "text",
                                                                  Message.body.ilike("%http%"))) or 0
    return out
