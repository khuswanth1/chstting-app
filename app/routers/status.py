from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import or_, select
from sqlalchemy.orm import Session, selectinload

from ..config import get_settings
from ..database import get_db, utcnow
from ..deps import current_user
from ..models import Attachment, Block, Chat, Contact, Member, Status, StatusView, User
from ..schemas import ReactionIn, StatusIn, StatusReplyIn
from ..services import messaging, webhooks
from ..services.notify import notify
from ..services.realtime import emit
from ..services.serializers import serialize_status, serialize_viewer, user_public
from ..services.uploads import delete_file_if_unused

router = APIRouter(prefix="/statuses", tags=["Status"])


def visible_owner_ids(db: Session, viewer: User) -> set[int]:
    """Owners whose statuses I may see: my contacts + people I have a direct chat with, minus blocks."""
    ids = set(db.scalars(select(Contact.contact_id).where(Contact.owner_id == viewer.id)))
    mine = select(Member.chat_id).join(Chat, Chat.id == Member.chat_id).where(Member.user_id == viewer.id, Chat.type == "direct")
    ids |= set(db.scalars(select(Member.user_id).where(Member.chat_id.in_(mine))))
    blocks = db.scalars(select(Block).where(or_(Block.blocker_id == viewer.id, Block.blocked_id == viewer.id))).all()
    for b in blocks:
        ids.discard(b.blocked_id)
        ids.discard(b.blocker_id)
    ids.discard(viewer.id)
    return ids


def _active(db: Session, status_id: int) -> Status:
    s = db.scalar(select(Status).options(selectinload(Status.views)).where(Status.id == status_id, Status.expires_at > utcnow()))
    if not s:
        raise HTTPException(404, "Status not found or expired")
    return s


def _check_visible(db: Session, s: Status, user: User):
    if s.user_id != user.id and s.user_id not in visible_owner_ids(db, user):
        raise HTTPException(404, "Status not found or expired")


