import json

from fastapi.testclient import TestClient

from backend.app.main import app


def _no_search(monkeypatch):
    async def fake_search(*args, **kwargs):
        return []

    monkeypatch.setattr("backend.app.services.atelier.pipeline.search_place", fake_search)


def test_stream_returns_sse_and_files(tmp_path, monkeypatch):
    monkeypatch.setattr("backend.app.services.atelier.storage.ATELIER_DIR", tmp_path)
    _no_search(monkeypatch)
    with TestClient(app) as client:
        with client.stream(
            "POST",
            "/api/atelier/stream",
            json={"prompt": "洛阳龙门石窟，黄昏", "seed": 51},
        ) as response:
            assert response.status_code == 200
            body = "".join(response.iter_text())
        assert "event: stage" in body
        assert "event: done" in body
        done = [line for line in body.splitlines() if line.startswith("data:") and "job_id" in line][-1]
        data = json.loads(done[5:])
        assert client.get(data["scene"]).status_code == 200
        assert client.get(data["zip"]).status_code == 200


def test_file_route_rejects_traversal():
    with TestClient(app) as client:
        assert client.get("/api/atelier/files/not-a-job/scene.png").status_code == 404
        assert client.get("/api/atelier/files/" + "0" * 32 + "/../app.db").status_code == 404


def test_prompt_length_validation():
    with TestClient(app) as client:
        assert client.post("/api/atelier/stream", json={"prompt": ""}).status_code == 422
        assert client.post("/api/atelier/stream", json={"prompt": "字" * 201}).status_code == 422


def test_rate_limiter_allows_six_per_minute():
    from backend.app.routers.atelier import RateLimiter

    limiter = RateLimiter(limit=6, window=60)
    assert all(limiter.allow("tester", now=0) for _ in range(6))
    assert limiter.allow("tester", now=0) is False
    assert limiter.allow("tester", now=61) is True
