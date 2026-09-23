from __future__ import annotations

from pydantic import BaseModel, Field


class KnowledgeOut(BaseModel):
    id: int
    question: str
    answer: str

    model_config = {"from_attributes": True}


class KnowledgeIn(BaseModel):
    question: str = Field(min_length=1)
    answer: str = Field(min_length=1)


class CityOut(BaseModel):
    id: int
    slug: str
    name: str
    province: str
    lng: float
    lat: float
    accent_color: str
    summary: str
    tags: list[str]
    landmark_key: str
    sort_order: int


class CityDetail(CityOut):
    narration: str
    knowledge: list[KnowledgeOut]


class CityIn(BaseModel):
    slug: str
    name: str
    province: str = ""
    lng: float
    lat: float
    accent_color: str = "#F2C879"
    summary: str = ""
    tags: list[str] = Field(default_factory=list)
    landmark_key: str = "generic"
    narration: str = ""
    sort_order: int = 100


class CityUpdate(BaseModel):
    name: str | None = None
    province: str | None = None
    lng: float | None = None
    lat: float | None = None
    accent_color: str | None = None
    summary: str | None = None
    tags: list[str] | None = None
    landmark_key: str | None = None
    narration: str | None = None
    sort_order: int | None = None


class ChatRequest(BaseModel):
    city_slug: str
    message: str
    session_id: str | None = None


class AsrResponse(BaseModel):
    text: str
    engine: str


class HealthOut(BaseModel):
    status: str
    mock: bool
    city_count: int
    version: str
