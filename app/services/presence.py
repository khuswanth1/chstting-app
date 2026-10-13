from sqlalchemy import select, update
from sqlalchemy.orm import Session

from ..database import utcnow
from ..models import Contact, Member, User
from .realtime import emit
from .serializers import iso, user_public


def presence_audience(db: Session, user_id: int) -> set[int]:
    """Everyone who should hear about this user's presence/profile: chat partners + people who saved them."""
    my_chats = select(Member.chat_id).where(Member.user_id == user_id)
    ids = set(db.scalars(select(Member.user_id).where(Member.chat_id.in_(my_chats))))
    ids |= set(db.scalars(select(Contact.owner_id).where(Contact.contact_id == user_id)))
    ids.add(user_id)
    return ids


def set_presence(db: Session, user_id: int, online: bool) -> None:
    now = utcnow()
    db.execute(update(User).where(User.id == user_id).values(is_online=online, last_seen=now))
    db.commit()
    user = db.get(User, user_id)
    for viewer_id in presence_audience(db, user_id) - {user_id}:
        # per-viewer payload so privacy settings (last seen: contacts/nobody) are respected
        p = user_public(db, user, viewer_id)
        emit([viewer_id], {"type": "presence", "user_id": user_id, "is_online": p["is_online"], "last_seen": p["last_seen"]})


def reset_all_presence(db: Session) -> None:
    db.execute(update(User).where(User.is_online.is_(True)).values(is_online=False))
    db.commit()
