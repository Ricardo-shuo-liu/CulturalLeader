from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from backend.app.main import app

TOKEN = {"X-Admin-Token": "test-token"}


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as test_client:
        yield test_client


def test_health_reports_mock_mode(client: TestClient):
    response = client.get("/api/health")
    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "ok"
    assert payload["mock"] is True
    assert payload["city_count"] >= 5


def test_cities_list_seeded(client: TestClient):
    response = client.get("/api/cities")
    assert response.status_code == 200
    cities = response.json()
    slugs = {city["slug"] for city in cities}
    assert {"beijing", "shanghai", "guangzhou", "xian", "chengdu"} <= slugs
    for city in cities:
        assert 70 < city["lng"] < 140
        assert 15 < city["lat"] < 55
        assert city["landmark_key"]


def test_city_detail_and_404(client: TestClient):
    detail = client.get("/api/cities/beijing")
    assert detail.status_code == 200
    payload = detail.json()
    assert payload["narration"]
    assert len(payload["knowledge"]) >= 3
    assert client.get("/api/cities/nowhere").status_code == 404


def test_admin_requires_token(client: TestClient):
    assert client.get("/api/admin/cities").status_code == 401
    assert client.get("/api/admin/cities", headers={"X-Admin-Token": "wrong"}).status_code == 401
    assert client.get("/api/admin/cities", headers=TOKEN).status_code == 200


def test_admin_crud_and_knowledge(client: TestClient):
    created = client.post(
        "/api/admin/cities",
        headers=TOKEN,
        json={
            "slug": "hangzhou",
            "name": "杭州",
            "province": "浙江省",
            "lng": 120.1551,
            "lat": 30.2741,
            "tags": ["西湖"],
            "summary": "三面云山一面城",
            "narration": "欢迎来到杭州。",
        },
    )
    assert created.status_code == 200, created.text
    assert created.json()["slug"] == "hangzhou"

    duplicated = client.post(
        "/api/admin/cities",
        headers=TOKEN,
        json={"slug": "hangzhou", "name": "杭州", "lng": 120.1, "lat": 30.2},
    )
    assert duplicated.status_code == 409

    updated = client.put(
        "/api/admin/cities/hangzhou",
        headers=TOKEN,
        json={"summary": "更新后的简介", "tags": ["西湖", "龙井"]},
    )
    assert updated.status_code == 200
    assert updated.json()["summary"] == "更新后的简介"
    assert updated.json()["tags"] == ["西湖", "龙井"]

    knowledge = client.put(
        "/api/admin/cities/hangzhou/knowledge",
        headers=TOKEN,
        json=[{"question": "西湖怎么玩？", "answer": "沿湖骑行一圈约十五公里。"}],
    )
    assert knowledge.status_code == 200
    assert len(knowledge.json()["knowledge"]) == 1

    deleted = client.delete("/api/admin/cities/hangzhou", headers=TOKEN)
    assert deleted.status_code == 200
    assert client.get("/api/cities/hangzhou").status_code == 404


def test_chat_stream_events_in_mock_mode(client: TestClient):
    with client.stream(
        "POST",
        "/api/chat",
        json={"city_slug": "beijing", "message": "中轴线有多长？"},
    ) as response:
        assert response.status_code == 200
        body = "".join(response.iter_text())

    assert "event: meta" in body
    assert "event: token" in body
    assert "event: sentence" in body
    assert "event: done" in body
    assert "七点八公里" in body or "中轴线" in body
    assert "event: error" not in body


def test_chat_missing_city_returns_404(client: TestClient):
    response = client.post("/api/chat", json={"city_slug": "nowhere", "message": "你好"})
    assert response.status_code == 404


def test_speech_endpoints_degrade_to_501(client: TestClient):
    tts = client.post("/api/tts", json={"text": "你好"})
    assert tts.status_code == 501

    asr = client.post(
        "/api/asr",
        files={"file": ("speech.webm", b"fake-audio-bytes", "audio/webm")},
    )
    assert asr.status_code == 501


def test_route_solve_returns_optimal_tour(client: TestClient):
    response = client.post(
        "/api/route/solve",
        json={"slugs": ["beijing", "shanghai", "guangzhou", "xian", "chengdu"]},
    )
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["solver"] in {"LKH-3.0.14", "内置 2-opt"}
    assert sorted(payload["order"]) == sorted(["beijing", "shanghai", "guangzhou", "xian", "chengdu"])
    assert len(payload["legs"]) == 5
    assert 3000 < payload["distance_km"] < 5500
    if payload["solver"] == "LKH-3.0.14":
        # LKH 的 GEO 距离应与本地 haversine 一致（校验经纬度传参没有写反）
        assert payload["lkh_cost_km"] is not None
        assert abs(payload["lkh_cost_km"] - payload["distance_km"]) < 0.05 * payload["distance_km"]


def test_route_requires_two_cities(client: TestClient):
    assert client.post("/api/route/solve", json={"slugs": ["beijing"]}).status_code == 422
    assert client.post("/api/route/solve", json={"slugs": ["beijing", "beijing"]}).status_code == 400


def test_route_unknown_city(client: TestClient):
    response = client.post("/api/route/solve", json={"slugs": ["beijing", "nowhere"]})
    assert response.status_code == 404
