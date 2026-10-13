from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import current_user
from ..models import User
from ..services import ai, messaging
from ..services.serializers import serialize_chats

router = APIRouter(prefix="/ai", tags=["AI"])


def _guard(user: User) -> None:
    if not ai.enabled():
        raise HTTPException(503, "AI features are turned off on this server")
    ai.check_rate(user.id)


def _run(fn, *a):
    try:
        return fn(*a)
    except ai.AIError as e:
        raise HTTPException(502, str(e))


class SummarizeIn(BaseModel):
    chat_id: int
    limit: int = Field(default=50, ge=5, le=100)
    only_unread: bool = False


class RepliesIn(BaseModel):
    chat_id: int


class RewriteIn(BaseModel):
    text: str = Field(min_length=1, max_length=4000)
    tone: Literal["fix", "friendly", "professional", "casual", "shorter", "longer"] = "fix"


class TranslateIn(BaseModel):
    language: str = Field(min_length=2, max_length=40, pattern=r"^[A-Za-z][A-Za-z \-()]+$")
    text: str | None = Field(default=None, max_length=4000)
    message_id: int | None = None


@router.get("/status", summary="Is the AI provider configured and reachable?")
def status(user: User = Depends(current_user), db: Session = Depends(get_db)):
    return {**ai.provider_status(), "bot_username": ai.BOT_USERNAME, "bot_user_id": ai.get_or_create_bot(db).id}


@router.post("/chat", summary="Open (or create) my chat with the ChatFlow AI assistant")
def open_bot_chat(user: User = Depends(current_user), db: Session = Depends(get_db)):
    bot = ai.get_or_create_bot(db)
    chat, _ = messaging.get_or_create_direct(db, user, bot)
    return serialize_chats(db, [chat], user)[0]


@router.post("/summarize", summary="Summarize a chat (or only what I haven't read)")
def summarize(data: SummarizeIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    _guard(user)
    messaging.get_member(db, data.chat_id, user.id)
    return _run(ai.summarize, db, user, data.chat_id, data.limit, data.only_unread)


@router.post("/smart-replies", summary="Suggest 3 quick replies")
def smart_replies(data: RepliesIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    _guard(user)
    messaging.get_member(db, data.chat_id, user.id)
    return {"suggestions": _run(ai.smart_replies, db, user, data.chat_id)}


@router.post("/rewrite", summary="Rewrite my draft in a tone")
def rewrite(data: RewriteIn, user: User = Depends(current_user)):
    _guard(user)
    return {"text": _run(ai.rewrite, data.text, data.tone)}


@router.post("/translate", summary="Translate text, or a message I can see")
def translate(data: TranslateIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    _guard(user)
    text = data.text
    if data.message_id:
        msg = messaging.get_visible_message(db, data.message_id, user.id)
        if msg.deleted_at or not msg.body:
            raise HTTPException(422, "Nothing to translate")
        text = msg.body
    if not text:
        raise HTTPException(422, "Provide text or message_id")
    return {"text": _run(ai.translate, text, data.language)}