@router.post("", status_code=201, summary="Post a text / image / video status (expires in 24h)")
def create(data: StatusIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    media_url = None
    if data.type == "text":
        if not data.body:
            raise HTTPException(422, "Text status needs a body")
    else:
        att = db.get(Attachment, data.attachment_id) if data.attachment_id else None
        if not att or att.uploader_id != user.id or att.message_id is not None or att.kind != data.type:
            raise HTTPException(422, f"A valid {data.type} attachment_id is required")
        media_url = att.url
        db.delete(att)  # the Status row now owns the file
    music_url = music_title = None
    if data.music_attachment_id:
        song = db.get(Attachment, data.music_attachment_id)
        if not song or song.uploader_id != user.id or song.message_id is not None or song.kind != "audio":
            raise HTTPException(422, "music_attachment_id must be an audio file you uploaded")
        music_url, music_title = song.url, song.filename
        db.delete(song)  # the Status row now owns the file
    now = utcnow()
    s = Status(user_id=user.id, type=data.type, body=data.body, bg_color=data.bg_color or "#128C7E",
               media_url=media_url, music_url=music_url, music_title=music_title, created_at=now, expires_at=now + timedelta(hours=get_settings().status_ttl_hours))
    db.add(s)
    db.commit()
    emit(visible_owner_ids(db, user) | {user.id}, {"type": "status.new", "user_id": user.id})
    return serialize_status(db, s, user.id)


@router.get("", summary="Status feed: my statuses + my contacts' active statuses, grouped by user")
def feed(user: User = Depends(current_user), db: Session = Depends(get_db)):
    owners = visible_owner_ids(db, user) | {user.id}
    rows = db.scalars(select(Status).options(selectinload(Status.views), selectinload(Status.user))
                      .where(Status.user_id.in_(owners), Status.expires_at > utcnow())
                      .order_by(Status.created_at)).all()
    groups: dict[int, dict] = {}
    for s in rows:
        g = groups.setdefault(s.user_id, {"user": user_public(db, s.user, user.id), "statuses": []})
        g["statuses"].append(serialize_status(db, s, user.id))
    out = list(groups.values())
    for g in out:
        g["all_viewed"] = all(x["viewed"] for x in g["statuses"])
        g["latest_at"] = g["statuses"][-1]["created_at"]
    # mine first, then unviewed, then newest
    out.sort(key=lambda g: (g["user"]["id"] != user.id, g["all_viewed"], ""), reverse=False)
    out.sort(key=lambda g: g["latest_at"], reverse=True)
    out.sort(key=lambda g: (g["user"]["id"] != user.id, g["all_viewed"]))
    return out


@router.post("/{status_id}/view", status_code=204, summary="Record that I viewed a status")
def view(status_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    s = _active(db, status_id)
    _check_visible(db, s, user)
    if s.user_id != user.id and not any(v.viewer_id == user.id for v in s.views):
        db.add(StatusView(status_id=s.id, viewer_id=user.id))
        db.commit()
        emit([s.user_id], {"type": "status.viewed", "status_id": s.id, "viewer_id": user.id})
        webhooks.dispatch(db, "status.viewed", [s.user_id], {"status_id": s.id, "viewer_id": user.id})
    return Response(status_code=204)


@router.post("/{status_id}/react", summary="React to a status")
def react(status_id: int, data: ReactionIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    s = _active(db, status_id)
    _check_visible(db, s, user)
    if s.user_id == user.id:
        raise HTTPException(400, "You can't react to your own status")
    v = next((v for v in s.views if v.viewer_id == user.id), None)
    if not v:
        v = StatusView(status_id=s.id, viewer_id=user.id)
        db.add(v)
    v.reaction = data.emoji
    db.commit()
    notify(db, s.user_id, "status.reaction", user.display_name, f"reacted {data.emoji} to your status", {"status_id": s.id})
    return {"reaction": data.emoji}


@router.post("/{status_id}/reply", status_code=201,
             summary="Reply to a status; delivered as a chat message that quotes the status")
def reply(status_id: int, data: StatusReplyIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    s = _active(db, status_id)
    _check_visible(db, s, user)
    if s.user_id == user.id:
        raise HTTPException(400, "You can't reply to your own status")
    chat, created = messaging.get_or_create_direct(db, user, s.user)
    if created:
        emit(messaging.member_ids(db, chat.id), {"type": "chat.updated", "chat_id": chat.id})
    ref = {"status_id": s.id, "type": s.type, "body": (s.body or "")[:140], "bg_color": s.bg_color, "owner_id": s.user_id}
    msg = messaging.create_message(db, user, chat, body=data.body.strip(), status_ref=ref)
    return messaging.publish_new_message(db, msg)


@router.get("/{status_id}/viewers", summary="Who viewed / reacted (owner only)")
def viewers(status_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    s = _active(db, status_id)
    if s.user_id != user.id:
        raise HTTPException(403, "Only the owner can see viewers")
    return [serialize_viewer(db, v, user.id) for v in sorted(s.views, key=lambda v: v.viewed_at, reverse=True)]


@router.delete("/{status_id}", status_code=204, summary="Delete my status")
def delete(status_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    s = _active(db, status_id)
    if s.user_id != user.id:
        raise HTTPException(403, "Not your status")
    urls = [u for u in (s.media_url, s.music_url) if u]
    db.delete(s)
    db.commit()
    for url in urls:
        delete_file_if_unused(db, url)
    return Response(status_code=204)


def purge_expired(db: Session) -> int:
    rows = db.scalars(select(Status).where(Status.expires_at <= utcnow())).all()
    urls = [u for r in rows for u in (r.media_url, r.music_url) if u]
    for r in rows:
        db.delete(r)
    db.commit()
    for u in urls:
        delete_file_if_unused(db, u)
    return len(rows)
