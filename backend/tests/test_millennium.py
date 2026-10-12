"""千年模式：聚合端点的匹配规则、十城覆盖、空档措辞、anchor 提示词与分享二维码。"""

from __future__ import annotations

import re

import pytest
from fastapi.testclient import TestClient

from backend.app.data import dynasties as dynasty_data
from backend.app.data import millennium as millennium_data
from backend.app.main import app
from backend.app.services import flow_store, guide_builder, guide_store


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
def isolated_store(tmp_path, monkeypatch):
    from backend.app.config import get_settings

    monkeypatch.setenv("FLOWS_DIR", str(tmp_path / "flows"))
    monkeypatch.setenv("GUIDES_DIR", str(tmp_path / "guides"))
    monkeypatch.setenv("TENCENT_MAP_KEY", "")
    get_settings.cache_clear()
    yield tmp_path
    get_settings.cache_clear()


# 十座精选城市：名字 + 市中心坐标（与前端 cities 数据一致）
FEATURED = [
    ("西安", 108.94, 34.34),
    ("洛阳", 112.45, 34.62),
    ("北京", 116.40, 39.90),
    ("南京", 118.79, 32.06),
    ("成都", 104.07, 30.57),
    ("杭州", 120.15, 30.28),
    ("苏州", 120.62, 31.30),
    ("敦煌", 94.66, 40.14),
    ("泉州", 118.68, 24.87),
    ("开封", 114.30, 34.80),
]


def test_every_dynasty_has_millennium_meta():
    """每个时期都要有当朝人设与代表时刻；现代用实时（lighting 为空）。"""

    assert set(dynasty_data.MILLENNIUM_META) == set(dynasty_data.DYNASTIES)
    for key, meta in dynasty_data.MILLENNIUM_META.items():
        assert meta["persona"].strip(), f"{key} 缺人设"
        if key == "modern":
            assert meta["lighting"] is None
            continue
        assert re.fullmatch(r"\d{2}-\d{2}T\d{2}:\d{2}", meta["lighting"]), f"{key} 代表时刻格式不对"
        assert meta["lighting_label"]


@pytest.mark.parametrize("name,lng,lat", FEATURED)
def test_featured_cities_cover_almost_every_period(name: str, lng: float, lat: float):
    payload = millennium_data.build_payload(name, lng, lat)
    assert payload["featured"] is True
    assert payload["counts"]["total"] == 11
    assert payload["counts"]["matched"] >= 9, f"{name} 只有 {payload['counts']['matched']} 期有内容"
    for era in payload["eras"]:
        assert era["key"] and era["name"] and era["period"] and era["color"]
        assert era["lighting"] is None or re.fullmatch(r"\d{2}-\d{2}T\d{2}:\d{2}", era["lighting"])
        if era["matched"]:
            assert era["place"]["ancient"] and era["place"]["summary"]
            assert era["source"] in {"exact", "prefix", "near", "curated"}
            assert not era["empty"]
        else:
            assert era["empty"] and era["place"] is None and era["note"]


def test_xian_name_chain_from_data():
    """西安的改名时间线完全来自数据：内史 → 长安 → 大兴城 → 京兆府 → 西安府 → 西安。"""

    payload = millennium_data.build_payload("西安", 108.94, 34.34)
    chain = {era["key"]: (era["place"] or {}).get("ancient") for era in payload["eras"]}
    assert chain["qin"] == "内史"
    assert chain["han"] == "长安"
    assert chain["sui"] == "大兴城"
    assert chain["song"] == "京兆府"
    assert chain["ming"] == "西安府"
    assert chain["modern"] == "西安"
    sources = {era["key"]: era["source"] for era in payload["eras"]}
    assert sources["qin"] == "curated", "策展补注应优先于就近参考"
    assert sources["song"] == "exact"


def test_quanzhou_curated_gap_and_poems_attached():
    """泉州的秦汉以策展补注补齐；诗词只挂在有写作地的主地名上。"""

    payload = millennium_data.build_payload("泉州", 118.68, 24.87)
    qin = next(era for era in payload["eras"] if era["key"] == "qin")
    han = next(era for era in payload["eras"] if era["key"] == "han")
    assert qin["source"] == "curated" and qin["place"]["ancient"] == "闽中郡"
    assert han["source"] == "curated" and han["place"]["ancient"] == "冶县"
    assert qin["note"], "策展补注要带说明"

    tang = next(era for era in payload["eras"] if era["key"] == "tang")
    assert tang["matched"] and tang["place"]["ancient"] == "泉州"
    assert isinstance(tang["poems"], list)


def test_empty_eras_explain_why():
    """没有记载的时期要有可读的空档说明（疆域未及 / 暂无记载）。"""

    payload = millennium_data.build_payload("乌鲁木齐", 87.62, 43.83)
    empties = [era for era in payload["eras"] if era["empty"]]
    assert empties, "乌鲁木齐在多数时期应是空档"
    for era in empties:
        assert era["note"] in {"此朝疆域未及此地", "此朝此地暂无记载"}


def test_millennium_api_and_validation(client: TestClient):
    response = client.get("/api/dynasty/millennium", params={"name": "西安", "lng": 108.94, "lat": 34.34})
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["city"]["name"] == "西安"
    assert len(payload["eras"]) == 11

    # 参数越界 / 名单过短直接 422；list 路由不受影响（millennium 不会被当成朝代 key）
    assert client.get("/api/dynasty/millennium", params={"name": "西", "lng": 108.94, "lat": 34.34}).status_code == 422
    assert client.get("/api/dynasty/millennium", params={"name": "西安", "lng": 200.0, "lat": 34.34}).status_code == 422
    assert client.get("/api/dynasty/list").status_code == 200


def test_dynasty_chat_accepts_anchor(client: TestClient, monkeypatch):
    from backend.app.routers import dynasty as dynasty_router

    captured: dict = {}

    async def fake_stream(city, knowledge, history, question, *, system_prompt=None):
        captured["prompt"] = system_prompt or ""
        yield "这里是长安。"

    monkeypatch.setattr(dynasty_router, "stream_reply", fake_stream)
    with client.stream(
        "POST",
        "/api/dynasty/tang/chat",
        json={
            "message": "你这里晚上热闹吗？",
            "place_id": "changan",
            "anchor": "今西安，唐代称长安（此时我们锁定了这一个点看时间流动）",
        },
    ) as response:
        assert response.status_code == 200, response.text
        body = "".join(response.iter_text())
    assert "event: done" in body
    prompt = captured["prompt"]
    assert "今西安，唐代称长安" in prompt
    assert "锁定了同一个地点" in prompt
    assert "郎君" in prompt, "千年对话要带当朝本地人口吻"


def test_share_qr_png(client: TestClient, isolated_store):
    flow = flow_store.empty_flow({"name": "西安", "adcode": "610100", "lng": 108.94, "lat": 34.34}, "西安一日")
    flow["plan"] = {"legs": [{"minutes": 20, "distance_km": 6.0, "estimated": True}], "total_minutes": 300.0, "estimated": True}
    flow = flow_store.save_flow(flow)
    guide = guide_store.save_guide(guide_builder.build_guide("西安一日攻略", [{"flowId": flow["id"]}]))

    response = client.get(f"/api/guides/{guide['id']}/share-qr.png")
    assert response.status_code == 200, response.text
    assert response.headers["content-type"] == "image/png"
    assert response.content[:8] == b"\x89PNG\r\n\x1a\n"
    assert "/share/" in response.headers.get("x-share-url", "")
    assert client.get("/api/guides/not-exist/share-qr.png").status_code == 404
