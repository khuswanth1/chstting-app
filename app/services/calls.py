"""1:1 WebRTC call signaling. Media flows peer-to-peer; the server only relays SDP/ICE and logs calls.

Group calls need an SFU (LiveKit / mediasoup) - see README.
"""
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from ..database import utcnow
from ..models import CallLog, User
from . import webhooks
from .messaging import is_blocked_between
from .notify import notify
from .realtime import emit, manager
from .serializers import user_public

ACTIVE = ("ringing", "ongoing")


class CallError(Exception):
    pass


def _active_call_for(db: Session, user_id: int) -> CallLog | None:
    return db.scalar(select(CallLog).where(
        CallLog.status.in_(ACTIVE), or_(CallLog.caller_id == user_id, CallLog.callee_id == user_id)).limit(1))


def _get(db: Session, call_id, user_id: int) -> CallLog:
    call = db.get(CallLog, call_id) if isinstance(call_id, int) else None
    if not call or user_id not in (call.caller_id, call.callee_id):
        raise CallError("Call not found")
    return call


def _other(call: CallLog, user_id: int) -> int:
    return call.callee_id if user_id == call.caller_id else call.caller_id


def _missed(db: Session, call: CallLog, caller: User):
    call.status, call.ended_at = "missed", utcnow()
    db.commit()
    notify(db, call.callee_id, "call.missed", f"Missed {call.kind} call", f"from {caller.display_name}",
           {"call_id": call.id, "chat_id": call.chat_id, "user_id": caller.id})
    webhooks.dispatch(db, "call.missed", [call.callee_id], {"call_id": call.id, "caller_id": caller.id, "kind": call.kind})


def invite(db: Session, user: User, data: dict) -> dict:
    to_id, kind = data.get("to_user_id"), data.get("kind")
    if kind not in ("audio", "video") or not isinstance(to_id, int) or to_id == user.id:
        raise CallError("Invalid call request")
    callee = db.get(User, to_id)
    if not callee or callee.username == "chatflow_ai" or is_blocked_between(db, user.id, to_id):
        raise CallError("You can't call this user")
    if _active_call_for(db, user.id):
        raise CallError("You are already in a call")
    chat_id = data.get("chat_id") if isinstance(data.get("chat_id"), int) else None
    call = CallLog(caller_id=user.id, callee_id=to_id, chat_id=chat_id, kind=kind)
    db.add(call)
    db.commit()
    if not manager.is_online(to_id):
        _missed(db, call, user)
        return {"type": "call.unavailable", "call_id": call.id}
    other = db.scalar(select(CallLog.id).where(
        CallLog.id != call.id, CallLog.status.in_(ACTIVE),
        or_(CallLog.caller_id == to_id, CallLog.callee_id == to_id)).limit(1))
    if other:
        call.status, call.ended_at = "busy", utcnow()
        db.commit()
        return {"type": "call.busy", "call_id": call.id}
    emit([to_id], {"type": "call.incoming", "call_id": call.id, "kind": kind, "chat_id": chat_id,
                   "from": user_public(db, user, to_id)})
    return {"type": "call.ringing", "call_id": call.id, "to_user_id": to_id, "kind": kind}


def accept(db: Session, user: User, data: dict) -> None:
    call = _get(db, data.get("call_id"), user.id)
    if call.callee_id != user.id or call.status != "ringing":
        raise CallError("Cannot accept this call")
    call.status, call.answered_at = "ongoing", utcnow()
    db.commit()
    emit([call.caller_id], {"type": "call.accepted", "call_id": call.id})


def reject(db: Session, user: User, data: dict) -> None:
    call = _get(db, data.get("call_id"), user.id)
    if call.callee_id != user.id or call.status != "ringing":
        raise CallError("Cannot reject this call")
    call.status, call.ended_at = "declined", utcnow()
    db.commit()
    emit([call.caller_id], {"type": "call.rejected", "call_id": call.id})


def end(db: Session, user: User, data: dict) -> None:
    call = _get(db, data.get("call_id"), user.id)
    if call.status not in ACTIVE:
        return
    if call.status == "ringing":
        if user.id == call.caller_id:
            _missed(db, call, user)
        else:
            call.status, call.ended_at = "declined", utcnow()
            db.commit()
    else:
        call.status, call.ended_at = "ended", utcnow()
        db.commit()
    emit([_other(call, user.id)], {"type": "call.ended", "call_id": call.id})


def signal(db: Session, user: User, data: dict) -> None:
    call = _get(db, data.get("call_id"), user.id)
    payload = data.get("data")
    if call.status not in ACTIVE or not isinstance(payload, dict) or len(str(payload)) > 20000:
        raise CallError("Cannot relay signal")
    emit([_other(call, user.id)], {"type": "call.signal", "call_id": call.id, "from_user_id": user.id, "data": payload})


def cleanup_user(db: Session, user_id: int) -> None:
    """User's last socket closed: hang up anything still active."""
    user = db.get(User, user_id)
    for call in db.scalars(select(CallLog).where(
            CallLog.status.in_(ACTIVE), or_(CallLog.caller_id == user_id, CallLog.callee_id == user_id))).all():
        end(db, user, {"call_id": call.id})
