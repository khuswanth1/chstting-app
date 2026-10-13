import time

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db, utcnow
from ..deps import current_user
from ..models import Chat, Member, User
from ..security import verify_password
from ..services import messaging
from ..services.ai import BOT_USERNAME
from ..services.backup import _slug, build_backup

router = APIRouter(prefix="/backup", tags=["Backup"])

_last: dict[int, float] = {}
MIN_INTERVAL = 30  # seconds between exports per user: a backup is expensive


class BackupIn(BaseModel):
    chat_id: int = Field(description="The one-to-one chat (one person) to back up")
    password: str = Field(min_length=1, max_length=128, description="Your account password (the file holds the whole conversation)")
    include_media: bool = True


def _stream(tmp):
    try:
        while chunk := tmp.read(1024 * 256):
            yield chunk
    finally:
        tmp.close()


@router.post("", summary="Download a ZIP backup of my conversation with ONE person")
def export(data: BackupIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    # 403 (not 401) so a wrong password doesn't look like an expired session to the client
    if not verify_password(data.password, user.password_hash):
        raise HTTPException(403, "Wrong password")
    messaging.get_member(db, data.chat_id, user.id)  # 404 unless I am in this chat
    chat = db.get(Chat, data.chat_id)
    peer_id = db.scalar(select(Member.user_id).where(Member.chat_id == chat.id, Member.user_id != user.id)) if chat.type == "direct" else None
    peer = db.get(User, peer_id) if peer_id else None
    if not peer or peer.username == BOT_USERNAME:
        raise HTTPException(422, "Backups are available for one-to-one chats with a person")
    now = time.monotonic()
    if now - _last.get(user.id, -MIN_INTERVAL) < MIN_INTERVAL:
        raise HTTPException(429, "A backup was just created. Please wait a moment and try again.")
    _last[user.id] = now
    tmp = build_backup(db, user, chat, peer, data.include_media)
    size = tmp.seek(0, 2)
    tmp.seek(0)
    name = f"chatflow-chat-{_slug(peer.username)}-{utcnow():%Y%m%d-%H%M}.zip"
    return StreamingResponse(_stream(tmp), media_type="application/zip",
                             headers={"Content-Disposition": f'attachment; filename="{name}"', "Content-Length": str(size),
                                      "Cache-Control": "no-store", "Access-Control-Expose-Headers": "Content-Disposition"})
