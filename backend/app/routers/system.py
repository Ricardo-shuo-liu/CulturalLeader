from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..db import get_db
from ..models import City
from ..schemas import HealthOut

router = APIRouter(prefix="/api", tags=["system"])


@router.get("/health", response_model=HealthOut)
def health(db: Session = Depends(get_db)) -> HealthOut:
    settings = get_settings()
    count = db.scalar(select(func.count()).select_from(City)) or 0
    return HealthOut(status="ok", mock=settings.mock, city_count=count, version="0.1.0")
