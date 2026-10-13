"""Secure local upload handling: allow-listed extensions, magic-byte checks, random names, size cap."""
import os
import re
import uuid
from pathlib import Path

from fastapi import HTTPException, UploadFile
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..models import Attachment

# ext -> (kind, mime, magic-check)
ALLOWED: dict[str, tuple[str, str]] = {
    ".jpg": ("image", "image/jpeg"), ".jpeg": ("image", "image/jpeg"), ".png": ("image", "image/png"),
    ".gif": ("image", "image/gif"), ".webp": ("image", "image/webp"),
    ".mp4": ("video", "video/mp4"), ".webm": ("video", "video/webm"), ".mov": ("video", "video/quicktime"),
    ".mp3": ("audio", "audio/mpeg"), ".ogg": ("audio", "audio/ogg"), ".wav": ("audio", "audio/wav"),
    ".m4a": ("audio", "audio/mp4"),
    ".pdf": ("document", "application/pdf"), ".txt": ("document", "text/plain"), ".csv": ("document", "text/csv"),
    ".docx": ("document", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
    ".xlsx": ("document", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
    ".pptx": ("document", "application/vnd.openxmlformats-officedocument.presentationml.presentation"),
    ".zip": ("document", "application/zip"),
}


def _magic_ok(ext: str, head: bytes) -> bool:
    if ext in (".jpg", ".jpeg"):
        return head.startswith(b"\xff\xd8\xff")
    if ext == ".png":
        return head.startswith(b"\x89PNG\r\n\x1a\n")
    if ext == ".gif":
        return head[:6] in (b"GIF87a", b"GIF89a")
    if ext == ".webp":
        return head[:4] == b"RIFF" and head[8:12] == b"WEBP"
    if ext in (".mp4", ".mov", ".m4a"):
        return head[4:8] == b"ftyp" or head[4:8] in (b"moov", b"mdat", b"wide", b"free")
    if ext == ".webm":
        return head.startswith(b"\x1a\x45\xdf\xa3")
    if ext == ".ogg":
        return head.startswith(b"OggS")
    if ext == ".mp3":
        return head.startswith(b"ID3") or (len(head) > 1 and head[0] == 0xFF and head[1] & 0xE0 == 0xE0)
    if ext == ".wav":
        return head[:4] == b"RIFF" and head[8:12] == b"WAVE"
    if ext == ".pdf":
        return head.startswith(b"%PDF")
    if ext in (".docx", ".xlsx", ".pptx", ".zip"):
        return head.startswith(b"PK")
    if ext in (".txt", ".csv"):
        return b"\x00" not in head
    return False


def upload_root() -> Path:
    root = Path(get_settings().upload_dir).resolve()
    root.mkdir(parents=True, exist_ok=True)
    return root


def clean_filename(name: str) -> str:
    name = os.path.basename(name or "file").replace("\\", "/").split("/")[-1]
    name = re.sub(r"[^\w.\- ]+", "_", name).strip(" .")
    return (name or "file")[:120]


async def save_upload(file: UploadFile, allowed_kinds: set[str] | None = None, voice: bool = False) -> dict:
    ext = Path(file.filename or "").suffix.lower()
    if ext not in ALLOWED:
        raise HTTPException(415, f"File type '{ext or 'unknown'}' is not allowed")
    kind, mime = ALLOWED[ext]
    if voice and ext in (".webm", ".ogg"):  # MediaRecorder voice notes
        kind, mime = "audio", mime.replace("video/", "audio/")
    if allowed_kinds and kind not in allowed_kinds:
        raise HTTPException(415, f"Only {', '.join(sorted(allowed_kinds))} files are allowed here")

    max_bytes = get_settings().max_upload_mb * 1024 * 1024
    stored = f"{uuid.uuid4().hex}{ext}"
    path = upload_root() / stored
    size, head = 0, b""
    try:
        with open(path, "wb") as out:
            while chunk := await file.read(1024 * 1024):
                if not head:
                    head = chunk[:16]
                    if not _magic_ok(ext, head):
                        raise HTTPException(415, "File content does not match its extension")
                size += len(chunk)
                if size > max_bytes:
                    raise HTTPException(413, f"File too large (max {get_settings().max_upload_mb} MB)")
                out.write(chunk)
        if size == 0:
            raise HTTPException(400, "Empty file")
    except Exception:
        path.unlink(missing_ok=True)
        raise
    return {"kind": kind, "mime": mime, "size": size, "filename": clean_filename(file.filename),
            "url": f"/uploads/{stored}"}


def delete_file_if_unused(db: Session, url: str) -> None:
    """Remove the file from disk when no attachment / avatar / status still references it."""
    from ..models import Chat, Status, User
    refs = 0
    for model, col in ((Attachment, Attachment.url), (Status, Status.media_url), (Status, Status.music_url), (User, User.avatar_url), (Chat, Chat.avatar_url)):
        refs += db.scalar(select(func.count()).select_from(model).where(col == url)) or 0
    if refs == 0 and url.startswith("/uploads/"):
        (upload_root() / Path(url).name).unlink(missing_ok=True)
