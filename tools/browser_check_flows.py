"""端到端验收：双击城市 → 流程编辑（腾讯 GL 地图）→ 拖拽/缩放 → 优化 → 攻略 → 只读分享页。

运行前先启动服务（./run.sh），然后执行：
    python tools/browser_check_flows.py
产物：tests_artifacts/10_flow_editor.png · 11_guide.png · 12_share.png
"""

from __future__ import annotations

import json
import math
import re
import sys
import time
import urllib.request
from pathlib import Path

from selenium import webdriver
from selenium.webdriver.common.action_chains import ActionChains
from selenium.webdriver.firefox.options import Options
from selenium.webdriver.firefox.service import Service

BASE = "http://127.0.0.1:8000"
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "tests_artifacts"
GECKODRIVER = "/snap/bin/geckodriver"

# 允许出现的噪音（合成 PointerEvent 与自适应画质在软件渲染下的告警）
NOISE = (
    "setPointerCapture",
    "自适应",
    "自适应画质",
    "InvalidStateError",
)

STOPS = [
    {"name": "龙门石窟", "lng": 112.4770, "lat": 34.5550, "dwell_minutes": 150, "open_time": "08:00-18:00"},
    {"name": "白马寺", "lng": 112.6070, "lat": 34.7210, "dwell_minutes": 90, "open_time": "07:30-17:30"},
    {"name": "洛阳博物馆", "lng": 112.4600, "lat": 34.6380, "dwell_minutes": 120, "open_time": "09:00-17:00"},
    {"name": "应天门", "lng": 112.4420, "lat": 34.6740, "dwell_minutes": 60, "open_time": "09:00-21:00"},
]

SEED_FLOW = """
const city = { name: '洛阳', province: '河南省', adcode: '410300', lng: 112.4540, lat: 34.6197 };
const stops = arguments[0];
return fetch('/api/flows', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: '洛阳一日流程', city }),
})
  .then((response) => response.json())
  .then((flow) => {
    flow.start = { name: '洛阳站', lng: 112.4540, lat: 34.6197, time: '09:00' };
    flow.transport = 'taxi';
    flow.points = stops.map((stop, index) => ({
      id: 'pt-' + (index + 1),
      name: stop.name,
      lng: stop.lng,
      lat: stop.lat,
      dwell_minutes: stop.dwell_minutes,
      open_time: stop.open_time,
      fixed_time: null,
      locked: false,
    }));
    return fetch('/api/flows/' + flow.id, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(flow),
    })
      .then((response) => response.json())
      .then((saved) => saved.id);
  });
"""

DOUBLE_CLICK_CITY = """
const point = arguments[0];
const canvas = document.getElementById('stage');
const fire = (type, extra) =>
  canvas.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      pointerId: 1,
      pointerType: 'mouse',
      button: 0,
      buttons: type === 'pointerdown' ? 1 : 0,
      clientX: point.x,
      clientY: point.y,
      ...extra,
    }),
  );
fire('pointerdown', {});
fire('pointerup', {});
window.setTimeout(() => {
  fire('pointerdown', {});
  fire('pointerup', {});
}, 90);
return true;
"""


def geo_distance(a: dict, b: dict) -> float:
    return math.hypot(a["lng"] - b["lng"], a["lat"] - b["lat"])


def api_get(path: str) -> dict:
    with urllib.request.urlopen(f"{BASE}{path}", timeout=15) as response:  # noqa: S310
        return json.loads(response.read().decode("utf-8"))


