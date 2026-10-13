from fastapi import APIRouter, Depends, File, Form, UploadFile
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import current_user
from ..models import Attachment, User
from ..services.serializers import attachment_out
from ..services.uploads import save_upload

router = APIRouter(prefix="/uploads", tags=["Media"])


@router.post("", status_code=201, summary="Upload a file; attach it to a message via attachment_ids")
async def upload(file: UploadFile = File(...), duration: int | None = Form(None, ge=0, le=3600), voice: bool = Form(False),
                 user: User = Depends(current_user), db: Session = Depends(get_db)):
    info = await save_upload(file, voice=voice)
    a = Attachment(uploader_id=user.id, kind=info["kind"], url=info["url"], filename=info["filename"],
                   mime=info["mime"], size=info["size"], duration=duration)
    db.add(a)
    db.commit()
    return attachment_out(a)
