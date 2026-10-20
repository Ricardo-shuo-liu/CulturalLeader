"""非遗资料库 RAG：索引构建、检索排序、API、对话注入与引用来源。"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend.app.main import app
from backend.app.services import rag


def write_jsonl(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(json.dumps(row, ensure_ascii=False) for row in rows) + "\n", encoding="utf-8")


@pytest.fixture()
def rag_env(tmp_path: Path, monkeypatch):
    asset = tmp_path / "asset"
    write_jsonl(
        asset / "head/projects/head_projects.jsonl",
        [
            {
                "id": "1",
                "title": "苗族古歌",
                "num": "Ⅰ-1",
                "category": "民间文学",
                "project_kind": "新增项目",
                "announce_year": "2006",
                "announce_batch": "第一批",
                "regions": ["贵州省台江县"],
                "protect_unit": "台江县非物质文化遗产保护中心",
                "source_url": "https://example.org/1",
            }
        ],
    )
    write_jsonl(
        asset / "head/passages/head_passages.jsonl",
        [
            {
                "id": "1",
                "title": "苗族古歌",
                "paragraphs": [
                    "苗族古歌是苗族创世史诗，内容包括开天辟地、人类起源与民族迁徙。",
                    "古歌多在鼓社祭、婚丧与节日时演唱，由歌师口耳相传。",
                ],
                "source_url": "https://example.org/1",
            }
        ],
    )
    write_jsonl(
        asset / "head/triples/head_triples.jsonl",
        [{"subject": "苗族古歌", "predicate": "所属门类", "object": "民间文学", "source": "s"}],
    )
    write_jsonl(
        asset / "head/inheritors/head_inheritors.jsonl",
        [
            {
                "id": "9",
                "name": "刘永洪",
                "sex": "男",
                "nation": "苗族",
                "birth": "1936.10",
                "category": "民间文学",
                "project": "苗族古歌",
                "batch": "第一批",
                "batch_year": "2007",
                "region": "贵州省台江县",
                "bio": "刘永洪是苗族古歌的国家级代表性传承人，能完整演唱多部古歌。",
                "source_url": "https://example.org/9",
            }
        ],
    )
    write_jsonl(
        asset / "head/inheritors/head_inheritor_triples.jsonl",
        [{"subject": "苗族古歌", "predicate": "代表性传承人", "object": "刘永洪", "source": "s"}],
    )
    write_jsonl(
        asset / "waist/projects/waist_projects.jsonl",
        [
            {
                "id": "2",
                "title": "中国剪纸",
                "num": "Ⅶ-16",
                "category": "传统美术",
                "project_kind": "新增项目",
                "announce_year": "2006",
                "announce_batch": "第一批",
                "regions": ["陕西省"],
                "source_url": "https://example.org/2",
            }
        ],
    )
    write_jsonl(
        asset / "waist/passages/waist_passages.jsonl",
        [{"id": "2", "title": "中国剪纸", "paragraphs": ["中国剪纸用剪刀或刻刀在纸上镂空，常用于窗花与节庆装饰。"]}],
    )
    write_jsonl(
        asset / "tail/projects/tail_projects.jsonl",
        [
            {
                "province": "安徽省",
                "title": "皖西大别山民歌",
                "level": "省级",
                "category": "传统音乐",
                "region": "六安市",
                "protect_unit": None,
                "batch": "第一批",
                "year": "2006",
                "source_url": "geodoi:test",
            }
        ],
    )
    write_jsonl(
        asset / "tail/triples/tail_triples.jsonl",
        [{"subject": "皖西大别山民歌", "predicate": "所属门类", "object": "传统音乐", "source": "geodoi:test"}],
    )
    monkeypatch.setenv("RAG_ENABLED", "1")
    monkeypatch.setenv("RAG_ASSET_DIR", str(asset))
    monkeypatch.setenv("RAG_DIR", str(tmp_path / "rag"))
    monkeypatch.setenv("RAG_TOP_K", "4")
    from backend.app.config import get_settings

    get_settings.cache_clear()
    stats = rag.rebuild_index()
    assert stats["chunks"] and int(stats["chunks"]) >= 5
    yield asset
    get_settings.cache_clear()


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as test_client:
        yield test_client


def test_index_build_and_status(rag_env):
    state = rag.status()
    assert state["ready"] is True
    assert state["counts"]["projects"] >= 2
    assert state["counts"]["passages"] >= 2
    assert state["counts"]["titles"] >= 3
    assert not state["stale"]


def test_search_prefers_entity_card(rag_env):
    hits = rag.search("苗族古歌讲的是什么", top_k=4)
    assert hits, "应检索到苗族古歌"
    assert hits[0].title == "苗族古歌"
    assert "苗族古歌是苗族创世史诗" in " ".join(hit.text for hit in hits)
    assert hits[0].tier == "head"


def test_search_filters_and_tail(rag_env):
    hits = rag.search("民歌", top_k=4, tier="tail")
    assert hits and all(hit.tier == "tail" for hit in hits)
    assert hits[0].title == "皖西大别山民歌"
    music = rag.search("皖西大别山民歌", top_k=4, category="传统音乐")
    assert music and music[0].category == "传统音乐"


def test_context_has_citation_numbers(rag_env):
    hits = rag.search("剪纸", top_k=2)
    context = rag.build_context(hits)
    assert "[1]" in context and "中国剪纸" in context
    sources = rag.sources_payload(hits)
    assert sources[0]["index"] == 1 and sources[0]["title"]


def test_rag_api_status_and_search(rag_env, client: TestClient):
    status = client.get("/api/rag/status").json()
    assert status["ready"] is True and status["counts"]["chunks"] >= 5
    result = client.post("/api/rag/search", json={"query": "苗族古歌", "top_k": 3}).json()
    assert result["count"] >= 1
    assert result["hits"][0]["title"] == "苗族古歌"
    assert "[1]" in result["context"]


def test_rag_rebuild_requires_admin_token(rag_env, client: TestClient):
    assert client.post("/api/rag/rebuild").status_code == 401
    response = client.post("/api/rag/rebuild", headers={"X-Admin-Token": "test-token"})
    assert response.status_code == 200, response.text
    assert response.json()["chunks"]


def test_city_chat_injects_rag_context_and_sources(rag_env, client: TestClient, monkeypatch):
    from backend.app.routers import chat as chat_router

    captured: dict = {}

    async def fake_stream(city, knowledge, history, question, *, system_prompt=None, rag_context=None):
        captured["rag"] = rag_context or ""
        yield "苗族古歌是苗族的创世史诗 [1]。"

    monkeypatch.setattr(chat_router, "stream_reply", fake_stream)
    with client.stream(
        "POST", "/api/chat", json={"city_slug": "beijing", "message": "苗族古歌讲的是什么"}
    ) as response:
        assert response.status_code == 200, response.text
        body = "".join(response.iter_text())
    assert "event: sources" in body, body[:500]
    assert "苗族古歌" in captured["rag"]
    assert "[1]" in captured["rag"]


def test_dynasty_chat_injects_rag_context(rag_env, client: TestClient, monkeypatch):
    from backend.app.config import get_settings
    from backend.app.routers import dynasty as dynasty_router

    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
    get_settings.cache_clear()
    captured: dict = {}

    async def fake_stream(city, knowledge, history, question, *, system_prompt=None, rag_context=None):
        captured["rag"] = rag_context or ""
        yield "这一带也有古歌流传 [1]。"

    monkeypatch.setattr(dynasty_router, "stream_reply", fake_stream)
    with client.stream(
        "POST", "/api/dynasty/tang/chat", json={"message": "苗族古歌和长安有什么关系"}
    ) as response:
        assert response.status_code == 200, response.text
        body = "".join(response.iter_text())
    assert "event: sources" in body
    assert "苗族古歌" in captured["rag"]
