import asyncio

from backend.app.services.atelier.agent import build_scene_spec
from backend.app.services.atelier.search import SearchHit


def test_mock_mode_uses_rules():
    spec = asyncio.run(build_scene_spec("洛阳龙门石窟，黄昏", sources=[], seed=31))
    assert spec.place == "洛阳"
    assert spec.landmark_type == "cliff_buddha"
    assert spec.seed == 31
    assert spec.created_at


def test_sources_are_preserved():
    source = SearchHit(
        title="龙门石窟",
        url="https://example.org",
        publisher="维基百科",
        license="CC BY-SA",
        summary="...",
    )
    spec = asyncio.run(build_scene_spec("洛阳龙门石窟", sources=[source], seed=32))
    assert spec.sources[0].title == "龙门石窟"
    assert spec.sources[0].license == "CC BY-SA"


def _fake_settings():
    return type(
        "S",
        (),
        {
            "mock": False,
            "openai_api_key": "test-key",
            "base_url": None,
            "chat_model": "test-model",
        },
    )()


def _fake_client(content: str):
    class FakeClient:
        class chat:
            class completions:
                @staticmethod
                async def create(**kwargs):
                    class Message:
                        pass

                    Message.content = content

                    class Choice:
                        message = Message()

                    class Response:
                        choices = [Choice()]

                    return Response()

    return FakeClient()


def test_invalid_llm_json_falls_back(monkeypatch):
    monkeypatch.setattr("backend.app.services.atelier.agent.get_settings", _fake_settings)
    monkeypatch.setattr("backend.app.services.atelier.agent.AsyncOpenAI", lambda **kwargs: _fake_client("not json"))
    spec = asyncio.run(build_scene_spec("苏州水乡，春雨", sources=[], seed=33))
    assert spec.landmark_type == "water_town"


def test_valid_llm_json_is_normalized(monkeypatch):
    payload = '{"title": "测试", "place": "测试", "landmark_type": "skyline", "time": "night", "weather": "snow"}'
    monkeypatch.setattr("backend.app.services.atelier.agent.get_settings", _fake_settings)
    monkeypatch.setattr("backend.app.services.atelier.agent.AsyncOpenAI", lambda **kwargs: _fake_client(payload))
    spec = asyncio.run(build_scene_spec("测试城市，夜色，雪", sources=[], seed=34))
    assert spec.landmark_type == "skyline"
    assert spec.time == "night"
    assert spec.weather == "snow"
    assert spec.prompt == "测试城市，夜色，雪"
