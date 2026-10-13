from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import current_user
from ..models import Member, Message, StarredMessage, User
from ..services import messaging
from ..services.serializers import hidden_ids_subq, serialize_message

router = APIRouter(tags=["Starred messages"])


@router.put("/messages/{message_id}/star", status_code=204, summary="Star a message (private to me)")
def star(message_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    msg = messaging.get_visible_message(db, message_id, user.id)
    if msg.deleted_at or msg.type == "system":
        raise HTTPException(422, "This message can't be starred")
    if not db.scalar(select(StarredMessage.id).where(StarredMessage.user_id == user.id, StarredMessage.message_id == message_id)):
        db.add(StarredMessage(user_id=user.id, message_id=message_id))
        db.commit()
    return Response(status_code=204)


@router.delete("/messages/{message_id}/star", status_code=204, summary="Remove the star")
def unstar(message_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    row = db.scalar(select(StarredMessage).where(StarredMessage.user_id == user.id, StarredMessage.message_id == message_id))
    if row:
        db.delete(row)
        db.commit()
    return Response(status_code=204)


@router.get("/starred/ids", summary="Ids of all my starred messages (to draw the star icons)")
def starred_ids(user: User = Depends(current_user), db: Session = Depends(get_db)):
    return {"ids": list(db.scalars(select(StarredMessage.message_id).where(StarredMessage.user_id == user.id)))}


@router.get("/starred", summary="My starred messages, newest star first")
def starred(before_id: int | None = Query(None, description="cursor from next_before_id"), limit: int = Query(30, ge=1, le=100),
            user: User = Depends(current_user), db: Session = Depends(get_db)):
    my_chats = select(Member.chat_id).where(Member.user_id == user.id)  # still a member of the chat
    q = (select(StarredMessage, Message).join(Message, Message.id == StarredMessage.message_id)
         .where(StarredMessage.user_id == user.id, Message.deleted_at.is_(None), Message.chat_id.in_(my_chats),
                Message.id.not_in(hidden_ids_subq(user.id))))
    if before_id:
        q = q.where(StarredMessage.id < before_id)
    rows = db.execute(q.order_by(StarredMessage.id.desc()).limit(limit + 1)).all()
    has_more = len(rows) > limit
    rows = rows[:limit]
    full = {m.id: m for m in db.scalars(select(Message).options(*messaging.MSG_LOAD).where(Message.id.in_([m.id for _, m in rows])))} if rows else {}
    return {"items": [{"id": s.id, "message": serialize_message(full[m.id])} for s, m in rows],
            "has_more": has_more, "next_before_id": rows[-1][0].id if has_more and rows else None}
