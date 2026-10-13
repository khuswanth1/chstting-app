import re
from typing import Literal

from pydantic import BaseModel, EmailStr, Field, field_validator

USERNAME_RE = re.compile(r"^[a-zA-Z0-9_.]{3,32}$")
PHONE_RE = re.compile(r"^\+?[1-9]\d{6,14}$")


def normalize_phone(v: str | None) -> str | None:
    """'+1 (415) 555-0123' -> '+14155550123'. Empty -> None. Raises ValueError if it is not a plausible number."""
    if v is None or not v.strip():
        return None
    cleaned = re.sub(r"[\s().-]", "", v.strip())
    if not PHONE_RE.match(cleaned):
        raise ValueError("Enter a valid phone number with country code, e.g. +14155550123")
    return cleaned if cleaned.startswith("+") else f"+{cleaned}"


class RegisterIn(BaseModel):
    username: str
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    display_name: str | None = Field(default=None, max_length=64)
    phone: str | None = Field(default=None, max_length=32)

    @field_validator("phone")
    @classmethod
    def _phone(cls, v):
        return normalize_phone(v)

    @field_validator("username")
    @classmethod
    def _username(cls, v: str) -> str:
        if not USERNAME_RE.match(v):
            raise ValueError("Username must be 3-32 chars: letters, numbers, '_' or '.'")
        if v.lower() == "chatflow_ai":
            raise ValueError("This username is reserved")
        return v.lower()


class LoginIn(BaseModel):
    identifier: str = Field(description="Username, email or phone number")
    password: str


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: dict


class ProfileIn(BaseModel):
    display_name: str | None = Field(default=None, min_length=1, max_length=64)
    about: str | None = Field(default=None, max_length=200)
    phone: str | None = Field(default=None, max_length=32)

    @field_validator("phone")
    @classmethod
    def _phone(cls, v):
        return normalize_phone(v)


class SettingsIn(BaseModel):
    privacy_last_seen: Literal["everyone", "contacts", "nobody"] | None = None
    privacy_avatar: Literal["everyone", "contacts", "nobody"] | None = None
    privacy_read_receipts: bool | None = None
    theme: Literal["light", "dark", "system"] | None = None
    notify_messages: bool | None = None
    notify_groups: bool | None = None
    notify_sound: bool | None = None
    notify_desktop: bool | None = None


class ContactIn(BaseModel):
    user_id: int | None = None
    username: str | None = None
    nickname: str | None = Field(default=None, max_length=64)


class DirectChatIn(BaseModel):
    user_id: int


class GroupIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    description: str | None = Field(default=None, max_length=500)
    member_ids: list[int] = Field(default_factory=list, max_length=255)


class GroupUpdateIn(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    description: str | None = Field(default=None, max_length=500)


class MembersIn(BaseModel):
    user_ids: list[int] = Field(min_length=1, max_length=100)


class RoleIn(BaseModel):
    role: Literal["admin", "member"]


class MemberPrefsIn(BaseModel):
    muted: bool | None = None
    archived: bool | None = None
    pinned: bool | None = None


class MessageIn(BaseModel):
    body: str | None = Field(default=None, max_length=4000)
    reply_to_id: int | None = None
    attachment_ids: list[int] = Field(default_factory=list, max_length=10)
    video_note: bool = False  # one video attachment shown as a round video message
    sticker: bool = False  # body = "<emoji>" or "<emoji>\n<caption>"

    @field_validator("body")
    @classmethod
    def _strip(cls, v):
        return v.strip() if isinstance(v, str) else v


class MessageEditIn(BaseModel):
    body: str = Field(min_length=1, max_length=4000)


class ReactionIn(BaseModel):
    emoji: str = Field(min_length=1, max_length=16)


class StatusReplyIn(BaseModel):
    body: str = Field(min_length=1, max_length=2000)


class ForwardIn(BaseModel):
    message_ids: list[int] = Field(min_length=1, max_length=20)
    chat_ids: list[int] = Field(min_length=1, max_length=10)


class ReadIn(BaseModel):
    up_to_id: int | None = None


class StatusIn(BaseModel):
    type: Literal["text", "image", "video"]
    body: str | None = Field(default=None, max_length=700)
    bg_color: str | None = Field(default=None, pattern=r"^#[0-9a-fA-F]{6}$")
    attachment_id: int | None = None
    music_attachment_id: int | None = None


class WebhookIn(BaseModel):
    url: str = Field(max_length=500)
    events: list[str] = Field(min_length=1)


class WebhookPatchIn(BaseModel):
    active: bool | None = None
    events: list[str] | None = None
