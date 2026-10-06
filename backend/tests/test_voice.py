"""语音链路测试：TTS 配置暴露、不可用时的降级契约、DeepSeek 这类无 TTS 服务的识别。"""

from __future__ import annotations

import asyncio

import pytest
from fastapi.testclient import TestClient

from backend.app.main import app
from backend.app.services import speech


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as test_client:
        yield test_client


def test_config_exposes_tts_status(client: TestClient):
    config = client.get("/api/config").json()
    assert "tts_ready" in config and "tts_hint" in config and "tts_voice" in config
    assert isinstance(config["tts_ready"], bool)
    if not config["tts_ready"]:
        assert config["tts_hint"], "不可用时必须给出修复提示"


def test_balance_error_maps_to_402(client: TestClient, monkeypatch):
    """服务商返回余额不足时：接口应给出 402 + SPEECH_BALANCE，而不是 500/502。"""

    async def broke(_text: str) -> bytes:
        raise speech.SpeechProviderError("语音合成失败：账户余额不足", code="SPEECH_BALANCE", status=402)

    monkeypatch.setattr(speech, "synthesize", broke)
    response = client.post("/api/tts", json={"text": "余额不足测试"})
    assert response.status_code == 402
    detail = response.json()["detail"]
    assert detail["code"] == "SPEECH_BALANCE" and "余额" in detail["message"]


def test_asr_provider_error_is_not_500(client: TestClient, monkeypatch):
    async def broken(*_args, **_kwargs):
        raise speech.SpeechProviderError("语音识别失败：Key 无效", code="SPEECH_AUTH", status=409)

    monkeypatch.setattr(speech, "transcribe", broken)
    response = client.post("/api/asr", files={"file": ("a.webm", b"0000", "audio/webm")})
    assert response.status_code == 409, response.text
    assert response.json()["detail"]["code"] == "SPEECH_AUTH"


def test_tts_failure_paths_are_readable(client: TestClient):
    """云端语音不可用时必须是「可读的失败」：501 未配置 / 402 余额 / 429 限流 / 502 上游，绝不能 500。"""
    response = client.post("/api/tts", json={"text": "你好"})
    if response.status_code == 200:
        pytest.skip("当前环境云端 TTS 可用")
    assert response.status_code in (402, 409, 429, 501, 502), response.text
    detail = response.json()["detail"]
    message = detail if isinstance(detail, str) else detail.get("message", "")
    assert "语音" in message


def test_known_chat_only_provider_is_marked_unavailable(monkeypatch):
    from backend.app.config import get_settings

    monkeypatch.setenv("TTS_API_KEY", "sk-test")
    monkeypatch.setenv("TTS_BASE_URL", "https://api.deepseek.com")
    get_settings.cache_clear()
    settings = get_settings()
    assert settings.tts_ready is False, "DeepSeek 这类只有对话接口的服务不应被当成可用的 TTS"
    with pytest.raises(speech.SpeechUnavailable) as error:
        asyncio.run(speech.synthesize("测试"))
    assert "TTS_BASE_URL" in str(error.value)
    get_settings.cache_clear()


def test_asr_config_and_chat_only_provider(monkeypatch):
    from backend.app.config import get_settings

    monkeypatch.setenv("OPENAI_API_KEY", "sk-deepseek")
    monkeypatch.setenv("OPENAI_BASE_URL", "https://api.deepseek.com")
    monkeypatch.setenv("ASR_API_KEY", "")
    monkeypatch.setenv("ASR_BASE_URL", "")
    get_settings.cache_clear()
    settings = get_settings()
    assert settings.asr_key == "sk-deepseek", "ASR Key 应回落到 OPENAI_API_KEY"
    assert settings.asr_ready is False, "DeepSeek 没有 /v1/audio/transcriptions，不应算可用"
    with pytest.raises(speech.SpeechUnavailable) as error:
        asyncio.run(speech.transcribe(b"0000", "a.wav", "audio/wav"))
    assert "ASR_BASE_URL" in str(error.value)

    monkeypatch.setenv("ASR_API_KEY", "sk-silicon")
    monkeypatch.setenv("ASR_BASE_URL", "https://api.siliconflow.cn/v1")
    monkeypatch.setenv("ASR_MODEL", "FunAudioLLM/SenseVoiceSmall")
    get_settings.cache_clear()
    settings = get_settings()
    assert settings.asr_ready is True
    assert settings.asr_model == "FunAudioLLM/SenseVoiceSmall"
    assert settings.asr_endpoint == "https://api.siliconflow.cn/v1"
    get_settings.cache_clear()


def test_config_exposes_asr_status(client: TestClient):
    config = client.get("/api/config").json()
    assert "asr_ready" in config and "asr_model" in config
    assert isinstance(config["asr_ready"], bool)


def test_tts_key_falls_back_to_openai_key(monkeypatch):
    from backend.app.config import get_settings

    monkeypatch.setenv("TTS_API_KEY", "")
    monkeypatch.setenv("TTS_BASE_URL", "")
    monkeypatch.setenv("OPENAI_API_KEY", "sk-openai")
    monkeypatch.setenv("OPENAI_BASE_URL", "https://api.openai.com/v1")
    get_settings.cache_clear()
    settings = get_settings()
    assert settings.tts_key == "sk-openai"
    assert settings.tts_endpoint == "https://api.openai.com/v1"
    assert settings.tts_ready is True
    get_settings.cache_clear()
