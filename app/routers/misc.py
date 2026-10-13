import base64
import hashlib
import hmac
import secrets
import time

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import func, or_, select, update
from sqlalchemy.orm import Session

from ..config import get_settings
from ..database import get_db
from ..deps import current_user
from ..models import CallLog, Notification, User, Webhook
from ..schemas import WebhookIn, WebhookPatchIn
from ..services import group_calls, webhooks
from ..services.notify import notification_out
from ..services.serializers import iso, user_public

router = APIRouter()


# ---------- notifications ----------

@router.get("/notifications", tags=["Notifications"], summary="List in-app notifications")
def list_notifications(limit: int = Query(30, ge=1, le=100), before_id: int | None = None,
                       user: User = Depends(current_user), db: Session = Depends(get_db)):
    q = select(Notification).where(Notification.user_id == user.id)
    if before_id:
        q = q.where(Notification.id < before_id)
    items = db.scalars(q.order_by(Notification.id.desc()).limit(limit)).all()
    unread = db.scalar(select(func.count()).select_from(Notification).where(
        Notification.user_id == user.id, Notification.read.is_(False)))
    return {"items": [notification_out(n) for n in items], "unread": unread}


@router.post("/notifications/read", status_code=204, tags=["Notifications"], summary="Mark all notifications read")
def read_notifications(user: User = Depends(current_user), db: Session = Depends(get_db)):
    db.execute(update(Notification).where(Notification.user_id == user.id).values(read=True))
    db.commit()
    return Response(status_code=204)


# ---------- calls ----------

@router.get("/calls/ice", tags=["Calls"], summary="ICE server config for WebRTC (STUN + optional short-lived TURN credentials)")
def ice(user: User = Depends(current_user)):
    s = get_settings()
    servers = [{"urls": [u.strip() for u in s.stun_urls.split(",") if u.strip()]}]
    if s.turn_secret and s.turn_urls:
        # coturn "TURN REST API" scheme: username = expiry:userid, credential = base64(HMAC-SHA1(secret, username))
        username = f"{int(time.time()) + s.turn_ttl_seconds}:{user.id}"
        credential = base64.b64encode(hmac.new(s.turn_secret.encode(), username.encode(), hashlib.sha1).digest()).decode()
        servers.append({"urls": [u.strip() for u in s.turn_urls.split(",") if u.strip()],
                        "username": username, "credential": credential})
    elif s.turn_url:
        servers.append({"urls": [s.turn_url], "username": s.turn_username, "credential": s.turn_credential})
    return {"iceServers": servers, "ttl": s.turn_ttl_seconds}


@router.get("/calls/group/active", tags=["Calls"], summary="Ongoing group calls in my group chats")
def active_group_calls(user: User = Depends(current_user), db: Session = Depends(get_db)):
    return group_calls.active_rooms_for(db, user.id)


@router.get("/calls/config", tags=["Calls"], summary="Which ICE features are configured (no secrets)")
def call_config(user: User = Depends(current_user)):
    s = get_settings()
    return {"stun": bool(s.stun_urls.strip()), "turn": s.turn_mode, "ttl": s.turn_ttl_seconds,
            "warnings": s.webrtc_warnings(), "group_calls": True,
            "group_call_max": group_calls.MAX_PARTICIPANTS}


@router.get("/calls", tags=["Calls"], summary="Call history")
def call_history(limit: int = Query(30, ge=1, le=100), offset: int = Query(0, ge=0),
                 user: User = Depends(current_user), db: Session = Depends(get_db)):
    rows = db.scalars(select(CallLog).where(or_(CallLog.caller_id == user.id, CallLog.callee_id == user.id))
                      .order_by(CallLog.id.desc()).limit(limit).offset(offset)).all()
    out = []
    for c in rows:
        outgoing = c.caller_id == user.id
        peer = c.callee if outgoing else c.caller
        out.append({"id": c.id, "kind": c.kind, "status": c.status, "direction": "outgoing" if outgoing else "incoming",
                    "chat_id": c.chat_id, "peer": user_public(db, peer, user.id), "created_at": iso(c.created_at),
                    "answered_at": iso(c.answered_at), "ended_at": iso(c.ended_at)})
    return out


# ---------- webhooks ----------

def _hook_out(h: Webhook, secret: bool = False) -> dict:
    d = {"id": h.id, "url": h.url, "events": h.events, "active": h.active, "created_at": iso(h.created_at)}
    if secret:
        d["secret"] = h.secret
    return d


@router.get("/webhooks/events", tags=["Webhooks"], summary="Supported event names")
def hook_events():
    return webhooks.SUPPORTED_EVENTS


@router.get("/webhooks", tags=["Webhooks"], summary="List my webhooks")
def list_hooks(user: User = Depends(current_user), db: Session = Depends(get_db)):
    return [_hook_out(h) for h in db.scalars(select(Webhook).where(Webhook.user_id == user.id))]


@router.post("/webhooks", status_code=201, tags=["Webhooks"],
             summary="Register a webhook (the signing secret is returned once)")
def create_hook(data: WebhookIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    bad = [e for e in data.events if e not in webhooks.SUPPORTED_EVENTS]
    if bad:
        raise HTTPException(422, f"Unknown events: {', '.join(bad)}")
    if err := webhooks.validate_url(data.url):
        raise HTTPException(422, err)
    h = Webhook(user_id=user.id, url=data.url, events=data.events, secret=secrets.token_urlsafe(32))
    db.add(h)
    db.commit()
    return _hook_out(h, secret=True)


@router.patch("/webhooks/{hook_id}", tags=["Webhooks"], summary="Enable/disable or change events")
def patch_hook(hook_id: int, data: WebhookPatchIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    h = db.scalar(select(Webhook).where(Webhook.id == hook_id, Webhook.user_id == user.id))
    if not h:
        raise HTTPException(404, "Webhook not found")
    if data.active is not None:
        h.active = data.active
    if data.events is not None:
        if any(e not in webhooks.SUPPORTED_EVENTS for e in data.events):
            raise HTTPException(422, "Unknown event")
        h.events = data.events
    db.commit()
    return _hook_out(h)


@router.delete("/webhooks/{hook_id}", status_code=204, tags=["Webhooks"], summary="Delete a webhook")
def delete_hook(hook_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    h = db.scalar(select(Webhook).where(Webhook.id == hook_id, Webhook.user_id == user.id))
    if h:
        db.delete(h)
        db.commit()
    return Response(status_code=204)
