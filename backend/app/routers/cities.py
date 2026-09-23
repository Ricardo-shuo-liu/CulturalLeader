from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import City
from ..schemas import CityDetail, CityOut

router = APIRouter(prefix="/api/cities", tags=["cities"])


def _to_out(city: City) -> CityOut:
    return CityOut(
        id=city.id,
        slug=city.slug,
        name=city.name,
        province=city.province,
        lng=city.lng,
        lat=city.lat,
        accent_color=city.accent_color,
        summary=city.summary,
        tags=city.tag_list,
        landmark_key=city.landmark_key,
        sort_order=city.sort_order,
    )


@router.get("", response_model=list[CityOut])
def list_cities(db: Session = Depends(get_db)) -> list[CityOut]:
    cities = db.scalars(select(City).order_by(City.sort_order, City.id)).all()
    return [_to_out(city) for city in cities]


@router.get("/{slug}", response_model=CityDetail)
def city_detail(slug: str, db: Session = Depends(get_db)) -> CityDetail:
    city = db.scalar(select(City).where(City.slug == slug))
    if city is None:
        raise HTTPException(status_code=404, detail="城市不存在")
    base = _to_out(city)
    return CityDetail(
        **base.model_dump(),
        narration=city.narration,
        knowledge=[{"id": item.id, "question": item.question, "answer": item.answer} for item in city.knowledge],
    )
