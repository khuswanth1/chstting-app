from sqlalchemy.orm import Session

from ..models import Notification
from .realtime import emit
from .serializers import iso


def notification_out(n: Notification) -> dict:
    return {"id": n.id, "type": n.type, "title": n.title, "body": n.body, "data": n.data,
            "read": n.read, "created_at": iso(n.created_at)}


def notify(db: Session, user_id: int, type_: str, title: str, body: str = "", data: dict | None = None) -> Notification:
    n = Notification(user_id=user_id, type=type_, title=title[:120], body=body[:300], data=data or {})
    db.add(n)
    db.commit()
    emit([user_id], {"type": "notification.new", "notification": notification_out(n)})
    return n
