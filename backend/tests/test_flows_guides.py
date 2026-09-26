"""城市流程与整体攻略测试：文件存储、Api CRUD、优化、攻略汇总、分享、迁移、静态图接口下线。"""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend.app.main import app
from backend.app.services import flow_store, guide_builder, guide_store


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
def isolated_store(tmp_path, monkeypatch):
    """把流程/攻略目录指到临时目录，并断网（清空 Key → 全部走估算）。"""
    from backend.app.config import get_settings

    monkeypatch.setenv("FLOWS_DIR", str(tmp_path / "flows"))
    monkeypatch.setenv("GUIDES_DIR", str(tmp_path / "guides"))
    monkeypatch.setenv("TENCENT_MAP_KEY", "")
    get_settings.cache_clear()
    yield tmp_path
    get_settings.cache_clear()


POINTS = [
    ("大雁塔", 108.9640, 34.2186, "09:00-17:00", 90),
    ("陕西历史博物馆", 108.9535, 34.2360, "09:00-17:30", 120),
    ("回民街", 108.9400, 34.2650, "10:00-22:00", 60),
]


def make_flow(name: str = "西安游玩流程", city_name: str = "西安") -> dict:
    flow = flow_store.empty_flow({"name": city_name, "province": "陕西省", "adcode": "610100", "lng": 108.9398, "lat": 34.3416}, name)
    flow["points"] = [
        {
            "id": f"pt-{index}",
            "poi_id": f"B0000{index}",
            "name": item[0],
            "lng": item[1],
            "lat": item[2],
            "open_time": item[3],
            "dwell_minutes": item[4],
            "fixed_time": None,
            "locked": False,
        }
        for index, item in enumerate(POINTS, start=1)
    ]
    return flow_store.save_flow(flow)


def test_flow_store_roundtrip_and_apply_plan(isolated_store):
    flow = make_flow()
    assert flow["id"].startswith("flow-")
    assert flow["start"]["lng"] == pytest.approx(108.9398)

    listed = flow_store.list_flows()
    assert listed and listed[0]["points"] == 3 and listed[0]["city"] == "西安"
    assert flow_store.list_flows("西安市")[0]["id"] == flow["id"], "城市名匹配应忽略“市”后缀"
    assert flow_store.list_flows("成都") == []

    # 优化结果写回顺序
    order = [flow["points"][2]["id"], flow["points"][0]["id"]]
    reordered = flow_store.apply_plan(flow, {"order": order, "legs": []})
    assert [point["id"] for point in reordered["points"]][:2] == order
    saved = flow_store.save_flow(reordered)
    assert [point["id"] for point in flow_store.load_flow(saved["id"])["points"]][:2] == order

    copy = flow_store.duplicate_flow(flow["id"], "副本流程")
    assert copy["id"] != flow["id"] and copy["name"] == "副本流程" and copy["plan"] is None

    flow_store.delete_flow(flow["id"])
    with pytest.raises(flow_store.FlowNotFound):
        flow_store.load_flow(flow["id"])

    # 损坏文件给出明确异常
    (Path(isolated_store / "flows") / f"{copy['id']}.json").write_text("{ 坏文件", encoding="utf-8")
    with pytest.raises(flow_store.FlowNotFound):
        flow_store.load_flow(copy["id"])


def test_flow_api_crud_optimize_and_duplicate(client: TestClient, isolated_store):
    created = client.post("/api/flows", json={"name": "成都流程", "city": {"name": "成都", "adcode": "510100", "lng": 104.06, "lat": 30.67}})
    assert created.status_code == 200, created.text
    flow = created.json()
    flow_id = flow["id"]

    flow["points"] = [
        {
            "id": f"pt-{index}",
            "name": item[0],
            "lng": item[1],
            "lat": item[2],
            "open_time": item[3],
            "dwell_minutes": item[4],
        }
        for index, item in enumerate(POINTS, start=1)
    ]
    saved = client.put(f"/api/flows/{flow_id}", json=flow)
    assert saved.status_code == 200, saved.text
    assert saved.json()["points"][0]["id"] == "pt-1"

    optimized = client.post(f"/api/flows/{flow_id}/optimize", json={"transport": "walking", "objective": "makespan"})
    assert optimized.status_code == 200, optimized.text
    plan = optimized.json()["plan"]
    assert plan["order"] and plan["legs"] and plan["solver"]
    assert plan["estimated"] is True, "无 Key 时必须标记为估算"
    assert optimized.json()["flow"]["transport"] == "walking"

    reloaded = client.get(f"/api/flows/{flow_id}").json()
    assert reloaded["plan"]["order"] == plan["order"]
    assert [point["name"] for point in reloaded["points"]] == [item["name"] for item in reloaded["points"]]

    copied = client.post(f"/api/flows/{flow_id}/duplicate", json={})
    assert copied.status_code == 200 and copied.json()["id"] != flow_id

    assert client.get("/api/flows", params={"city": "成都"}).json()["count"] >= 2
    assert client.delete(f"/api/flows/{flow_id}").status_code == 200
    assert client.get(f"/api/flows/{flow_id}").status_code == 404
    client.delete(f"/api/flows/{copied.json()['id']}")


