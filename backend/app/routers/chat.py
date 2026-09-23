from __future__ import annotations

import json
import uuid
from collections.abc import AsyncIterator

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import SessionLocal, get_db
from ..models import ChatSession, City, Knowledge, Message
from ..schemas import AsrResponse, ChatRequest
from ..services import speech
from ..services.llm import stream_reply

router = APIRouter(prefix="/api", tags=["dialogue"])

SENTENCE_END = "。！？!?；;\n"


class TtsRequest(BaseModel):
    text: str = Field(min_length=1, max_length=600)


def sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


def split_sentences(buffer: str) -> tuple[list[str], str]:
    """把流式文本切成适合朗读的短句。"""

    sentences: list[str] = []
    start = 0
    for index, char in enumerate(buffer):
        length = index - start
        if char in SENTENCE_END and length >= 8:
            sentences.append(buffer[start : index + 1].strip())
            start = index + 1
        elif char in "，、," and length >= 30:
            sentences.append(buffer[start : index + 1].strip())
            start = index + 1
    return [item for item in sentences if item], buffer[start:]


@router.post("/chat")
async def chat(payload: ChatRequest, db: Session = Depends(get_db)) -> StreamingResponse:
    city = db.scalar(select(City).where(City.slug == payload.city_slug))
    if city is None:
        raise HTTPException(status_code=404, detail="城市不存在")

    city_id = city.id
    knowledge: list[Knowledge] = list(city.knowledge)
    session_id = payload.session_id or uuid.uuid4().hex
    session = db.get(ChatSession, session_id)
    if session is None:
        session = ChatSession(id=session_id, city_slug=city.slug)
        db.add(session)
        db.commit()

    db.add(Message(session_id=session_id, role="user", content=payload.message))
    db.commit()
    history = [
        (item.role, item.content)
        for item in db.scalars(
            select(Message).where(Message.session_id == session_id).order_by(Message.id.desc()).limit(8)
        ).all()
    ][::-1]
    history = history[:-1] if history else []

    city_snapshot = city

    async def event_stream() -> AsyncIterator[str]:
        yield sse("meta", {"session_id": session_id, "city": city_snapshot.slug})
        buffer = ""
        collected: list[str] = []
        try:
            async for delta in stream_reply(city_snapshot, knowledge, history, payload.message):
                collected.append(delta)
                buffer += delta
                sentences, buffer = split_sentences(buffer)
                for sentence in sentences:
                    yield sse("sentence", {"text": sentence})
                yield sse("token", {"text": delta})
            if buffer.strip():
                yield sse("sentence", {"text": buffer.strip()})
        except Exception as error:  # noqa: BLE001 对外只暴露可读信息
            yield sse("error", {"message": f"讲解服务暂时不可用：{error}"})

        answer = "".join(collected).strip()
        if answer:
            with SessionLocal() as write_db:
                write_db.add(Message(session_id=session_id, role="assistant", content=answer))
                write_db.commit()
        yield sse("done", {"session_id": session_id, "city": city_snapshot.slug})

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no", "Connection": "keep-alive"},
    )


@router.post("/asr", response_model=AsrResponse)
async def asr(file: UploadFile = File(...)) -> AsrResponse:
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="音频为空")
    try:
        text = await speech.transcribe(data, file.filename or "speech.webm", file.content_type or "audio/webm")
    except speech.SpeechUnavailable:
        raise HTTPException(status_code=501, detail="未配置云端语音识别，请使用浏览器语音或文字输入") from None
    if not text:
        raise HTTPException(status_code=422, detail="没有识别到语音内容")
    return AsrResponse(text=text, engine="openai")


@router.post("/tts")
async def tts(payload: TtsRequest) -> Response:
    try:
        audio = await speech.synthesize(payload.text)
    except speech.SpeechUnavailable:
        raise HTTPException(status_code=501, detail="未配置云端语音合成，请使用浏览器语音") from None
    except Exception as error:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"语音合成失败：{error}") from error
    return Response(content=audio, media_type="audio/mpeg")
