from __future__ import annotations

import json
import re
import time
from collections import defaultdict, deque

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel, Field

from ..services.atelier import storage
from ..services.atelier.pipeline import stream_generation

router = APIRouter(prefix="/api/atelier", tags=["atelier"])

_ALLOWED_FILES = {"scene.png", "scene@2x.png", "postcard.png", "scene.json", "scene.zip"}
_JOB_RE = re.compile(r"^[0-9a-f]{32}$")


class AtelierRequest(BaseModel):
    prompt: str = Field(min_length=1, max_length=200)
    seed: int | None = None
    session_id: str | None = None


class RateLimiter:
    def __init__(self, limit: int = 6, window: float = 60.0):
        self.limit = limit
        self.window = window
        self.hits: dict[str, deque[float]] = defaultdict(deque)

    def allow(self, key: str, now: float | None = None) -> bool:
        current = time.monotonic() if now is None else now
        bucket = self.hits[key]
        while bucket and current - bucket[0] >= self.window:
            bucket.popleft()
        if len(bucket) >= self.limit:
            return False
        bucket.append(current)
        return True


_limiter = RateLimiter()


def sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


@router.post("/stream")
async def stream(payload: AtelierRequest, request: Request) -> StreamingResponse:
    client = request.client.host if request.client else "anonymous"
    if not _limiter.allow(client):
        raise HTTPException(status_code=429, detail="造境太频繁，请稍后再试")

    async def event_stream():
        async for item in stream_generation(
            payload.prompt,
            seed=payload.seed,
            session_id=payload.session_id or "",
        ):
            yield sse(item.event, item.data)

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no", "Connection": "keep-alive"},
    )


@router.get("/files/{job_id}/{name}")
def download(job_id: str, name: str) -> FileResponse:
    if not _JOB_RE.fullmatch(job_id) or name not in _ALLOWED_FILES:
        raise HTTPException(status_code=404, detail="文件不存在")
    path = storage.ATELIER_DIR / job_id / name
    if not path.is_file():
        raise HTTPException(status_code=404, detail="文件不存在")
    return FileResponse(path, filename=name)
