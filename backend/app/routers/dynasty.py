"""穿越系统：朝代清单 / 朝代详情 / 与数字人的朝代对话（SSE）。"""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..data import dynasties as dynasty_data
from ..db import SessionLocal, get_db
from ..models import ChatSession, Message
from ..services.fay_human import build_audio_message, tts_url_for
from ..services.llm import stream_reply
from .chat import sse, split_sentences

router = APIRouter(prefix="/api/dynasty", tags=["dynasty"])


class DynastyChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=500)
    place_id: str | None = None
    poem_id: str | None = None
    session_id: str | None = None


@router.get("/list")
def list_dynasties() -> dict:
    items = dynasty_data.dynasty_list()
    return {"count": len(items), "dynasties": items}


@router.get("/{key}")
def get_dynasty(key: str) -> dict:
    payload = dynasty_data.get_dynasty(key)
    if payload is None:
        raise HTTPException(status_code=404, detail=f"没有这个朝代：{key}")
    return {"dynasty": payload}


@router.post("/{key}/chat")
async def dynasty_chat(key: str, payload: DynastyChatRequest, db: Session = Depends(get_db)) -> StreamingResponse:
    dynasty = dynasty_data.get_dynasty(key)
    if dynasty is None:
        raise HTTPException(status_code=404, detail=f"没有这个朝代：{key}")
    settings = get_settings()
    if not settings.openai_api_key.strip():
        raise HTTPException(
            status_code=409,
            detail={
                "code": "LLM_KEY_MISSING",
                "message": "朝代对话走大模型：请在 .env 配置 OPENAI_API_KEY（可指向兼容网关）后重启服务。",
            },
        )

    place = dynasty_data.find_place(dynasty, payload.place_id)
    poem = dynasty_data.find_poem(dynasty, payload.poem_id)
    if poem and poem.get("place_id"):
        host = next((item for item in dynasty["places"] if item["id"] == poem["place_id"]), None)
        if host:
            poem = {**poem, "place_label": f"{host['ancient']}（今 {host['modern']}）"}
    context_key = f"dynasty:{dynasty['key']}"
    if poem:
        context_key += f":poem:{poem['id']}"
    elif place:
        context_key += f":place:{place['id']}"

    session_id = payload.session_id or uuid.uuid4().hex
    session = db.get(ChatSession, session_id)
    if session is None:
        session = ChatSession(id=session_id, city_slug=context_key)
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

    system_prompt = dynasty_data.build_system_prompt(dynasty, place=place, poem=poem)
    speaker = dynasty

    async def event_stream() -> AsyncIterator[str]:
        yield sse("meta", {"session_id": session_id, "dynasty": dynasty["key"], "context": context_key})
        buffer = ""
        collected: list[str] = []
        sentence_index = 0
        is_mock = settings.mock

        def human_events(sentence: str, *, is_first: bool = False, is_end: bool = False) -> list[str]:
            nonlocal sentence_index
            audio_url = None if is_mock else tts_url_for(sentence, sentence_index)
            message = build_audio_message(
                text=sentence,
                index=sentence_index,
                audio_url=audio_url,
                is_first=is_first,
                is_end=is_end,
                username=session_id,
            )
            sentence_index += 1
            return [sse("human", message)]

        try:
            async for delta in stream_reply(
                speaker,
                [],
                history,
                payload.message,
                system_prompt=system_prompt,
                allow_mock=False,
            ):
                collected.append(delta)
                buffer += delta
                sentences, buffer = split_sentences(buffer)
                for sentence in sentences:
                    yield sse("sentence", {"text": sentence})
                    for event in human_events(sentence, is_first=sentence_index == 0):
                        yield event
                yield sse("token", {"text": delta})
            if buffer.strip():
                tail = buffer.strip()
                yield sse("sentence", {"text": tail})
                for event in human_events(tail, is_first=sentence_index == 0, is_end=True):
                    yield event
        except Exception as error:  # noqa: BLE001
            yield sse("error", {"message": f"讲解服务暂时不可用：{error}"})

        answer = "".join(collected).strip()
        if answer:
            with SessionLocal() as write_db:
                write_db.add(Message(session_id=session_id, role="assistant", content=answer))
                write_db.commit()
        yield sse("done", {"session_id": session_id, "dynasty": dynasty["key"]})

    return StreamingResponse(event_stream(), media_type="text/event-stream")
