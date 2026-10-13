"""Group voice/video calls as a WebRTC *mesh*: every participant connects to every other one.

The server only tracks who is in each room (in memory, one room per group chat) and relays signaling.
Mesh is fine for small groups; MAX_PARTICIPANTS caps it because upload bandwidth grows with N-1 streams.
For bigger calls use an SFU (LiveKit / mediasoup) - see README.
"""
import threading

from sqlalchemy.orm import Session

from ..database import utcnow
from ..models import Chat, User
from . import messaging
from .realtime import emit
from .serializers import iso

MAX_PARTICIPANTS = 6
rooms: dict[int, dict] = {}
_lock = threading.RLock()  # websocket handlers run on worker threads; room changes must be atomic


def _locked(fn):
    def wrapper(*a, **k):
        with _lock:
            return fn(*a, **k)
    wrapper.__name__ = fn.__name__
    return wrapper


class GroupCallError(Exception):
    pass


def _info(db: Session, uid: int) -> dict:
    u = db.get(User, uid)
    return {"id": u.id, "username": u.username, "display_name": u.display_name, "avatar_url": u.avatar_url}


def room_view(db: Session, chat_id: int) -> dict:
    r = rooms[chat_id]
    return {
        "chat_id": chat_id, "kind": r["kind"], "started_at": iso(r["started_at"]), "started_by": r["started_by"],
        "participants": [{**_info(db, uid), **st} for uid, st in r["participants"].items()],
    }


def _group_member(db: Session, user: User, chat_id):
    if not isinstance(chat_id, int):
        raise GroupCallError("Invalid chat")
    member = messaging.get_member(db, chat_id, user.id)
    chat = db.get(Chat, chat_id)
    if chat.type != "group":
        raise GroupCallError("Group calls are only available in group chats")
    return chat, member


def _broadcast_update(db: Session, chat_id: int) -> None:
    emit(messaging.member_ids(db, chat_id), {"type": "group.call.updated", "room": room_view(db, chat_id)})


def active_rooms_for(db: Session, user_id: int) -> list[dict]:
    out = []
    for chat_id in list(rooms):
        if user_id in messaging.member_ids(db, chat_id):
            out.append(room_view(db, chat_id))
    return out


@_locked
def start_or_join(db: Session, user: User, data: dict, starting: bool) -> dict:
    chat, _ = _group_member(db, user, data.get("chat_id"))
    room = rooms.get(chat.id)
    if room is None:
        if not starting:
            raise GroupCallError("This call has already ended")
        kind = data.get("kind")
        if kind not in ("audio", "video"):
            raise GroupCallError("Invalid call type")
        room = rooms[chat.id] = {"kind": kind, "started_at": utcnow(), "started_by": user.id, "participants": {}}
        created = True
    else:
        created = False
    if user.id not in room["participants"]:
        if len(room["participants"]) >= MAX_PARTICIPANTS:
            raise GroupCallError(f"This call is full ({MAX_PARTICIPANTS} participants max)")
        existing = list(room["participants"])
        room["participants"][user.id] = {"muted": False, "cam_off": False}
        emit(existing, {"type": "group.call.participant_joined", "chat_id": chat.id,
                        "user": {**_info(db, user.id), "muted": False, "cam_off": False}})
    view = room_view(db, chat.id)
    if created:
        others = [i for i in messaging.member_ids(db, chat.id) if i != user.id]
        emit(others, {"type": "group.call.incoming", "room": view, "from": _info(db, user.id), "chat_name": chat.name})
        messaging.system_message(db, chat, f"{user.display_name} started a group {room['kind']} call")
    else:
        _broadcast_update(db, chat.id)
    return {"type": "group.call.joined", "room": view, "self_id": user.id}


@_locked
def leave(db: Session, user_id: int, chat_id: int) -> None:
    room = rooms.get(chat_id)
    if not room or user_id not in room["participants"]:
        return
    del room["participants"][user_id]
    remaining = list(room["participants"])
    emit(remaining, {"type": "group.call.participant_left", "chat_id": chat_id, "user_id": user_id})
    if remaining:
        _broadcast_update(db, chat_id)
    else:
        del rooms[chat_id]
        emit(messaging.member_ids(db, chat_id), {"type": "group.call.ended", "chat_id": chat_id})


def _in_room(chat_id, user_id) -> dict:
    room = rooms.get(chat_id) if isinstance(chat_id, int) else None
    if not room or user_id not in room["participants"]:
        raise GroupCallError("You are not in this call")
    return room


def signal(db: Session, user: User, data: dict) -> None:
    room = _in_room(data.get("chat_id"), user.id)
    to, payload = data.get("to_user_id"), data.get("data")
    if to not in room["participants"] or not isinstance(payload, dict) or len(str(payload)) > 20000:
        raise GroupCallError("Cannot relay signal")
    emit([to], {"type": "group.call.signal", "chat_id": data["chat_id"], "from_user_id": user.id, "data": payload})


@_locked
def set_state(db: Session, user: User, data: dict) -> None:
    room = _in_room(data.get("chat_id"), user.id)
    st = room["participants"][user.id]
    st["muted"], st["cam_off"] = bool(data.get("muted")), bool(data.get("cam_off"))
    emit([i for i in room["participants"] if i != user.id],
         {"type": "group.call.state", "chat_id": data["chat_id"], "user_id": user.id, **st})


def admin_mute(db: Session, user: User, data: dict) -> None:
    """A group admin asks a participant to mute (their client mutes itself) or to unmute (a request only:
    a microphone is never switched on remotely, the participant decides)."""
    chat, member = _group_member(db, user, data.get("chat_id"))
    room = _in_room(chat.id, user.id)
    if member.role != "admin":
        raise GroupCallError("Only group admins can mute others")
    target = data.get("user_id")
    if target not in room["participants"] or target == user.id:
        raise GroupCallError("Participant not in call")
    kind = "group.call.muted_by_admin" if data.get("mute", True) else "group.call.unmute_requested"
    emit([target], {"type": kind, "chat_id": chat.id, "by": user.display_name})


def cleanup_user(db: Session, user_id: int) -> None:
    for chat_id in [c for c, r in rooms.items() if user_id in r["participants"]]:
        leave(db, user_id, chat_id)


def handle(db: Session, user: User, t: str, data: dict) -> dict | None:
    if t == "group.call.start":
        return start_or_join(db, user, data, starting=True)
    if t == "group.call.join":
        return start_or_join(db, user, data, starting=False)
    if t == "group.call.leave":
        leave(db, user.id, data.get("chat_id"))
    elif t == "group.call.signal":
        signal(db, user, data)
    elif t == "group.call.state":
        set_state(db, user, data)
    elif t == "group.call.mute":
        admin_mute(db, user, data)
    else:
        raise GroupCallError(f"Unknown event '{t}'")
    return None
