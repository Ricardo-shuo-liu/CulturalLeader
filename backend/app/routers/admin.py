from __future__ import annotations

import json

from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..db import get_db
from ..models import City, Knowledge
from ..schemas import CityDetail, CityIn, CityUpdate, KnowledgeIn

router = APIRouter(prefix="/api/admin", tags=["admin"])


def require_token(x_admin_token: str = Header(default="")) -> None:
    settings = get_settings()
    if x_admin_token != settings.admin_token:
        raise HTTPException(status_code=401, detail="后台令牌无效")


def _detail(city: City) -> CityDetail:
    return CityDetail(
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
        narration=city.narration,
        knowledge=[{"id": item.id, "question": item.question, "answer": item.answer} for item in city.knowledge],
    )


@router.get("/cities", response_model=list[CityDetail], dependencies=[Depends(require_token)])
def admin_list(db: Session = Depends(get_db)) -> list[CityDetail]:
    cities = db.scalars(select(City).order_by(City.sort_order, City.id)).all()
    return [_detail(city) for city in cities]


@router.post("/cities", response_model=CityDetail, dependencies=[Depends(require_token)])
def create_city(payload: CityIn, db: Session = Depends(get_db)) -> CityDetail:
    if db.scalar(select(City).where(City.slug == payload.slug)) is not None:
        raise HTTPException(status_code=409, detail="slug 已存在")
    city = City(
        slug=payload.slug,
        name=payload.name,
        province=payload.province,
        lng=payload.lng,
        lat=payload.lat,
        accent_color=payload.accent_color,
        summary=payload.summary,
        tags=json.dumps(payload.tags, ensure_ascii=False),
        landmark_key=payload.landmark_key,
        narration=payload.narration,
        sort_order=payload.sort_order,
    )
    db.add(city)
    db.commit()
    db.refresh(city)
    return _detail(city)


@router.put("/cities/{slug}", response_model=CityDetail, dependencies=[Depends(require_token)])
def update_city(slug: str, payload: CityUpdate, db: Session = Depends(get_db)) -> CityDetail:
    city = db.scalar(select(City).where(City.slug == slug))
    if city is None:
        raise HTTPException(status_code=404, detail="城市不存在")
    data = payload.model_dump(exclude_none=True)
    if "tags" in data:
        city.tags = json.dumps(data.pop("tags"), ensure_ascii=False)
    for key, value in data.items():
        setattr(city, key, value)
    db.commit()
    db.refresh(city)
    return _detail(city)


@router.delete("/cities/{slug}", dependencies=[Depends(require_token)])
def delete_city(slug: str, db: Session = Depends(get_db)) -> dict[str, str]:
    city = db.scalar(select(City).where(City.slug == slug))
    if city is None:
        raise HTTPException(status_code=404, detail="城市不存在")
    db.delete(city)
    db.commit()
    return {"status": "deleted", "slug": slug}


@router.put("/cities/{slug}/knowledge", response_model=CityDetail, dependencies=[Depends(require_token)])
def replace_knowledge(slug: str, items: list[KnowledgeIn], db: Session = Depends(get_db)) -> CityDetail:
    city = db.scalar(select(City).where(City.slug == slug))
    if city is None:
        raise HTTPException(status_code=404, detail="城市不存在")
    city.knowledge.clear()
    db.flush()
    city.knowledge = [Knowledge(question=item.question, answer=item.answer) for item in items]
    db.commit()
    db.refresh(city)
    return _detail(city)
