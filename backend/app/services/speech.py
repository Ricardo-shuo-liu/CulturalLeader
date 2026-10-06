from __future__ import annotations

from ..config import get_settings


class SpeechUnavailable(RuntimeError):
    """未配置云端语音时抛出，前端据此切换到浏览器语音。"""


class SpeechProviderError(RuntimeError):
    """语音服务商返回的错误（Key 无效 / 余额不足 / 限流 / 上游异常），带可读中文与建议状态码。"""

    def __init__(self, message: str, *, code: str = "SPEECH_UPSTREAM", status: int = 502) -> None:
        super().__init__(message)
        self.code = code
        self.status = status


def _provider_error(error: Exception, action: str) -> SpeechProviderError:
    """把 OpenAI 兼容服务的 HTTP 错误翻译成人话（余额/Key/限流）。"""
    raw_status = getattr(error, "status_code", None) or 0
    body = getattr(error, "body", None)
    detail = ""
    provider_code = None
    if isinstance(body, dict):
        provider_code = body.get("code")
        detail = str(body.get("message") or "")
    if not detail:
        detail = str(error)[:180]
    if raw_status == 401 or provider_code in (30014,):
        return SpeechProviderError(
            f"{action}失败：语音服务的 Key 无效或已过期，请检查 TTS_API_KEY / ASR_API_KEY",
            code="SPEECH_AUTH",
            status=409,
        )
    if raw_status == 402 or provider_code in (30001,):
        return SpeechProviderError(
            f"{action}失败：语音服务账户余额不足（{detail}）。请到服务商控制台充值，"
            "或先使用浏览器语音（Linux 需安装 speech-dispatcher / espeak-ng）",
            code="SPEECH_BALANCE",
            status=402,
        )
    if raw_status == 429:
        return SpeechProviderError(
            f"{action}失败：请求过于频繁或额度用尽（{detail}）", code="SPEECH_RATE", status=429
        )
    return SpeechProviderError(f"{action}失败：{detail}", code="SPEECH_UPSTREAM", status=502)


def _asr_client():
    """语音识别可以用独立 Key/地址（例如硅基流动的 SenseVoice），不影响对话走 DeepSeek。"""
    from openai import AsyncOpenAI

    settings = get_settings()
    if not settings.asr_key:
        raise SpeechUnavailable("未配置语音识别 Key")
    if not settings.asr_ready:
        raise SpeechUnavailable(
            f"当前地址（{settings.asr_endpoint}）不提供语音识别接口；"
            "请把 ASR_BASE_URL / ASR_API_KEY 指向支持 /v1/audio/transcriptions 的服务（如硅基流动 FunAudioLLM/SenseVoiceSmall）"
        )
    return AsyncOpenAI(api_key=settings.asr_key, base_url=settings.asr_endpoint), settings


def _tts_client():
    """语音合可用独立 Key/地址：DeepSeek 这类只有对话接口的服务不能拿来合成语音。"""
    from openai import AsyncOpenAI

    settings = get_settings()
    if not settings.tts_key:
        raise SpeechUnavailable("未配置语音合成 Key")
    if not settings.tts_ready:
        raise SpeechUnavailable(
            f"当前地址（{settings.tts_endpoint}）不提供语音合成接口；"
            "请把 TTS_BASE_URL / TTS_API_KEY 指向支持 TTS 的服务，或改用浏览器语音"
        )
    return AsyncOpenAI(api_key=settings.tts_key, base_url=settings.tts_endpoint), settings


async def transcribe(data: bytes, filename: str, content_type: str) -> str:
    from openai import APIStatusError

    client, settings = _asr_client()
    try:
        result = await client.audio.transcriptions.create(
            model=settings.asr_model,
            file=(filename or "speech.webm", data, content_type or "audio/webm"),
        )
    except APIStatusError as error:
        raise _provider_error(error, "语音识别") from error
    return (getattr(result, "text", "") or "").strip()


async def synthesize(text: str) -> bytes:
    from openai import APIStatusError, BadRequestError, NotFoundError

    client, settings = _tts_client()
    try:
        async with client.audio.speech.with_streaming_response.create(
            model=settings.tts_model,
            voice=settings.tts_voice,
            input=text,
            response_format="mp3",
        ) as response:
            return await response.read()
    except NotFoundError as error:
        # 服务不支持 /v1/audio/speech（模型名或能力缺失）→ 当作「不可用」，让前端切浏览器语音
        raise SpeechUnavailable(
            f"当前语音服务不支持 TTS（{settings.tts_model}）：{error}；请配置 TTS_BASE_URL/TTS_API_KEY 或改用浏览器语音"
        ) from error
    except APIStatusError as error:
        raise _provider_error(error, "语音合成") from error
    except BadRequestError as error:
        raise RuntimeError(
            f"语音合成参数被拒绝：请检查 TTS_MODEL（当前 {settings.tts_model}）与 TTS_VOICE（当前 {settings.tts_voice}）"
            f"是否符合该服务的要求；原始错误：{error}"
        ) from error