def test_flow_optimize_without_points_is_rejected(client: TestClient, isolated_store):
    flow = client.post("/api/flows", json={"name": "空流程", "city": {"name": "洛阳"}}).json()
    response = client.post(f"/api/flows/{flow['id']}/optimize", json={})
    assert response.status_code == 400
    client.delete(f"/api/flows/{flow['id']}")


def test_guide_builder_totals_and_intercity_leg(isolated_store):
    xian = make_flow("西安一日", "西安")
    xian["plan"] = {
        "legs": [
            {"minutes": 20, "distance_km": 6.0, "estimated": True},
            {"minutes": 30, "distance_km": 9.0, "estimated": True},
        ],
        "total_minutes": 300.0,
        "estimated": True,
    }
    xian = flow_store.save_flow(xian)
    chengdu = flow_store.empty_flow({"name": "成都", "adcode": "510100", "lng": 104.06, "lat": 30.67}, "成都一日")
    chengdu["plan"] = {"legs": [{"minutes": 25, "distance_km": 8.0, "estimated": True}], "total_minutes": 240.0, "estimated": True}
    chengdu = flow_store.save_flow(chengdu)

    guide = guide_builder.build_guide("西安成都 2 日", [{"flowId": xian["id"]}, {"flowId": chengdu["id"]}])
    assert [item["day"] for item in guide["items"]] == [1, 2]
    assert guide["items"][0]["leg"] is None
    intercity = guide["items"][1]["leg"]
    assert intercity and intercity["estimated"] is True and intercity["distance_km"] > 500, "西安→成都约 600km"
    expected_distance = 6 + 9 + 8 + intercity["distance_km"]
    assert guide["totals"]["distance_km"] == pytest.approx(expected_distance, abs=0.02)
    assert guide["totals"]["minutes"] == pytest.approx(300 + 240 + intercity["minutes"], abs=0.2)

    saved = guide_store.save_guide(guide)
    expanded = guide_store.expand(guide_store.load_guide(saved["id"]))
    assert expanded["items"][0]["flow"]["city"] == "西安"
    assert guide_store.list_guides()[0]["cities"] == ["西安", "成都"]


def test_guide_api_share_and_readonly_page(client: TestClient, isolated_store):
    flow = make_flow("西安二日", "西安")
    flow["plan"] = {"legs": [{"minutes": 18, "distance_km": 5.0, "estimated": True}], "total_minutes": 260.0, "estimated": True}
    flow = flow_store.save_flow(flow)
    created = client.post("/api/guides", json={"name": "西安攻略", "items": [{"flowId": flow["id"], "notes": "第一天"}]})
    assert created.status_code == 200, created.text
    guide = created.json()
    assert guide["items"][0]["flow"]["city"] == "西安"
    assert guide["totals"]["minutes"] > 0

    shared = client.post(f"/api/guides/{guide['id']}/share")
    assert shared.status_code == 200
    token = shared.json()["token"]
    readonly = client.get(f"/api/guides/shared/{token}")
    assert readonly.status_code == 200 and readonly.json()["readonly"] is True
    assert readonly.json()["guide"]["name"] == "西安攻略"
    assert client.get("/api/guides/shared/not-a-token").status_code == 404
    assert client.get(f"/share/{token}").status_code == 200
    assert "text/html" in client.get(f"/share/{token}").headers.get("content-type", "")

    # 调整顺序 / 替换某城流程
    other = make_flow("西安三日", "西安")
    replaced = client.post(f"/api/guides/{guide['id']}/flows/{other['id']}", params={"day": 1})
    assert replaced.status_code == 200, replaced.text
    assert replaced.json()["items"][0]["flowId"] == other["id"]

    updated = client.put(f"/api/guides/{guide['id']}", json={"name": "改名攻略"})
    assert updated.json()["name"] == "改名攻略"
    assert client.delete(f"/api/guides/{guide['id']}").status_code == 200
    assert client.get(f"/api/guides/{guide['id']}").status_code == 404


def test_static_map_route_is_gone(client: TestClient):
    assert client.get("/api/geo/static-map", params={"center": "34,108"}).status_code == 404


