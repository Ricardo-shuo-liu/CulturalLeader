"""行程规划相关测试：单日排序（估算模式）、TSPTW 实例、文件存储、错误契约、城市清单。"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend.app.main import app
from backend.app.services import trip_store
from backend.app.services.tencent_map import TencentMapClient, estimate_leg, haversine_km
from backend.app.services.trip_optimizer import build_service, build_tsptw, build_windows, optimize_day, parse_window


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as test_client:
        yield test_client


def make_day(stops: int = 4) -> dict:
    """西安市区附近的示例行程（用估算模式即可跑通）。"""
    points = [
        ("钟楼", 108.9398, 34.2610, "08:30-21:00", 60),
        ("大雁塔", 108.9640, 34.2186, "09:00-17:00", 90),
        ("陕西历史博物馆", 108.9535, 34.2360, "09:00-17:30", 120),
        ("回民街", 108.9400, 34.2650, "10:00-22:00", 60),
        ("城墙永宁门", 108.9470, 34.2530, "08:00-22:00", 90),
    ][:stops]
    return {
        "index": 1,
        "city": {"slug": "xian", "name": "西安", "lng": 108.9398, "lat": 34.3416},
        "mode": "taxi",
        "objective": "makespan",
        "day_start": "09:00",
        "day_end": "20:00",
        "start": {"name": "酒店", "lng": 108.9420, "lat": 34.2500, "time": "09:00"},
        "end": None,
        "stops": [
            {
                "id": f"stop-{index}",
                "poi_id": f"B0000{index}",
                "name": name,
                "lng": lng,
                "lat": lat,
                "dwell_minutes": dwell,
                "open_time": window,
                "fixed_time": None,
                "locked": False,
            }
            for index, (name, lng, lat, window, dwell) in enumerate(points, start=1)
        ],
        "plan": None,
    }


def test_parse_window_and_estimates():
    assert parse_window("08:30-18:00") == (510, 1080)
    assert parse_window("全天") is None
    leg = estimate_leg("walking", {"lng": 108.94, "lat": 34.25}, {"lng": 108.96, "lat": 34.22})
    assert leg["estimated"] is True
    assert leg["minutes"] > 0
    # 步行比打车慢
    taxi = estimate_leg("taxi", {"lng": 108.94, "lat": 34.25}, {"lng": 108.96, "lat": 34.22})
    assert leg["minutes"] > taxi["minutes"]
    assert haversine_km(108.94, 34.25, 108.96, 34.22) > 2


def test_tsptw_instance_structure():
    day = make_day(3)
    from backend.app.services.trip_optimizer import build_nodes

    nodes = build_nodes(day)
    windows = build_windows(nodes, day)
    service = build_service(nodes)
    matrix = [[0 if i == j else 600 for j in range(len(nodes))] for i in range(len(nodes))]
    text = build_tsptw(nodes, matrix, windows, service, makespan=True)
    assert "TYPE: TSPTW" in text
    assert "TIME_WINDOW_SECTION" in text
    assert "SERVICE_TIME_SECTION" in text
    assert "DEPOT_SECTION" in text
    assert text.rstrip().endswith("EOF")
    # 出发点：窗口从出发时刻开始（放宽到当天结束，避免 LKH 因返程弧不可行而失败）
    assert windows[0][0] == 9 * 3600
    assert windows[0][1] > windows[0][0]
    assert service[0] == 0


def test_windows_and_matrix_use_the_same_unit():
    """回归：时间窗曾用分钟、矩阵用秒，导致 LKH 判定实例不可行。"""
    from backend.app.services.trip_optimizer import build_nodes

    day = make_day(2)
    windows = build_windows(build_nodes(day), day)
    assert windows[0][0] == 9 * 3600, f"出发时间应为秒：{windows[0][0]}"
    assert windows[1][0] >= 9 * 3600 and windows[1][1] <= 24 * 3600


def test_optimizer_prefers_lkh_when_available():
    from backend.app.services.trip_optimizer import LKH_BIN

    plan = optimize_day(make_day(3), client=TencentMapClient())
    if LKH_BIN.exists():
        assert plan["solver"] == "LKH-3.0.14", f"LKH 可用时应使用 LKH，实际：{plan['solver']}"


def test_optimize_day_without_key_uses_estimation():
    day = make_day(4)
    plan = optimize_day(day, client=TencentMapClient())
    assert plan["order"], "应返回排序结果"
    assert len(plan["order"]) == 1 + 4, "出发点 + 4 个点位"
    assert plan["order"][0] == "酒店"
    assert plan["estimated"] is True, "无 Key 时必须标记为估算"
    assert plan["legs"] and all(leg["minutes"] >= 0 for leg in plan["legs"])
    assert plan["end_time"] and plan["total_minutes"] > 0
    # 时间窗靠后的点不应被排到最前造成大量等待
    assert plan["waiting_minutes"] < plan["total_minutes"]


def test_optimize_respects_locked_stop():
    day = make_day(4)
    day["stops"][1]["locked"] = True  # 锁住第二个点（大雁塔）
    plan = optimize_day(day, client=TencentMapClient(), keep_locked=True)
    assert plan["order"][2] == "stop-2", f"锁定点应保持在第 2 个位置：{plan['order']}"


def test_trip_store_roundtrip_and_corruption(tmp_path, monkeypatch):
    from backend.app.config import get_settings

    monkeypatch.setenv("TRIPS_DIR", str(tmp_path))
    get_settings.cache_clear()
    trip = trip_store.create_trip("测试行程", days=2, city={"name": "西安"})
    assert trip["id"].startswith("trip-")
    assert len(trip["days"]) == 2

    trip["days"][0]["stops"].append(
        {"id": "s1", "name": "钟楼", "lng": 108.94, "lat": 34.26, "dwell_minutes": 60}
    )
    trip_store.save_trip(trip)
    listed = trip_store.list_trips()
    assert listed and listed[0]["stops"] == 1
    assert trip_store.load_trip(trip["id"])["name"] == "测试行程"

    # 损坏文件应给出明确异常而不是崩溃
    (tmp_path / f"{trip['id']}.json").write_text("{ not json", encoding="utf-8")
    with pytest.raises(trip_store.TripNotFound):
        trip_store.load_trip(trip["id"])

    trip_store.delete_trip(trip["id"])
    with pytest.raises(trip_store.TripNotFound):
        trip_store.load_trip(trip["id"])
    get_settings.cache_clear()  # 恢复默认行程目录


def test_geo_cities_dataset():
    from backend.app.routers.geo import list_cities

    payload = list_cities()
    assert payload["count"] >= 300
    for city in payload["cities"][:50]:
        assert 73 <= city["lng"] <= 136
        assert 3 <= city["lat"] <= 54
        assert city["tier"] in {"municipality", "sar", "subprovincial", "capital", "prefecture"}


def test_config_and_map_status(client: TestClient):
    config = client.get("/api/config").json()
    assert config.get("provider") == "tencent" and "map_js_key" in config and "allow_estimate" in config
    status = client.get("/api/map/status").json()
    assert "quota_used_today" in status and "key_ok" in status
    assert status["provider"] == "腾讯位置服务"
    assert status["degraded"] is (not status["key_ok"])


def test_trip_api_crud_and_optimize(client: TestClient):
    created = client.post("/api/trips", json={"name": "西安一日", "days": 1, "city": {"name": "西安"}})
    assert created.status_code == 200
    trip = created.json()
    trip_id = trip["id"]

    trip["days"][0] = make_day(3)
    saved = client.put(f"/api/trips/{trip_id}", json=trip)
    assert saved.status_code == 200

    optimized = client.post(
        f"/api/trips/{trip_id}/days/1/optimize",
        json={"mode": "taxi", "objective": "makespan"},
    )
    assert optimized.status_code == 200, optimized.text
    plan = optimized.json()["plan"]
    assert plan["order"] and plan["legs"]
    assert plan["solver"] in {"LKH-3.0.14", "内置插入法+2-opt"}

    reloaded = client.get(f"/api/trips/{trip_id}").json()
    assert reloaded["days"][0]["plan"]["order"] == plan["order"]

    assert client.delete(f"/api/trips/{trip_id}").status_code == 200
    assert client.get(f"/api/trips/{trip_id}").status_code == 404


def test_poi_search_without_key_returns_config_hint(client: TestClient):
    response = client.get("/api/poi/search", params={"keyword": "咖啡"})
    assert response.status_code in (200, 409)
    if response.status_code == 409:
        assert response.json()["detail"]["code"] == "MAP_KEY_MISSING"
