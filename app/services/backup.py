"""Single-person conversation backup: a ZIP with data.json, a readable transcript and (optionally) media files.

Scope is deliberately one one-to-one conversation: your messages with that person, calls between you two, and
nothing else about either account (no emails, phones, settings, other chats).
"""
import json
import re
import zipfile
from pathlib import Path
from tempfile import SpooledTemporaryFile

from sqlalchemy import and_, or_, select
from sqlalchemy.orm import Session, selectinload

from ..config import get_settings
from ..database import utcnow
from ..models import CallLog, Chat, Message, StarredMessage, User
from .serializers import hidden_ids_subq, iso
from .uploads import upload_root

FORMAT_VERSION = 2
MAX_MESSAGES = 200_000
LABEL = {"image": "photo", "video": "video", "audio": "voice message", "document": "document",
         "videonote": "video message", "sticker": "sticker"}

README = """ChatFlow conversation backup
============================
data.json   the whole conversation in one machine-readable file
chat.txt    the same conversation as plain text
media/      photos, videos, voice notes and documents (only if you chose to include them)

This is a backup of ONE one-to-one conversation: the messages you can see in it (messages deleted for you or for
everyone are left out) and the calls between the two of you. It contains no email addresses, phone numbers,
settings or other chats. Keep it private: it holds the full conversation.
"""


def _slug(text: str) -> str:
    return re.sub(r"[^\w\-]+", "_", text or "chat").strip("_")[:40] or "chat"


class _Media:
    """Copies upload files into the ZIP until the size cap is reached."""

    def __init__(self, zf: zipfile.ZipFile, enabled: bool):
        self.zf, self.enabled = zf, enabled
        self.budget = get_settings().backup_max_media_mb * 1024 * 1024
        self.added: dict[str, str] = {}
        self.skipped: list[str] = []

    def add(self, url: str | None, label: str) -> str | None:
        if not self.enabled or not url or not url.startswith("/uploads/"):
            return None
        if url in self.added:
            return self.added[url]
        path = upload_root() / Path(url).name
        if not path.is_file():
            return None
        size = path.stat().st_size
        if size > self.budget:
            self.skipped.append(label)
            return None
        arc = f"media/{path.stem[:8]}-{_slug(Path(label).stem)}{path.suffix}"
        self.zf.write(path, arc)
        self.budget -= size
        self.added[url] = arc
        return arc


def build_backup(db: Session, user: User, chat: Chat, peer: User, include_media: bool) -> SpooledTemporaryFile:
    tmp = SpooledTemporaryFile(max_size=20 * 1024 * 1024)
    me_name = user.display_name
    starred = set(db.scalars(select(StarredMessage.message_id).where(StarredMessage.user_id == user.id)))

    with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zf:
        media = _Media(zf, include_media)
        messages, lines = [], []
        q = (select(Message).options(selectinload(Message.attachments), selectinload(Message.reactions))
             .where(Message.chat_id == chat.id, Message.deleted_at.is_(None), Message.id.not_in(hidden_ids_subq(user.id)))
             .order_by(Message.id).limit(MAX_MESSAGES))
        name_of = {user.id: user.username, peer.id: peer.username}
        for m in db.scalars(q):
            mine = m.sender_id == user.id
            files = [{"filename": a.filename, "mime": a.mime, "size": a.size, "duration": a.duration,
                      "file": media.add(a.url, a.filename)} for a in m.attachments]
            messages.append({
                "id": m.id, "from": "me" if mine else ("them" if m.sender_id == peer.id else "system"), "type": m.type,
                "body": m.body, "reply_to_id": m.reply_to_id, "forwarded": m.forwarded, "edited_at": iso(m.edited_at),
                "created_at": iso(m.created_at), "starred": m.id in starred, "status_reply": m.status_ref, "attachments": files,
                "reactions": [{"by": "me" if r.user_id == user.id else "them", "emoji": r.emoji} for r in m.reactions],
            })
            stamp = m.created_at.strftime("%Y-%m-%d %H:%M")
            if m.type == "system":
                lines.append(f"[{stamp}] {m.body}")
                continue
            extra = [f"<{LABEL.get(m.type, 'attachment')}: {f['filename']}>" for f in files]
            if not extra and not m.body and m.type in LABEL:
                extra = [f"<{LABEL[m.type]}>"]
            text = (m.body or "").replace("\n", " / ")
            lines.append(f"[{stamp}] {me_name if mine else peer.display_name}: " + " ".join(filter(None, [text] + extra)))

        between = or_(and_(CallLog.caller_id == user.id, CallLog.callee_id == peer.id),
                      and_(CallLog.caller_id == peer.id, CallLog.callee_id == user.id))
        calls = [{"kind": c.kind, "status": c.status, "direction": "outgoing" if c.caller_id == user.id else "incoming",
                  "started_at": iso(c.created_at), "answered_at": iso(c.answered_at), "ended_at": iso(c.ended_at)}
                 for c in db.scalars(select(CallLog).where(between).order_by(CallLog.id))]

        data = {
            "format": "chatflow-conversation-backup", "version": FORMAT_VERSION, "exported_at": iso(utcnow()),
            "me": {"username": user.username, "display_name": user.display_name},
            "person": {"username": peer.username, "display_name": peer.display_name},
            "conversation_started": iso(chat.created_at), "message_count": len(messages),
            "messages": messages, "calls": calls,
            "media": {"included": include_media, "files": len(media.added), "skipped_too_large": media.skipped},
            "truncated": len(messages) >= MAX_MESSAGES,
        }
        zf.writestr("data.json", json.dumps(data, ensure_ascii=False, indent=1))
        zf.writestr("chat.txt", f"Conversation between {me_name} and {peer.display_name}\n" + "\n".join(lines) + "\n")
        zf.writestr("README.txt", README)
    tmp.seek(0)
    return tmp
