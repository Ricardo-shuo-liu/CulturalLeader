from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import City
from ..services.routing import solve_route

router = APIRouter(prefix="/api/route", tags=["route"])


class RouteRequest(BaseModel):
    slugs: list[str] = Field(min_length=2, max_length=40)


@router.post("/solve")
def solve(payload: RouteRequest, db: Session = Depends(get_db)) -> dict:
    unique: list[str] = []
    for slug in payload.slugs:
        if slug not in unique:
            unique.append(slug)
    if len(unique) < 2:
        raise HTTPException(status_code=400, detail="至少选择两座不同的城市")

    cities = db.scalars(select(City).where(City.slug.in_(unique))).all()
    by_slug = {city.slug: city for city in cities}
    missing = [slug for slug in unique if slug not in by_slug]
    if missing:
        raise HTTPException(status_code=404, detail=f"城市不存在：{', '.join(missing)}")

    return solve_route([by_slug[slug] for slug in unique])
