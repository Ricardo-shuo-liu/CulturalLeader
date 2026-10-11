"""穿越系统测试：三朝数据完整性、接口结构、朝代对话（SSE）与会话隔离。"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from backend.app.data import dynasties as dynasty_data
from backend.app.main import app


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as test_client:
        yield test_client


PERIOD_ORDER = ["qin", "han", "sanguo", "jin", "sui", "tang", "song", "yuan", "ming", "qing", "modern"]


def test_registry_covers_qin_to_modern():
    items = dynasty_data.dynasty_list()
    keys = [item["key"] for item in items]
    assert keys == PERIOD_ORDER, keys
    for item in items:
        assert item["name"] and item["period"] and item["capital"] and item["color"]
        assert item["summary"]
        assert item["places"] >= 12, f"{item['key']} 地点不足：{item['places']}"
        assert item["poems"] >= 10, f"{item['key']} 诗词不足：{item['poems']}"


@pytest.mark.parametrize("key", PERIOD_ORDER)
def test_dynasty_data_integrity(key: str):
    dynasty = dynasty_data.get_dynasty(key)
    assert dynasty is not None

    # 示意疆域：闭合环 + 点数区间 + 经纬度落在中国附近
    outline = dynasty["outline"]
    assert 40 <= len(outline) <= 130, f"{key} outline 点数 {len(outline)}"
    assert outline[0] == outline[-1], f"{key} outline 未闭合"
    for lng, lat in outline:
        assert 70 <= lng <= 140, f"{key} outline 经度越界：{lng}"
        assert 15 <= lat <= 55, f"{key} outline 纬度越界：{lat}"

    place_ids = [place["id"] for place in dynasty["places"]]
    assert len(place_ids) == len(set(place_ids)), f"{key} 地点 id 重复"
    assert len(place_ids) >= 12
    for place in dynasty["places"]:
        assert 73 <= place["lng"] <= 136, f"{key}/{place['id']} 经度越界"
        assert 3 <= place["lat"] <= 54, f"{key}/{place['id']} 纬度越界"
        assert place["ancient"] and place["modern"] and place["kind_label"]
        assert place["summary"] and place["narration"]
        # 新增时期密度低于唐/宋/明，每个地名至少 1 条问答即可
        assert len(place["knowledge"]) >= 1, f"{key}/{place['id']} 问答条目不足"

    poem_ids = [poem["id"] for poem in dynasty["poems"]]
    assert len(poem_ids) == len(set(poem_ids)), f"{key} 诗词 id 重复"
    assert len(poem_ids) >= 10
    for poem in dynasty["poems"]:
        assert poem["title"] and poem["author"] and poem["text"]
        assert poem["background"]
        assert len(poem["text"].strip()) >= 8, f"{key}/{poem['id']} 正文过短"
        assert poem["place_id"] in place_ids, f"{key}/{poem['id']} 写作地不存在：{poem['place_id']}"
        assert len(poem["knowledge"]) >= 1, f"{key}/{poem['id']} 问答条目不足"

    # 立碑的代表诗词：每朝 4–8 首，清单与逐条标记必须一致
    featured = dynasty.get("featured") or []
    assert 4 <= len(featured) <= 8, f"{key} 立碑数量 {len(featured)} 不在 4–8"
    assert all(poem_id in poem_ids for poem_id in featured), f"{key} 立碑诗词不存在"
    assert {poem["id"] for poem in dynasty["poems"] if poem.get("featured")} == set(featured)


def test_api_list_and_detail(client: TestClient):
    listing = client.get("/api/dynasty/list").json()
    assert listing["count"] == len(PERIOD_ORDER)
    assert [item["key"] for item in listing["dynasties"]] == PERIOD_ORDER

    detail = client.get("/api/dynasty/tang").json()["dynasty"]
    assert detail["key"] == "tang" and detail["name"] == "唐"
    assert detail["outline"] and len(detail["places"]) >= 12 and len(detail["poems"]) >= 12
    kinds = {place["kind_label"] for place in detail["places"]}
    assert kinds and all(kinds)
    # 诗词的写作地必须能对上地点
    place_ids = {place["id"] for place in detail["places"]}
    assert all(poem["place_id"] in place_ids for poem in detail["poems"])


@pytest.mark.parametrize("key", ["qin", "sanguo", "qing", "modern"])
def test_new_periods_have_names_and_poems(client: TestClient, key: str):
    """新增时期的接口也必须有地名、诗词与发光字清单（地图上要看得到名字）。"""
    detail = client.get(f"/api/dynasty/{key}").json()["dynasty"]
    assert len(detail["places"]) >= 12
    assert len(detail["poems"]) >= 10
    assert 4 <= len(detail["featured"]) <= 8
    assert all(place["ancient"] and place["modern"] for place in detail["places"])


def test_unknown_dynasty_is_404(client: TestClient):
    assert client.get("/api/dynasty/nonexistent").status_code == 404
    assert client.post("/api/dynasty/nonexistent/chat", json={"message": "你好"}).status_code == 404


def test_chat_without_key_returns_409(client: TestClient, monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "")
    from backend.app.config import get_settings

    get_settings.cache_clear()
    try:
        response = client.post("/api/dynasty/tang/chat", json={"message": "讲讲长安", "place_id": "changan"})
        assert response.status_code == 409, response.text
        detail = response.json()["detail"]
        assert detail["code"] == "LLM_KEY_MISSING"
        assert "OPENAI_API_KEY" in detail["message"]
    finally:
        get_settings.cache_clear()


def test_chat_streams_with_dynasty_prompt(client: TestClient, monkeypatch):
    from backend.app.routers import dynasty as dynasty_router

    captured: dict = {}

    async def fake_stream(city, knowledge, history, question, *, system_prompt=None):
        captured["prompt"] = system_prompt or ""
        captured["question"] = question
        for piece in ["长安", "一百零八坊，", "夜里坊门一闭就是另一番光景。"]:
            yield piece

    monkeypatch.setattr(dynasty_router, "stream_reply", fake_stream)
    with client.stream(
        "POST",
        "/api/dynasty/tang/chat",
        json={"message": "讲讲静夜思是在哪里写的？", "poem_id": "jingyesi"},
    ) as response:
        assert response.status_code == 200, response.text
        body = "".join(response.iter_text())

    assert "event: meta" in body
    assert "event: token" in body and "event: sentence" in body and "event: done" in body
    prompt = captured["prompt"]
    assert "大唐" in prompt and "618–907" in prompt and "长安" in prompt
    assert "静夜思" in prompt and "床前明月光" in prompt
    assert "扬州" in prompt, "诗词上下文里应带写作地今名/古名"
    assert captured["question"].startswith("讲讲静夜思")


def test_chat_session_is_dynasty_namespaced(client: TestClient, monkeypatch):
    from backend.app.db import SessionLocal
    from backend.app.models import ChatSession
    from backend.app.routers import dynasty as dynasty_router

    async def fake_stream(city, knowledge, history, question, *, system_prompt=None):
        yield "层峦叠嶂"

    monkeypatch.setattr(dynasty_router, "stream_reply", fake_stream)
    with client.stream(
        "POST",
        "/api/dynasty/song/chat",
        json={"message": "临安是什么样的城市？", "place_id": "linan", "session_id": "dynasty-test-session"},
    ) as response:
        assert response.status_code == 200
        body = "".join(response.iter_text())
    assert "dynasty-test-session" in body

    with SessionLocal() as db:
        session = db.get(ChatSession, "dynasty-test-session")
        assert session is not None
        assert session.city_slug == "dynasty:song:place:linan"
