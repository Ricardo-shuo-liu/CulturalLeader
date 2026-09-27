"""攻略导入（抄作业）测试：HTML 正文提取、规则解析、规整、生成计划块、接口契约。"""

from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient

from backend.app.main import app
from backend.app.services import flow_store, guide_store, importer


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
def isolated(tmp_path, monkeypatch):
    from backend.app.config import get_settings

    monkeypatch.setenv("IMPORTS_DIR", str(tmp_path / "imports"))
    monkeypatch.setenv("FLOWS_DIR", str(tmp_path / "flows"))
    monkeypatch.setenv("GUIDES_DIR", str(tmp_path / "guides"))
    monkeypatch.setenv("OPENAI_API_KEY", "")
    get_settings.cache_clear()
    # 生成攻略时会访问地图缓存表，先按 app 启动流程建表
    from backend.app.db import init_db

    init_db()
    yield tmp_path
    get_settings.cache_clear()


SAMPLE = """西安3日游攻略｜第一次来照着走就行
Day1 上午 钟楼 · 鼓楼 · 回民街
下午 西安城墙永宁门 → 大雁塔
Day2 兵马俑 09:00 玩3小时 / 华清宫 14:00 2小时
Day3 陕西历史博物馆 上午 2小时，晚上 大唐芙蓉园
"""


def test_html_to_text_prefers_article():
    raw = """<html><head><title>西安三日</title><style>.x{}</style></head>
    <body><nav>导航导航</nav>
    <article><p>第一天：钟楼、鼓楼。</p><p>第二天：兵马俑，建议 3 小时。</p></body></html>"""
    title, text = importer.html_to_text(raw)
    assert title == "西安三日"
    assert "钟楼" in text and "兵马俑" in text
    assert ".x{}" not in text, "style 内容要清掉"
    assert "导航导航" not in text, "article 之外的导航不该混进正文"


def test_rule_parse_splits_days_times_and_places():
    parsed = importer.rule_parse(SAMPLE)
    days = parsed["days"]
    assert [day["day"] for day in days] == [1, 2, 3]
    assert days[0]["city"].startswith("西安")
    names = [place["name"] for day in days for place in day["places"]]
    assert names[:3] == ["钟楼", "鼓楼", "回民街"]
    assert "兵马俑" in names and "大唐芙蓉园" in names
    # 时间词不再粘在名字上，且被识别成时间
    assert all("上午" not in name and "下午" not in name for name in names)
    first = days[0]["places"][0]
    assert first["time"] == "09:00"
    yingbai = next(place for day in days for place in day["places"] if place["name"] == "兵马俑")
    assert yingbai["time"] == "09:00" and yingbai["dwell_minutes"] == 180
    assert all(place["status"] == "pending" for day in days for place in day["places"])


def test_normalize_days_accepts_llm_output():
    days = importer.normalize_days(
        [{"day": 1, "city": "成都", "places": [{"name": "宽窄巷子", "time": "10:00", "dwell_minutes": 90}]}]
    )
    assert days[0]["city"] == "成都" and days[0]["places"][0]["name"] == "宽窄巷子"
    assert days[0]["places"][0]["status"] == "pending"


def test_import_store_roundtrip_and_corruption(isolated):
    record = importer.save_import({"title": "测试导入", "source": "text", "days": []})
    assert record["id"].startswith("imp-")
    listed = importer.list_imports()
    assert listed and listed[0]["title"] == "测试导入"
    path = importer.import_path(record["id"])
    path.write_text("{坏文件", encoding="utf-8")
    with pytest.raises(importer.ImportNotFound):
        importer.load_import(record["id"])


def test_commit_creates_blocks_and_guide(isolated):
    parsed = importer.rule_parse(SAMPLE)
    record = importer.save_import(
        {"title": "西安三日", "source": "text", "engine": "rule", "days": parsed["days"]}
    )
    result = importer.commit_import(record)
    assert len(result["flows"]) == 3
    flows = [flow_store.load_flow(item["id"]) for item in result["flows"]]
    assert all(flow["source"]["import_id"] == record["id"] for flow in flows)
    assert flows[0]["points"][0]["name"] == "钟楼"
    assert all(point["status"] == "pending" for point in flows[0]["points"])
    guide = guide_store.load_guide(result["guideId"])
    assert [item["day"] for item in guide["items"]] == [1, 2, 3]
    assert "（导入）" in guide["name"]
    # 待定位点位允许没有坐标，但重新优化要被拦住
    assert flows[0]["points"][0]["lng"] is None


def test_import_api_contract(client: TestClient, isolated):
    created = client.post("/api/imports", json={"text": SAMPLE, "engine": "rule"})
    assert created.status_code == 200, created.text
    record = created.json()["import"]
    assert record["engine"] == "rule" and len(record["days"]) == 3
    import_id = record["id"]

    assert client.get(f"/api/imports/{import_id}").status_code == 200
    assert client.get("/api/imports").json()["count"] >= 1

    parsed_again = client.post(f"/api/imports/{import_id}/parse", json={"engine": "rule"})
    assert parsed_again.status_code == 200

    manual = client.post(
        f"/api/imports/{import_id}/resolve",
        json={"day": 1, "names": ["钟楼"], "confirmed": {"钟楼": {"lng": 108.94, "lat": 34.26}}},
    )
    assert manual.status_code == 200
    place = manual.json()["import"]["days"][0]["places"][0]
    assert place["name"] == "钟楼" and place["status"] == "confirmed" and place["lng"] == pytest.approx(108.94)

    committed = client.post(f"/api/imports/{import_id}/commit")
    assert committed.status_code == 200, committed.text
    payload = committed.json()
    assert payload["flowIds"] and payload["guideId"].startswith("guide-")

    # 待定位点位存在时，单流程优化应给出明确提示而不是 500
    flow_id = payload["flowIds"][0]
    blocked = client.post(f"/api/flows/{flow_id}/optimize", json={})
    assert blocked.status_code == 400 and "待定位" in blocked.json()["detail"]

    assert client.delete(f"/api/imports/{import_id}").status_code == 200
    assert client.get(f"/api/imports/{import_id}").status_code == 404


def test_image_import_requires_key(client: TestClient, isolated):
    files = {"files": ("shot.png", b"\x89PNG\r\n\x1a\n0000", "image/png")}
    response = client.post("/api/imports/image", files=files)
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "IMPORT_KEY_MISSING"


def test_llm_failure_falls_back_to_rule(client: TestClient, isolated, monkeypatch):
    async def boom(*args, **kwargs):
        raise importer.ImportParseFailed("模型挂了")

    monkeypatch.setattr(importer, "llm_parse_text", boom)
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    from backend.app.config import get_settings

    get_settings.cache_clear()
    response = client.post("/api/imports", json={"text": SAMPLE, "engine": "auto"})
    assert response.status_code == 200, response.text
    record = response.json()["import"]
    assert record["engine"] == "rule" and record["degraded_reason"] == "llm_failed"
    get_settings.cache_clear()