def test_reverse_geocode_never_blocks_adding_points(client: TestClient, isolated_store):
    """地图取点：没有 Key 也要能加点位（降级为「地图取点 + 坐标」）。"""
    response = client.get("/api/poi/reverse", params={"lng": 112.4770, "lat": 34.5550})
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["lng"] == pytest.approx(112.4770) and payload["lat"] == pytest.approx(34.5550)
    assert payload["name"] == "地图取点" and payload["estimated"] is True
    assert "34.55500" in payload["address"]


def test_reverse_geocode_uses_map_service_when_available(monkeypatch):
    """有 Key 时用腾讯逆地理编码，把最近 POI/地址作为点位名字。"""
    from backend.app.services.tencent_map import TencentMapClient

    client = TencentMapClient()
    monkeypatch.setattr(
        client,
        "request",
        lambda path, params, use_cache=True: {
            "status": 0,
            "result": {
                "address": "陕西省西安市碑林区",
                "formatted_addresses": {"recommend": "西安市碑林区永宁门"},
                "address_component": {"city": "西安市", "district": "碑林区"},
                "ad_info": {"adcode": 610103},
                "pois": [{"id": "B0FFF", "title": "永宁门"}],
            },
        },
    )
    info = client.reverse_geocode(108.947, 34.253)
    assert info["name"] == "永宁门"
    assert info["poi_id"] == "B0FFF"
    assert info["city"] == "西安市" and info["adcode"] == "610103"
    assert info["estimated"] is False


def _load_migrate_module():
    path = Path(__file__).resolve().parents[2] / "tools" / "migrate_trips.py"
    spec = importlib.util.spec_from_file_location("cl_migrate_trips", path)
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)
    return module


def test_migration_is_idempotent(tmp_path, monkeypatch):
    from backend.app.config import get_settings

    monkeypatch.setenv("FLOWS_DIR", str(tmp_path / "flows"))
    monkeypatch.setenv("GUIDES_DIR", str(tmp_path / "guides"))
    monkeypatch.setenv("TENCENT_MAP_KEY", "")
    get_settings.cache_clear()

    trips = tmp_path / "trips"
    trips.mkdir()
    trip = {
        "id": "trip-test-0001",
        "name": "西安·成都 2 日",
        "created_at": "2026-09-26T10:00:00",
        "days": [
            {
                "index": 1,
                "city": {"name": "西安", "adcode": "610100", "lng": 108.9398, "lat": 34.3416},
                "mode": "taxi",
                "day_start": "09:00",
                "day_end": "20:00",
                "start": {"name": "酒店", "lng": 108.94, "lat": 34.25, "time": "09:00"},
                "stops": [
                    {"id": "s1", "name": "钟楼", "lng": 108.9398, "lat": 34.2610, "dwell_minutes": 60},
                    {"id": "s2", "name": "大雁塔", "lng": 108.9640, "lat": 34.2186, "dwell_minutes": 90},
                ],
                "plan": {"order": ["s2", "s1"], "legs": [{"minutes": 20, "distance_km": 5.0, "estimated": True}]},
            },
            {
                "index": 2,
                "city": {"name": "成都", "adcode": "510100", "lng": 104.06, "lat": 30.67},
                "mode": "taxi",
                "stops": [{"id": "s3", "name": "宽窄巷子", "lng": 104.05, "lat": 30.68, "dwell_minutes": 90}],
                "plan": {"order": ["s3"], "legs": []},
            },
            {"index": 3, "city": {}, "stops": []},
        ],
    }
    (trips / "trip-test-0001.json").write_text(json.dumps(trip, ensure_ascii=False), encoding="utf-8")

    module = _load_migrate_module()
    first = module.migrate(trips_dir=trips)
    assert first == {"trips": 1, "flows": 2, "guides": 1, "skipped": 0}
    assert (trips / "trip-test-0001.json").exists(), "默认保留原文件"

    flow_ids = sorted(flow["id"] for flow in flow_store.list_flows())
    flows_dir = Path(get_settings().flows_dir)
    snapshot = {path.name: path.read_text(encoding="utf-8") for path in sorted(flows_dir.glob("flow-*.json"))}
    second = module.migrate(trips_dir=trips)
    assert second["flows"] == 2 and second["guides"] == 1
    assert sorted(flow["id"] for flow in flow_store.list_flows()) == flow_ids, "重复迁移不应产生新流程"
    for name, text in snapshot.items():
        current = json.loads((flows_dir / name).read_text(encoding="utf-8"))
        assert current["id"] == json.loads(text)["id"], "重复迁移应覆盖同一批流程文件"

    guide = guide_store.list_guides()[0]
    assert guide["cities"] == ["西安", "成都"] and guide["days"] == 2

    migrated = flow_store.list_flows("西安")[0]
    points = flow_store.load_flow(migrated["id"])["points"]
    assert [point["name"] for point in points] == ["大雁塔", "钟楼"], "应按原优化顺序重排点位"
    get_settings.cache_clear()
