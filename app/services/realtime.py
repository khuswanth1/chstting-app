"""In-process WebSocket connection registry.

Single-process only. To scale horizontally, replace `ConnectionManager.send_many` with a
Redis pub/sub fan-out (documented in README as additional infrastructure).
"""
import asyncio
import logging
from typing import Iterable

from anyio import from_thread
from fastapi import WebSocket

log = logging.getLogger("chatflow.ws")


class Conn:
    def __init__(self, ws: WebSocket):
        self.ws = ws
        self.lock = asyncio.Lock()

    async def send(self, event: dict):
        async with self.lock:
            await self.ws.send_json(event)


class ConnectionManager:
    def __init__(self):
        self.conns: dict[int, set[Conn]] = {}
        self.loop: asyncio.AbstractEventLoop | None = None  # set at startup so plain threads can emit too

    def is_online(self, user_id: int) -> bool:
        return bool(self.conns.get(user_id))

    def online_ids(self) -> list[int]:
        return [u for u, c in self.conns.items() if c]

    def add(self, user_id: int, ws: WebSocket) -> tuple[Conn, bool]:
        conn = Conn(ws)
        first = not self.conns.get(user_id)
        self.conns.setdefault(user_id, set()).add(conn)
        return conn, first

    def remove(self, user_id: int, conn: Conn) -> bool:
        """Returns True if that was the user's last connection."""
        s = self.conns.get(user_id)
        if not s:
            return False
        s.discard(conn)
        if not s:
            self.conns.pop(user_id, None)
            return True
        return False

    async def send_many(self, user_ids: Iterable[int], event: dict):
        for uid in set(user_ids):
            for conn in list(self.conns.get(uid, ())):
                try:
                    await conn.send(event)
                except Exception:  # dead socket; the receive loop will clean it up
                    log.debug("send failed for user %s", uid)


manager = ConnectionManager()


def emit(user_ids: Iterable[int], event: dict) -> None:
    """Send an event to users from sync code (REST handlers / threadpool WS handlers)."""
    ids = set(user_ids)
    if not ids:
        return
    try:
        from_thread.run(manager.send_many, ids, event)
        return
    except RuntimeError:
        pass  # not an AnyIO worker thread (e.g. our own ThreadPoolExecutor for the AI bot / webhooks)
    loop = manager.loop
    if loop and loop.is_running():
        asyncio.run_coroutine_threadsafe(manager.send_many(ids, event), loop)  # fire-and-forget
