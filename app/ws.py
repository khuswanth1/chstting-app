"""WebSocket endpoint.

Client -> server events: typing, message.send, message.read, ping,
                         call.invite, call.accept, call.reject, call.end, call.signal
Server -> client events: see README ("WebSocket events").
"""
import logging

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect
from fastapi.concurrency import run_in_threadpool
from fastapi.exceptions import HTTPException

from .database import SessionLocal
from .deps import user_from_token
from .services import calls, group_calls, messaging
from .services.presence import set_presence
from .services.realtime import emit, manager

log = logging.getLogger("chatflow.ws")
router = APIRouter()


def _authenticate(token: str) -> int | None:
    with SessionLocal() as db:
        u = user_from_token(db, token)
        return u.id if u else None


def _on_connect(user_id: int, first: bool) -> None:
    with SessionLocal() as db:
        messaging.deliver_pending(db, user_id)
        if first:
            set_presence(db, user_id, True)


def _on_disconnect(user_id: int) -> None:
    with SessionLocal() as db:
        calls.cleanup_user(db, user_id)
        group_calls.cleanup_user(db, user_id)
        set_presence(db, user_id, False)


def _handle(user_id: int, data: dict) -> dict | None:
    """Runs in a worker thread. Returns an optional direct reply to the sender."""
    t = data.get("type")
    with SessionLocal() as db:
        user = messaging.db_user(db, user_id)
        try:
            if t == "typing":
                chat_id = data.get("chat_id")
                messaging.get_member(db, chat_id, user_id)
                others = [i for i in messaging.member_ids(db, chat_id) if i != user_id]
                emit(others, {"type": "typing", "chat_id": chat_id, "user_id": user_id,
                              "is_typing": bool(data.get("is_typing", True))})
            elif t == "message.send":
                msg = messaging.send_message(
                    db, user, data.get("chat_id"), body=(data.get("body") or "").strip() or None,
                    reply_to_id=data.get("reply_to_id"), attachment_ids=data.get("attachment_ids") or [],
                    sticker=bool(data.get("sticker")))
                return {"type": "message.ack", "client_id": data.get("client_id"), "message": msg}
            elif t == "message.read":
                messaging.mark_read(db, user, data.get("chat_id"), data.get("up_to_id"))
            elif t == "call.invite":
                return calls.invite(db, user, data)
            elif t == "call.accept":
                calls.accept(db, user, data)
            elif t == "call.reject":
                calls.reject(db, user, data)
            elif t == "call.end":
                calls.end(db, user, data)
            elif t == "call.signal":
                calls.signal(db, user, data)
            elif t and t.startswith("group.call."):
                return group_calls.handle(db, user, t, data)
            elif t == "ping":
                return {"type": "pong"}
            else:
                return {"type": "error", "detail": f"Unknown event '{t}'"}
        except HTTPException as e:
            return {"type": "error", "detail": e.detail, "client_id": data.get("client_id"), "event": t}
        except (calls.CallError, group_calls.GroupCallError) as e:
            return {"type": "error", "detail": str(e), "event": t}
    return None


@router.websocket("/ws")
async def websocket_endpoint(ws: WebSocket, token: str = Query(default="")):
    # Browsers can't set headers on WebSocket handshakes, so the JWT travels in the query string.
    user_id = await run_in_threadpool(_authenticate, token)
    if user_id is None:
        await ws.close(code=4401)
        return
    await ws.accept()
    conn, first = manager.add(user_id, ws)
    await conn.send({"type": "ready", "user_id": user_id})
    await run_in_threadpool(_on_connect, user_id, first)
    try:
        while True:
            data = await ws.receive_json()
            if not isinstance(data, dict):
                continue
            reply = await run_in_threadpool(_handle, user_id, data)
            if reply:
                await conn.send(reply)
    except WebSocketDisconnect:
        pass
    except Exception:
        log.exception("websocket error")
    finally:
        if manager.remove(user_id, conn):
            await run_in_threadpool(_on_disconnect, user_id)
