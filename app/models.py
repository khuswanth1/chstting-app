from datetime import datetime

from sqlalchemy import (
    JSON, Boolean, ForeignKey, Index, Integer, String, Text, UniqueConstraint, false,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base, UTCDateTime, utcnow


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    phone: Mapped[str | None] = mapped_column(String(20), unique=True, index=True, nullable=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    display_name: Mapped[str] = mapped_column(String(64))
    about: Mapped[str] = mapped_column(String(200), default="Hey there! I am using ChatFlow.")
    avatar_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    is_online: Mapped[bool] = mapped_column(Boolean, default=False)
    last_seen: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    token_version: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)

    # settings
    privacy_last_seen: Mapped[str] = mapped_column(String(10), default="everyone")  # everyone|contacts|nobody
    privacy_avatar: Mapped[str] = mapped_column(String(10), default="everyone")
    privacy_read_receipts: Mapped[bool] = mapped_column(Boolean, default=True)
    theme: Mapped[str] = mapped_column(String(10), default="system")  # light|dark|system
    notify_messages: Mapped[bool] = mapped_column(Boolean, default=True)
    notify_groups: Mapped[bool] = mapped_column(Boolean, default=True)
    notify_sound: Mapped[bool] = mapped_column(Boolean, default=True)
    notify_desktop: Mapped[bool] = mapped_column(Boolean, default=True)


class Contact(Base):
    __tablename__ = "contacts"
    __table_args__ = (UniqueConstraint("owner_id", "contact_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    contact_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    nickname: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)

    contact: Mapped[User] = relationship(foreign_keys=[contact_id])


class Block(Base):
    __tablename__ = "blocks"
    __table_args__ = (UniqueConstraint("blocker_id", "blocked_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    blocker_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    blocked_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)

    blocked: Mapped[User] = relationship(foreign_keys=[blocked_id])


class Chat(Base):
    __tablename__ = "chats"

    id: Mapped[int] = mapped_column(primary_key=True)
    type: Mapped[str] = mapped_column(String(10))  # direct|group
    direct_key: Mapped[str | None] = mapped_column(String(40), unique=True, nullable=True)
    name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    description: Mapped[str | None] = mapped_column(String(500), nullable=True)
    avatar_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    last_message_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, index=True)

    members: Mapped[list["Member"]] = relationship(back_populates="chat", cascade="all, delete-orphan")


class Member(Base):
    __tablename__ = "members"
    __table_args__ = (UniqueConstraint("chat_id", "user_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    chat_id: Mapped[int] = mapped_column(ForeignKey("chats.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    role: Mapped[str] = mapped_column(String(10), default="member")  # admin|member
    muted: Mapped[bool] = mapped_column(Boolean, default=False)
    archived: Mapped[bool] = mapped_column(Boolean, default=False, server_default=false())
    pinned: Mapped[bool] = mapped_column(Boolean, default=False, server_default=false())
    last_read_message_id: Mapped[int] = mapped_column(Integer, default=0)
    joined_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)

    chat: Mapped[Chat] = relationship(back_populates="members")
    user: Mapped[User] = relationship()


class Message(Base):
    __tablename__ = "messages"
    __table_args__ = (Index("ix_messages_chat_id_id", "chat_id", "id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    chat_id: Mapped[int] = mapped_column(ForeignKey("chats.id", ondelete="CASCADE"))
    sender_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    type: Mapped[str] = mapped_column(String(10), default="text")  # text|image|video|audio|document|system
    body: Mapped[str | None] = mapped_column(Text, nullable=True)
    reply_to_id: Mapped[int | None] = mapped_column(ForeignKey("messages.id", ondelete="SET NULL"), nullable=True)
    forwarded: Mapped[bool] = mapped_column(Boolean, default=False)
    status_ref: Mapped[dict | None] = mapped_column(JSON, nullable=True)  # snapshot of the status this message replies to
    edited_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    deleted_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)

    attachments: Mapped[list["Attachment"]] = relationship(back_populates="message")
    reactions: Mapped[list["Reaction"]] = relationship(cascade="all, delete-orphan")
    receipts: Mapped[list["Receipt"]] = relationship(cascade="all, delete-orphan")
    reply_to: Mapped["Message | None"] = relationship(remote_side=[id])


class Attachment(Base):
    __tablename__ = "attachments"

    id: Mapped[int] = mapped_column(primary_key=True)
    uploader_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    message_id: Mapped[int | None] = mapped_column(ForeignKey("messages.id", ondelete="CASCADE"), nullable=True, index=True)
    kind: Mapped[str] = mapped_column(String(10))  # image|video|audio|document
    url: Mapped[str] = mapped_column(String(500))
    filename: Mapped[str] = mapped_column(String(255))
    mime: Mapped[str] = mapped_column(String(100))
    size: Mapped[int] = mapped_column(Integer)
    duration: Mapped[int | None] = mapped_column(Integer, nullable=True)  # seconds (voice notes)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)

    message: Mapped[Message | None] = relationship(back_populates="attachments")


class Receipt(Base):
    """One row per (message, recipient). Drives sent / delivered / read ticks."""

    __tablename__ = "receipts"
    __table_args__ = (
        UniqueConstraint("message_id", "user_id"),
        Index("ix_receipts_user_pending", "user_id", "delivered_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    message_id: Mapped[int] = mapped_column(ForeignKey("messages.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    delivered_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    read_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)


class MessageHidden(Base):
    """Delete-for-me marker."""

    __tablename__ = "message_hidden"
    __table_args__ = (UniqueConstraint("message_id", "user_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    message_id: Mapped[int] = mapped_column(ForeignKey("messages.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)


class Reaction(Base):
    __tablename__ = "reactions"
    __table_args__ = (UniqueConstraint("message_id", "user_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    message_id: Mapped[int] = mapped_column(ForeignKey("messages.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    emoji: Mapped[str] = mapped_column(String(16))


class Status(Base):
    __tablename__ = "statuses"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    type: Mapped[str] = mapped_column(String(10))  # text|image|video
    body: Mapped[str | None] = mapped_column(String(700), nullable=True)
    bg_color: Mapped[str | None] = mapped_column(String(9), nullable=True)
    media_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    music_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    music_title: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    expires_at: Mapped[datetime] = mapped_column(UTCDateTime, index=True)

    views: Mapped[list["StatusView"]] = relationship(cascade="all, delete-orphan")
    user: Mapped[User] = relationship()


class StatusView(Base):
    __tablename__ = "status_views"
    __table_args__ = (UniqueConstraint("status_id", "viewer_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    status_id: Mapped[int] = mapped_column(ForeignKey("statuses.id", ondelete="CASCADE"), index=True)
    viewer_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    viewed_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    reaction: Mapped[str | None] = mapped_column(String(16), nullable=True)

    viewer: Mapped[User] = relationship()


class CallLog(Base):
    __tablename__ = "call_logs"

    id: Mapped[int] = mapped_column(primary_key=True)
    caller_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    callee_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    chat_id: Mapped[int | None] = mapped_column(ForeignKey("chats.id", ondelete="SET NULL"), nullable=True)
    kind: Mapped[str] = mapped_column(String(10))  # audio|video
    status: Mapped[str] = mapped_column(String(10), default="ringing")  # ringing|ongoing|ended|missed|declined|busy
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    answered_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    ended_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)

    caller: Mapped[User] = relationship(foreign_keys=[caller_id])
    callee: Mapped[User] = relationship(foreign_keys=[callee_id])


class Notification(Base):
    __tablename__ = "notifications"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    type: Mapped[str] = mapped_column(String(30))
    title: Mapped[str] = mapped_column(String(120))
    body: Mapped[str] = mapped_column(String(300), default="")
    data: Mapped[dict] = mapped_column(JSON, default=dict)
    read: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)


class Webhook(Base):
    __tablename__ = "webhooks"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    url: Mapped[str] = mapped_column(String(500))
    secret: Mapped[str] = mapped_column(String(100))
    events: Mapped[list] = mapped_column(JSON, default=list)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)


class StarredMessage(Base):
    """A message a user starred (private bookmark)."""

    __tablename__ = "starred_messages"
    __table_args__ = (UniqueConstraint("user_id", "message_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    message_id: Mapped[int] = mapped_column(ForeignKey("messages.id", ondelete="CASCADE"), index=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