def api_delete(path: str) -> int | None:
    request = urllib.request.Request(f"{BASE}{path}", method="DELETE")
    try:
        with urllib.request.urlopen(request, timeout=15) as response:  # noqa: S310
            return response.status
    except Exception:  # noqa: BLE001
        return None


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    options = Options()
    options.add_argument("-headless")
    options.add_argument("--width=1500")
    options.add_argument("--height=950")
    driver = webdriver.Firefox(options=options, service=Service(executable_path=GECKODRIVER))
    failures: list[str] = []
    created_flow_ids: set[str] = set()
    run_started_at = time.strftime("%Y-%m-%dT%H:%M:%S")
    try:
        flows_before = {item["id"] for item in api_get("/api/flows")["flows"]}
        guides_before = {item["id"] for item in api_get("/api/guides")["guides"]}
    except Exception as error:  # noqa: BLE001
        print("无法读取初始数据（清理步骤会跳过）：", error)
        flows_before, guides_before = set(), set()

    def check(name: str, condition: bool, detail: str = "") -> None:
        mark = "PASS" if condition else "FAIL"
        print(f"[{mark}] {name} → {detail}")
        if not condition:
            failures.append(name)

    try:
        # ── 1. 沙盘加载 ──
        driver.get(f"{BASE}/")
        time.sleep(7)
        layer = driver.execute_script("return window.__cl.cityLayer()")
        check("沙盘城市图层", (layer.get("total") or 0) >= 300, f"{layer.get('total')} 城 · {layer.get('level')}")

        # ── 2. 统一城市索引（重点城市带 3D 地标 + 地级市齐全）──
        index_info = driver.execute_script(
            """
            const list = window.__cl.cityIndex();
            return {
              total: list.length,
              landmarks: list.filter((city) => city.landmark_key).map((city) => city.shortName),
              luoyang: list.find((city) => city.shortName === '洛阳') || null,
            };
            """
        )
        check(
            "统一城市索引",
            index_info["total"] >= 300 and len(index_info["landmarks"]) >= 5 and index_info["luoyang"],
            f"{index_info['total']} 城 · 地标 {index_info['landmarks']}",
        )

        # ── 3. 单击重点城市标签 → 3D 地标与讲解（不能误进流程编辑）──
        driver.execute_script("document.querySelector('.city-label[data-slug=\"beijing\"]').click(); return true;")
        time.sleep(2.5)
        single = driver.execute_script("return { planner: window.__cl.planner().open, state: window.__cl.debug() };")
        check(
            "单击 3D 城市标签 → 打开地标与讲解",
            (not single["planner"]) and single["state"].get("city") == "beijing",
            f"city={single['state'].get('city')} · landmark={single['state'].get('landmark')}",
        )
        driver.execute_script("window.__cl.closeCity(); return true;")
        time.sleep(1.2)

        # ── 3a2. 导航按钮：抽屉打开时收起，关闭后再出现 ──
        driver.execute_script("document.getElementById('nav-toggle').click(); return true;")
        time.sleep(0.7)
        drawer_open = driver.execute_script("return document.getElementById('drawer').classList.contains('open')")
        button_open = driver.execute_script(
            "const cs = getComputedStyle(document.getElementById('nav-toggle')); return { opacity: cs.opacity, pointer: cs.pointerEvents }"
        )
        check("点击导航按钮打开抽屉", bool(drawer_open), f"drawer.open={drawer_open}")
        check(
            "抽屉打开后导航按钮收起",
            float(button_open["opacity"]) < 0.05 and button_open["pointer"] == "none",
            f"opacity={button_open['opacity']} pointer={button_open['pointer']}",
        )
        driver.execute_script("document.getElementById('drawer-close').click(); return true;")
        time.sleep(0.9)
        button_closed = driver.execute_script(
            "const cs = getComputedStyle(document.getElementById('nav-toggle')); return { opacity: cs.opacity, pointer: cs.pointerEvents }"
        )
        check(
            "关闭抽屉后导航按钮重新出现",
            float(button_closed["opacity"]) > 0.9 and button_closed["pointer"] != "none",
            f"opacity={button_closed['opacity']} pointer={button_closed['pointer']}",
        )

        # ── 3b. 重点城市（DOM 标签，例：西安）双击 → 也要能进流程编辑 ──
        driver.execute_script(
            """
            const label = document.querySelector('.city-label[data-slug="xian"]');
            if (!label) return false;
            label.click();
            window.setTimeout(() => label.click(), 90);
            return true;
            """
        )
        time.sleep(2.5)
        key_open = driver.execute_script("return window.__cl.planner().open")
        key_debug = driver.execute_script("return window.__cl.plannerDebug()")
        check(
            "双击 3D 城市标签（西安）也能进流程编辑",
            bool(key_open) and str(key_debug.get("city") or "").startswith("西安"),
            f"城市={key_debug.get('city')} · 引擎={key_debug.get('kind')}",
        )
        if key_debug.get("flowId"):
            created_flow_ids.add(key_debug["flowId"])
        driver.execute_script("document.getElementById('planner-back').click(); return true;")
        time.sleep(1.2)
        reopened = driver.execute_script("return window.__cl.planner().open")
        check("返回沙盘后流程编辑已关闭", not reopened, f"planner.open={reopened}")

        # ── 4. 双击地级市 → 打开流程编辑器 ──
        driver.execute_script("return window.__cl.flyProvince('河南')")
        time.sleep(3)
        target = driver.execute_script("return window.__cl.cityScreen('洛阳')")
        check("洛阳在省级视野中可见", bool(target), str(target))
        driver.execute_script(DOUBLE_CLICK_CITY, target)
        time.sleep(2.5)
        opened = driver.execute_script("return window.__cl.planner().open")
        check("双击洛阳进入流程编辑", bool(opened), f"planner.open={opened}")
        if not opened:
            raise SystemExit(1)

        debug = driver.execute_script("return window.__cl.plannerDebug()")
        check(
            "城内使用腾讯 GL 地图",
            debug.get("kind") == "tencent" and debug.get("hasTMap"),
            f"引擎={debug.get('kind')} · TMap={debug.get('hasTMap')} · 城市={debug.get('city')}",
        )

        # ── 4. 注入点位并重新渲染 ──
        flow_id = debug.get("flowId")
        if flow_id:
            created_flow_ids.add(flow_id)
        seeded = driver.execute_script(SEED_FLOW, STOPS)
        created_flow_ids.add(seeded)
        check("新建流程接口", bool(seeded), f"flow={seeded}")
        driver.execute_script("return window.__cl.plannerOpen({ name: '洛阳', province: '河南省', adcode: '410300', lng: 112.4540, lat: 34.6197 })")
        time.sleep(2)
        debug = driver.execute_script("return window.__cl.plannerDebug()")
        check("流程点位渲染", debug.get("points") == len(STOPS), f"{debug.get('points')} 个点位")
        driver.save_screenshot(str(OUT / "10_flow_editor.png"))

        map_metrics = driver.execute_script(
            """
            const container = document.getElementById('planner-map-canvas');
            const rect = container.getBoundingClientRect();
            return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, width: rect.width, height: rect.height };
            """
        )
        before_drag = driver.execute_script(
            """
            const map = window.__cl.plannerDebug();
            return { center: map.center, zoom: map.zoom };
            """
        )
        driver.execute_script(
            """
            const container = document.getElementById('planner-map-canvas');
            const rect = container.getBoundingClientRect();
            const start = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
            const fire = (type, x, y) =>
              container.dispatchEvent(
                new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: type === 'mouseup' ? 0 : 1 }),
              );
            fire('mousedown', start.x, start.y);
            for (let step = 1; step <= 10; step += 1) {
              fire('mousemove', start.x + step * 18, start.y + step * 6);
            }
            fire('mouseup', start.x + 180, start.y + 60);
            return true;
            """
        )
        time.sleep(1.5)
        after_drag = driver.execute_script("const map = window.__cl.plannerDebug(); return { center: map.center, zoom: map.zoom };")
        moved = geo_distance(before_drag["center"], after_drag["center"])
        deg_per_px = 360 / (256 * 2 ** before_drag["zoom"])
        expected = 180 * deg_per_px
        check(
            "地图可连续拖拽（底图随拖拽移动）",
            moved > expected * 0.5,
            f"中心位移 {moved:.4f}°（预期 ≈{expected:.4f}°）",
        )

        # 滚轮缩放：以地图中心为锚点，缩放后中心不应漂移
        before_zoom = driver.execute_script("return window.__cl.plannerDebug();")
        driver.execute_script(
            """
            const container = document.getElementById('planner-map-canvas');
            const rect = container.getBoundingClientRect();
            container.dispatchEvent(
              new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -240, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 }),
            );
            return true;
            """
        )
        time.sleep(1.5)
        after_zoom = driver.execute_script("return window.__cl.plannerDebug();")
        check(
            "滚轮缩放生效",
            (after_zoom.get("zoom") or 0) > (before_zoom.get("zoom") or 0),
            f"{before_zoom.get('zoom'):.2f} → {after_zoom.get('zoom'):.2f}",
        )
        drift = geo_distance(before_zoom["center"], after_zoom["center"])
        check("缩放以光标为锚点（点位不漂移）", drift < 0.01, f"中心漂移 {drift:.5f}°")

        # ── 5. 手动调序 + 重新优化（LKH TSPTW）──
        order_before = driver.execute_script(
            "return Array.from(document.querySelectorAll('#planner-stops .planner-stop-main strong')).map((node) => node.textContent)"
        )
        # 第一个点位的「↓」按钮：与下一个点交换顺序
        driver.execute_script(
            "document.querySelectorAll('#planner-stops .planner-stop-tools button')[1].click(); return true;"
        )
        time.sleep(2)
        order_after = driver.execute_script(
            "return Array.from(document.querySelectorAll('#planner-stops .planner-stop-main strong')).map((node) => node.textContent)"
        )
        check("手动调序生效", order_before != order_after, f"{order_before} → {order_after}")

        driver.execute_script("document.getElementById('planner-optimize').click(); return true;")
        for _ in range(60):
            plan_text = driver.execute_script("return document.getElementById('planner-plan').textContent")
            if "求解器" in plan_text:
                break
            time.sleep(1)
        plan_text = driver.execute_script("return document.getElementById('planner-plan').textContent")
        check("重新优化给出顺序与时间表", "求解器" in plan_text and "出发" in plan_text, plan_text.splitlines()[0] if plan_text else "")
        merged = driver.execute_script(
            "const flow = window.__cl.plannerDebug(); return { id: flow.flowId, kind: flow.kind };"
        )
        plan_api = driver.execute_script(
            "return fetch('/api/flows/' + arguments[0]).then((r) => r.json()).then((flow) => ({ order: flow.plan ? flow.plan.order : null, legs: flow.plan ? flow.plan.legs.length : 0, estimated: flow.plan ? flow.plan.estimated : null }));",
            merged["id"],
        )
        check(
            "优化结果落盘（顺序 + 分段通勤）",
            bool(plan_api.get("order")) and (plan_api.get("legs") or 0) >= len(STOPS),
            f"{plan_api.get('legs')} 段 · 估算={plan_api.get('estimated')}",
        )

        # ── 5a. 真实地图上必须能看到点位标记（此前用不存在的 TMap.Marker，标记全丢）──
        markers = driver.execute_script(
            """
            const nodes = Array.from(document.querySelectorAll('.map-marker'));
            const rect = document.getElementById('planner-map-canvas').getBoundingClientRect();
            return {
              count: nodes.length,
              visible: nodes.filter((node) => node.style.display !== 'none').length,
              labels: nodes.map((node) => node.querySelector('.planner-marker-label')?.textContent || ''),
              inside: nodes.every((node) => {
                const match = /translate\\((-?\\d+)px, (-?\\d+)px\\)/.exec(node.style.transform) || [0, 0, 0];
                const x = Number(match[1]);
                const y = Number(match[2]);
                return x > -60 && y > -60 && x < rect.width + 60 && y < rect.height + 60;
              }),
            };
            """
        )
        check(
            "真实地图上显示点位标记",
            markers["count"] == len(STOPS) + 1 and markers["visible"] == markers["count"],
            f"{markers['visible']}/{markers['count']} 个 · {markers['labels']}",
        )
        check("点位标记落在可视范围内", bool(markers["inside"]), f"inside={markers['inside']}")
        # 用真实鼠标点击标记（不是 JS .click()）：腾讯 GL 自身有一层 z-index:1000 的容器，
        # 浮层层级低于它时真实点击会全部落到地图上，这里必须用真实事件才能测出来
        marker_nodes = driver.find_elements("css selector", ".map-marker")
        ActionChains(driver).move_to_element(marker_nodes[1]).click().perform()
        time.sleep(1.2)
        detail = driver.execute_script("return document.getElementById('planner-detail').textContent || ''")
        check("真实点击地图标记 → 打开点位详情", "停留时长" in detail, detail.replace('\n', ' ')[:60])
        driver.execute_script("document.getElementById('detail-close')?.click(); return true;")
        time.sleep(0.5)

        # ── 5b. 在真实地图上点一下就能加点位 ──
        points_before = driver.execute_script("return window.__cl.plannerDebug().points")
        map_element = driver.find_element("id", "planner-map-canvas")
        box = map_element.size
        # Selenium 的 move_to_element_with_offset 以元素中心为原点
        ActionChains(driver).move_to_element_with_offset(
            map_element, int(box["width"] * 0.12), int(box["height"] * -0.22)
        ).click().perform()
        time.sleep(1.8)
        picker_open = driver.execute_script(
            "return !(document.querySelector('.map-picker')?.classList.contains('hidden') ?? true)"
        )
        picker_text = driver.execute_script(
            "return document.querySelector('.map-picker')?.textContent?.slice(0, 60) || ''"
        )
        check("点击地图弹出「在这里加一个点位」", bool(picker_open), picker_text.replace('\n', ' ')[:60])
        driver.execute_script("document.getElementById('map-picker-name').value = '地图取点测试'; return true;")
        ActionChains(driver).move_to_element(driver.find_element("id", "map-picker-add")).click().perform()
        time.sleep(2.5)
        points_after = driver.execute_script("return window.__cl.plannerDebug().points")
        active_flow_id = driver.execute_script("return window.__cl.plannerDebug().flowId")
        if active_flow_id:
            created_flow_ids.add(active_flow_id)
        last_point = driver.execute_script(
            "return fetch('/api/flows/' + arguments[0]).then((r) => r.json()).then((flow) => {"
            "  const last = flow.points[flow.points.length - 1];"
            "  return { name: last.name, lng: last.lng, lat: last.lat };});",
            active_flow_id,
        )
        added_from_map = (
            points_after == points_before + 1
            and last_point.get("name") == "地图取点测试"
            and 112.0 < float(last_point.get("lng") or 0) < 113.5
        )
        check(
            "地图取点加入流程并保存坐标",
            added_from_map,
            f"{points_before} → {points_after} 点 · 新点 {last_point}",
        )

        # ── 5c. 「取消」不能再弹出新的取点卡片 ──
        points_before_cancel = points_after
        map_element = driver.find_element("id", "planner-map-canvas")
        box = map_element.size
        ActionChains(driver).move_to_element_with_offset(
            map_element, int(box["width"] * -0.18), int(box["height"] * 0.16)
        ).click().perform()
        time.sleep(1.5)
        ActionChains(driver).move_to_element(driver.find_element("id", "map-picker-cancel")).click().perform()
        time.sleep(1.6)
        cancel_state = driver.execute_script(
            """
            const picker = document.querySelector('.map-picker');
            return {
              hidden: picker ? picker.classList.contains('hidden') : true,
              points: window.__cl.plannerDebug().points,
            };
            """
        )
        check(
            "取消后不再弹出新的取点卡片、也不加点位",
            bool(cancel_state["hidden"]) and cancel_state["points"] == points_before_cancel,
            f"弹窗隐藏={cancel_state['hidden']} · 点位数 {points_before_cancel} → {cancel_state['points']}",
        )

        # ── 5d. 起点：在地图上点选 + 用点位设起点 ──
        driver.execute_script("document.getElementById('planner-pick-start').click(); return true;")
        time.sleep(0.6)
        ActionChains(driver).move_to_element_with_offset(
            map_element, int(box["width"] * 0.3), int(box["height"] * 0.24)
        ).click().perform()
        time.sleep(2.2)
        start_after = driver.execute_script(
            "return fetch('/api/flows/' + arguments[0]).then((r) => r.json()).then((flow) => ({ start: flow.start, points: flow.points.length }));",
            active_flow_id,
        )
        start_info = driver.execute_script("return document.getElementById('planner-start-info').textContent")
        moved_start = start_after["start"] and abs(float(start_after["start"]["lng"]) - 112.454) > 0.005
        check(
            "在地图上点选起点（不新增点位）",
            bool(moved_start) and start_after["points"] == points_before_cancel,
            f"起点=({start_after['start']['lng']:.4f}, {start_after['start']['lat']:.4f}) · 点位数 {start_after['points']}",
        )
        check("侧栏显示当前出发点", "出发点：" in start_info, start_info[:64])

        driver.execute_script("document.querySelectorAll('#planner-stops .planner-stop-tools button')[2].click(); return true;")
        time.sleep(2)
        start_from_point = driver.execute_script(
            "return fetch('/api/flows/' + arguments[0]).then((r) => r.json()).then((flow) => flow.start);",
            active_flow_id,
        )
        check(
            "列表里把某个点位设为起点",
            start_from_point["name"] not in ("出发点", "") and start_from_point["lng"] is not None,
            f"起点={start_from_point.get('name')} ({start_from_point['lng']:.4f}, {start_from_point['lat']:.4f})",
        )

        # ── 5e. 重新优化后地图上要有连线与每段耗时标签 ──
        driver.execute_script("document.getElementById('planner-optimize').click(); return true;")
        # 点位变多后矩阵变大（受 QPS 限制可能十几秒），这里按接口里的腿数轮询，别用界面文字判断
        deadline = time.time() + 90
        plan_legs = 0
        while time.time() < deadline:
            plan_legs = driver.execute_script(
                "return fetch('/api/flows/' + arguments[0]).then((r) => r.json()).then((flow) => (flow.plan && flow.plan.legs ? flow.plan.legs.length : 0));",
                active_flow_id,
            )
            if plan_legs >= start_after["points"]:
                break
            time.sleep(2)
        driver.execute_script("window.__cl.plannerReload(); return true;")
        time.sleep(2.5)
        route_visual = driver.execute_script(
            """
            const legs = Array.from(document.querySelectorAll('.map-leg'));
            return {
              legs: legs.length,
              visible: legs.filter((node) => node.style.display !== 'none').length,
              text: legs.map((node) => node.textContent),
            };
            """
        )
        expect_legs = start_after["points"]
        route_state = driver.execute_script("return window.__cl.plannerDebug()")
        check(
            "真实地图上画出路线连线",
            bool(route_state.get("route")) and route_state.get("points", 0) >= 2,
            f"连线={route_state.get('route')} · 图上 {route_state.get('mapPoints')} 个点",
        )
        check(
            "真实地图上显示每段通勤时长/里程",
            route_visual["legs"] == expect_legs and route_visual["visible"] == route_visual["legs"],
            f"{route_visual['legs']} 段（应有 {expect_legs} 段）· 例：{route_visual['text'][0] if route_visual['text'] else '—'}",
        )
        driver.save_screenshot(str(OUT / "14_flow_route.png"))

        # ── 6. 另存副本 ──
        count_before = driver.execute_script("return fetch('/api/flows').then((r) => r.json()).then((p) => p.count)")
        driver.execute_script("document.getElementById('planner-copy').click(); return true;")
        time.sleep(2)
        count_after = driver.execute_script("return fetch('/api/flows').then((r) => r.json()).then((p) => p.count)")
        copy_id = driver.execute_script("return window.__cl.plannerDebug().flowId")
        if copy_id:
            created_flow_ids.add(copy_id)
        check("另存为副本", count_after == count_before + 1, f"{count_before} → {count_after}")

        # ── 7. 整体攻略 ──
        driver.execute_script("document.getElementById('planner-back').click(); return true;")
        time.sleep(1)
        driver.execute_script("document.getElementById('guide-open').click(); return true;")
        time.sleep(2.5)
        guide_open = driver.execute_script("return window.__cl.guide().open")
        check("导航 → 我的攻略", bool(guide_open), f"guide.open={guide_open}")
        # 新建一份空攻略，避免把验收用的天加到用户已有的攻略里
        driver.execute_script("document.getElementById('guide-new').click(); return true;")
        time.sleep(0.8)
        added = driver.execute_script(
            """
            const buttons = Array.from(document.querySelectorAll('#guide-library button'));
            if (buttons.length < 2) return buttons.length;
            buttons[0].click();
            return buttons.length;
            """
        )
        check("流程库可加入攻略", added >= 2, f"流程库 {added} 条")
        time.sleep(2.5)
        driver.execute_script(
            """
            const buttons = Array.from(document.querySelectorAll('#guide-library button'));
            if (buttons[1]) buttons[1].click();
            return true;
            """
        )
        time.sleep(3)
        totals = driver.execute_script("return document.getElementById('guide-totals').textContent")
        check(
            "攻略汇总总里程/总时长/逐日安排",
            "总里程" in totals and "总时长" in totals and "第 1 天" in totals,
            totals.splitlines()[0] if totals else "",
        )
        driver.save_screenshot(str(OUT / "11_guide.png"))

        # ── 8. 只读分享页 ──
        driver.execute_script("document.getElementById('guide-share').click(); return true;")
        time.sleep(2.5)
        toast = driver.execute_script("return document.getElementById('guide-toast').textContent")
        match = re.search(r"(http://\S+/share/\S+)", toast)
        check("生成只读分享链接", bool(match), toast[:120])
        if match:
            url = match.group(1).rstrip('）')
            driver.get(url)
            time.sleep(3)
            share_title = driver.execute_script("return document.getElementById('title').textContent")
            share_body = driver.execute_script("return document.getElementById('content').textContent")
            check(
                "分享页只读渲染",
                share_title and share_title != "只读分享" and "第 1 天" in share_body,
                f"{share_title} · {len(share_body)} 字",
            )
            driver.save_screenshot(str(OUT / "12_share.png"))

        # ── 9. 降级路径：无 JS Key 时的自建矢量底图也要能拖拽/缩放/选中 ──
        driver.get(f"{BASE}/?map=canvas")
        time.sleep(6)
        driver.execute_script("return window.__cl.flyProvince('河南')")
        time.sleep(3)
        target = driver.execute_script("return window.__cl.cityScreen('洛阳')")
        driver.execute_script(DOUBLE_CLICK_CITY, target)
        time.sleep(2.5)
        fallback = driver.execute_script("return window.__cl.plannerDebug()")
        check(
            "降级：无 Key 时使用自建矢量底图",
            fallback.get("kind") == "canvas" and (fallback.get("points") or 0) > 0,
            f"引擎={fallback.get('kind')} · {fallback.get('points')} 个点位",
        )
        before = fallback.get("center")
        driver.execute_script(
            """
            const canvas = document.querySelector('.planner-canvas');
            const rect = canvas.getBoundingClientRect();
            const cx = rect.left + rect.width / 2;
            const cy = rect.top + rect.height / 2;
            const fire = (type, x, y, buttons) =>
              canvas.dispatchEvent(
                new PointerEvent(type, {
                  bubbles: true, cancelable: true, pointerId: 2, pointerType: 'mouse',
                  button: 0, buttons, clientX: x, clientY: y, isPrimary: true,
                }),
              );
            fire('pointerdown', cx, cy, 1);
            for (let step = 1; step <= 8; step += 1) fire('pointermove', cx + step * 20, cy + step * 5, 1);
            fire('pointerup', cx + 160, cy + 40, 0);
            return true;
            """
        )
        time.sleep(0.8)
        after = driver.execute_script("return window.__cl.plannerDebug()")
        check(
            "降级：底图与点位同步拖拽",
            geo_distance(before, after.get("center")) > 0.01,
            f"中心位移 {geo_distance(before, after.get('center')):.4f}°",
        )
        driver.execute_script(
            """
            const canvas = document.querySelector('.planner-canvas');
            const rect = canvas.getBoundingClientRect();
            canvas.dispatchEvent(
              new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -240, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 }),
            );
            return true;
            """
        )
        time.sleep(0.8)
        zoomed = driver.execute_script("return window.__cl.plannerDebug()")
        check(
            "降级：滚轮缩放生效",
            (zoomed.get("zoom") or 0) > (after.get("zoom") or 0),
            f"{after.get('zoom'):.2f} → {zoomed.get('zoom'):.2f}",
        )
        scale_text = driver.execute_script("return document.querySelector('.map-scalebar-text').textContent")
        compass = driver.execute_script("return Boolean(document.querySelector('.map-compass'))")
        check("降级：比例尺与指北针可用", bool(scale_text) and compass, f"比例尺 {scale_text} · 指北针 {compass}")
        driver.save_screenshot(str(OUT / "13_canvas_fallback.png"))

        # ── 10. 控制台零错误 ──
        errors = driver.execute_script("return window.__errors || []")
        real = [item for item in errors if not any(noise in item for noise in NOISE)]
        check("浏览器控制台无实质错误", not real, f"{len(errors)} 条（其中噪音 {len(errors) - len(real)} 条）")
        for item in real[:8]:
            print("   ·", item[:160])
    finally:
        # 清理本次验收创建的数据（只删本次新增且属于验收城市的流程）
        try:
            removed_flows = 0
            if not flows_before:
                print("清理跳过：启动时没能读到流程清单，为避免误删用户数据不做任何删除")
            else:
                # 只删「启动时不存在的流程」——也就是本次验收新建的（含双击时自动建的空流程）；
                # 原有流程一律不碰，绝不按城市名批量删
                for item in api_get("/api/flows")["flows"]:
                    if item["id"] in flows_before:
                        continue
                    if item["id"] not in created_flow_ids and str(item.get("updated_at") or "") < run_started_at:
                        continue
                    if api_delete(f"/api/flows/{item['id']}"):
                        removed_flows += 1
                        print(f"  删除验收流程：{item.get('name')}（{item.get('city')}）")
            removed_guides = 0
            for item in api_get("/api/guides")["guides"]:
                if item["id"] not in guides_before:
                    if api_delete(f"/api/guides/{item['id']}"):
                        removed_guides += 1
            print(f"已清理验收数据：流程 {removed_flows} 条 · 攻略 {removed_guides} 份")
        except Exception as error:  # noqa: BLE001
            print("验收数据清理失败（可手动删除 data/flows、data/guides 里的测试数据）：", error)
        driver.quit()

    print()
    if failures:
        print(f"未通过 {len(failures)} 项：" + "、".join(failures))
        return 1
    print("全部通过")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
