"""非遗资料库 RAG：状态、检索调试、重建索引（重建需要后台令牌）。"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from ..services import rag
from .admin import require_token

router = APIRouter(prefix="/api/rag", tags=["rag"])


class RagSearchRequest(BaseModel):
    query: str = Field(min_length=1, max_length=300)
    top_k: int = Field(default=6, ge=1, le=20)
    tier: str | None = None
    category: str | None = None


@router.get("/status")
def status() -> dict:
    return rag.status()


@router.post("/search")
def search(payload: RagSearchRequest) -> dict:
    hits = rag.search(payload.query, top_k=payload.top_k, tier=payload.tier, category=payload.category)
    return {
        "query": payload.query,
        "count": len(hits),
        "hits": [hit.to_dict() for hit in hits],
        "context": rag.build_context(hits),
        "sources": rag.sources_payload(hits),
    }


@router.post("/rebuild", dependencies=[Depends(require_token)])
def rebuild() -> dict:
    try:
        return rag.rebuild_index()
    except Exception as error:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"索引重建失败：{error}") from error
