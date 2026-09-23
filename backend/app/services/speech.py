from __future__ import annotations

from ..config import get_settings


class SpeechUnavailable(RuntimeError):
    """未配置云端语音时抛出，前端据此切换到浏览器语音。"""


def _client():
    from openai import AsyncOpenAI

    settings = get_settings()
    if settings.mock:
        raise SpeechUnavailable("mock mode")
    return AsyncOpenAI(api_key=settings.openai_api_key, base_url=settings.base_url), settings


async def transcribe(data: bytes, filename: str, content_type: str) -> str:
    client, settings = _client()
    result = await client.audio.transcriptions.create(
        model=settings.asr_model,
        file=(filename or "speech.webm", data, content_type or "audio/webm"),
    )
    return (getattr(result, "text", "") or "").strip()


async def synthesize(text: str) -> bytes:
    client, settings = _client()
    async with client.audio.speech.with_streaming_response.create(
        model=settings.tts_model,
        voice=settings.tts_voice,
        input=text,
        response_format="mp3",
    ) as response:
        return await response.read()
