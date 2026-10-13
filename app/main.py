import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from .config import get_settings
from .database import SessionLocal
from .routers import ai as ai_router
from .routers import auth, backup, chats, media, misc, starred, status, uploads, users
from .services.presence import reset_all_presence
from .services.uploads import upload_root
from .ws import router as ws_router

log = logging.getLogger("chatflow")

DESCRIPTION = """
**ChatFlow** - a WhatsApp-style messaging API.

* REST for CRUD; authenticate with `Authorization: Bearer <JWT>` (get one from `/auth/login`).
* Real-time events (messages, typing, presence, receipts, calls) travel over the WebSocket at
  `ws://<host>/ws?token=<JWT>` - see the README for the event catalogue.
* Outbound **webhooks** are configured under *Webhooks*.
"""


async def _expiry_loop():
    from .routers.status import purge_expired
    while True:
        try:
            with SessionLocal() as db:
                purge_expired(db)
        except Exception:
            log.exception("status purge failed")
        await asyncio.sleep(600)


@asynccontextmanager
async def lifespan(app: FastAPI):
    from .services.realtime import manager
    manager.loop = asyncio.get_running_loop()
    for w in get_settings().webrtc_warnings():
        log.warning("WebRTC config: %s", w)
    with SessionLocal() as db:
        reset_all_presence(db)  # a crashed server may have left users flagged online
        if get_settings().ai_enabled:
            from .services.ai import get_or_create_bot
            get_or_create_bot(db)
    task = asyncio.create_task(_expiry_loop())
    yield
    task.cancel()


app = FastAPI(title="ChatFlow API", version="1.0.0", description=DESCRIPTION, lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=get_settings().cors_list,
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    resp = await call_next(request)
    resp.headers["X-Content-Type-Options"] = "nosniff"
    if request.url.path.startswith("/uploads/"):
        resp.headers["Content-Security-Policy"] = "default-src 'none'; sandbox"
        resp.headers["Cross-Origin-Resource-Policy"] = "cross-origin"
    return resp


@app.exception_handler(Exception)
async def unhandled(request: Request, exc: Exception):
    log.exception("unhandled error on %s", request.url.path)
    return JSONResponse({"detail": "Internal server error"}, status_code=500)


for r in (auth.router, users.router, chats.router, chats.msg_router, uploads.router, media.router, backup.router, starred.router, status.router, misc.router, ai_router.router, ws_router):
    app.include_router(r)

app.mount("/uploads", StaticFiles(directory=str(upload_root())), name="uploads")


@app.get("/health", tags=["Meta"])
def health():
    return {"status": "ok"}
