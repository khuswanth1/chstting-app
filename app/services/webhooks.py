"""Outbound webhooks: signed HTTP POSTs to user-registered URLs when events occur."""
import hashlib
import hmac
import ipaddress
import json
import logging
import socket
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import urlparse

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..database import utcnow
from ..models import Webhook

log = logging.getLogger("chatflow.webhooks")

SUPPORTED_EVENTS = [
    "message.created", "message.updated", "message.deleted",
    "status.viewed", "call.missed", "chat.member_added",
]
_pool = ThreadPoolExecutor(max_workers=4, thread_name_prefix="webhook")


def validate_url(url: str) -> str | None:
    """Return an error string if the URL is unsafe (SSRF guard), else None."""
    p = urlparse(url)
    if p.scheme not in ("http", "https") or not p.hostname:
        return "Webhook URL must be http(s)"
    if get_settings().allow_private_webhooks:
        return None
    try:
        infos = socket.getaddrinfo(p.hostname, p.port or (443 if p.scheme == "https" else 80))
    except socket.gaierror:
        return "Webhook host cannot be resolved"
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast:
            return "Webhook URL points to a private address"
    return None


def sign(secret: str, body: bytes) -> str:
    return "sha256=" + hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()


def _post(url: str, headers: dict, body: bytes) -> int:
    # follow_redirects=False so a public URL cannot bounce us to an internal one
    return httpx.post(url, content=body, headers=headers, timeout=5, follow_redirects=False).status_code


def _deliver(url: str, secret: str, event: str, data: dict) -> None:
    if validate_url(url):
        log.warning("webhook skipped (unsafe url) %s", url)
        return
    body = json.dumps({"id": str(uuid.uuid4()), "event": event, "created_at": utcnow().isoformat(), "data": data}).encode()
    headers = {"Content-Type": "application/json", "X-ChatFlow-Event": event, "X-ChatFlow-Signature": sign(secret, body)}
    for attempt in range(3):
        try:
            if _post(url, headers, body) < 300:
                return
        except Exception as e:  # network errors are expected
            log.info("webhook attempt %s failed: %s", attempt + 1, e)
        time.sleep(2 ** attempt)


def dispatch(db: Session, event: str, user_ids, data: dict) -> None:
    ids = list(set(user_ids))
    if not ids:
        return
    hooks = db.scalars(select(Webhook).where(Webhook.user_id.in_(ids), Webhook.active.is_(True))).all()
    for h in hooks:
        if event in (h.events or []):
            _pool.submit(_deliver, h.url, h.secret, event, {**data, "recipient_id": h.user_id})
