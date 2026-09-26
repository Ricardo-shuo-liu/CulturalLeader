"""行程工作台的浏览器验证（独立会话，避免与主验证共用过长生命周期）。

验证内容：全国城市图层档位与数量、工作台打开、时段推荐按钮、点位列表渲染、
单日优化（无 Key 时走估算）结果渲染，并输出截图 tests_artifacts/07_planner.png。
"""

from __future__ import annotations

import sys
import time
from pathlib import Path

from selenium import webdriver
from selenium.webdriver.firefox.options import Options
from selenium.webdriver.firefox.service import Service

BASE = "http://127.0.0.1:8000"
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "tests_artifacts"
GECKODRIVER = "/snap/bin/geckodriver"

CITY = "{name: '洛阳', province: '河南省', lng: 112.4540, lat: 34.6197}"

SET_STOPS = """
const id = arguments[0];
return fetch('/api/trips/' + id)
  .then((response) => response.json())
  .then((trip) => {
    const day = trip.days[0];
    day.city = { name: '洛阳', adcode: '410300', lng: 112.4540, lat: 34.6197 };
    day.start = { name: '洛阳站', lng: 112.4540, lat: 34.6197, time: '09:00' };
    day.stops = [
      { id: 'stop-a', name: '龙门石窟', lng: 112.4770, lat: 34.5550, dwell_minutes: 150, open_time: '08:00-18:00' },
      { id: 'stop-b', name: '白马寺', lng: 112.6070, lat: 34.7210, dwell_minutes: 90, open_time: '07:30-17:30' },
      { id: 'stop-c', name: '洛阳博物馆', lng: 112.4600, lat: 34.6380, dwell_minutes: 120, open_time: '09:00-17:00' },
    ];
    return fetch('/api/trips/' + id, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(trip),
    }).then((response) => response.status);
  });
"""


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    options = Options()
    options.add_argument("-headless")
    options.add_argument("--width=1400")
    options.add_argument("--height=900")
    driver = webdriver.Firefox(options=options, service=Service(executable_path=GECKODRIVER))
    failures: list[str] = []
    try:
        driver.get(f"{BASE}/")
        time.sleep(6)

        layer = driver.execute_script("return window.__cl.cityLayer()")
        print(f"城市图层：{layer.get('total')} 城 · 档位 {layer.get('level')} · 可见 {layer.get('visible')}")
        if (layer.get("total") or 0) < 300:
            failures.append(f"城市数量异常：{layer.get('total')}")
        if layer.get("level") not in {"national", "province"}:
            failures.append(f"城市显示档位异常：{layer.get('level')}")

        driver.execute_script(f"window.__cl.plannerOpen({CITY})")
        time.sleep(3)
        shell = {
            "open": driver.execute_script("return !document.getElementById('planner').classList.contains('hidden')"),
            "buckets": driver.execute_script("return document.querySelectorAll('#planner-buckets button').length"),
            "days": driver.execute_script("return document.querySelectorAll('.planner-day').length"),
            "mapkind": driver.execute_script("return (document.getElementById('planner-mapkind')||{}).textContent || ''"),
        }
        print(f"工作台：打开={shell['open']} 天数={shell['days']} 时段按钮={shell['buckets']} 地图={shell['mapkind']}")
        if not shell["open"]:
            failures.append("工作台没有打开")
        if shell["buckets"] < 5:
            failures.append("附近推荐的时段按钮缺失")

        trip_id = driver.execute_script("return document.getElementById('planner-trip').value || ''")
        if not trip_id:
            failures.append("没有创建行程")
        else:
            status = driver.execute_script(SET_STOPS, trip_id)
            if status != 200:
                failures.append(f"写入点位失败：HTTP {status}")
            time.sleep(1.2)
            driver.execute_script("return window.__cl.plannerReload()")
            time.sleep(2)

        rows = driver.execute_script("return document.querySelectorAll('.planner-stop').length")
        print(f"点位列表：{rows} 行")
        if rows < 3:
            failures.append(f"点位列表渲染异常：{rows} 行")

        driver.find_element("id", "planner-optimize").click()
        time.sleep(5)
        plan_text = driver.execute_script("return (document.getElementById('planner-plan')||{}).textContent || ''")
        first_line = plan_text.splitlines()[0] if plan_text else ""
        print(f"优化结果：{first_line}")
        if "求解器" not in plan_text:
            failures.append(f"优化结果没有渲染：{plan_text[:80]}")
        if ROOT.joinpath('LKH-3.0.14', 'LKH').exists() and '内置' in plan_text:
            failures.append(f"LKH 可用但回退到了内置算法：{first_line}")
        if "估算" not in plan_text and "LKH" not in plan_text:
            failures.append("优化结果缺少求解器信息")

        screenshot = OUT / "07_planner.png"
        driver.save_screenshot(str(screenshot))
        print(f"截图：{screenshot.relative_to(ROOT)}")

        # 清理本次验证创建的行程
        if trip_id:
            driver.execute_script(
                "return fetch('/api/trips/' + arguments[0], { method: 'DELETE' }).then((r) => r.status)",
                trip_id,
            )

        errors = [item for item in (driver.execute_script("return window.__errors || []") or []) if not item.startswith("console.warn")]
        print(f"页面错误：{len(errors)} 条")
        for item in errors[:5]:
            print("  -", item[:200])
        if errors:
            failures.append(f"页面存在 {len(errors)} 条错误")
    finally:
        driver.quit()

    if failures:
        print("\n未通过：")
        for item in failures:
            print(" -", item)
        return 1
    print("\n行程工作台验证通过")
    return 0


if __name__ == "__main__":
    sys.exit(main())
