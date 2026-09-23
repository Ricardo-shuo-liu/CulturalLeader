"""用系统自带 Firefox + geckodriver 做真实渲染验证：
确认 WebGL 启动、不同时刻明暗差异、点击城市后幕布确实拉开、控制台无着色器错误。
"""

from __future__ import annotations

import json
import statistics
import sys
import time
from pathlib import Path

from PIL import Image
from selenium import webdriver
from selenium.webdriver.common.action_chains import ActionChains
from selenium.webdriver.firefox.options import Options
from selenium.webdriver.firefox.service import Service

BASE = "http://127.0.0.1:8000"
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "tests_artifacts"
GECKODRIVER = "/snap/bin/geckodriver"


HIDE_SCRIPT = """
['avatar-canvas','timeboard','mute-btn','speech-bubble','labels','panel','toast'].forEach((id) => {
  const element = document.getElementById(id);
  if (element) element.style.visibility = 'hidden';
});
"""


def clean_shot(driver, path: Path) -> None:
    """隐藏界面元素后截图，只保留舞台画面。"""
    driver.execute_script(HIDE_SCRIPT)
    import time as _time

    _time.sleep(0.4)
    driver.save_screenshot(str(path))
    driver.execute_script(
        "['avatar-canvas','timeboard','mute-btn','speech-bubble','labels','panel','toast']"
        ".forEach((id) => { const e = document.getElementById(id); if (e) e.style.visibility = 'visible'; });"
    )


def make_driver() -> webdriver.Firefox:
    options = Options()
    options.add_argument("-headless")
    options.add_argument("--width=1600")
    options.add_argument("--height=900")
    options.set_preference("webgl.disabled", False)
    options.set_preference("webgl.force-enabled", True)
    service = Service(executable_path=GECKODRIVER)
    return webdriver.Firefox(options=options, service=service)


def brightness(path: Path) -> float:
    image = Image.open(path).convert("L").resize((160, 90))
    return statistics.fmean(image.getdata())


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    driver = make_driver()
    failures: list[str] = []
    errors: list[str] = []
    route_result = None
    route_active = False
    route_state = {}
    camera_before = {"position": [0, 0, 0], "target": [0, 0, 0]}
    camera_rotated = {"position": [0, 0, 0], "target": [0, 0, 0]}
    camera_zoomed = {"position": [0, 0, 0], "target": [0, 0, 0]}
    labels = 0
    gl = None
    panel_open = False
    debug: dict = {}
    try:
        driver.set_window_size(1600, 900)

        driver.get(f"{BASE}/?t=06:30")
        time.sleep(7)
        labels = driver.execute_script("return document.querySelectorAll('.city-label').length") or 0
        gl = driver.execute_script(
            "const c=document.querySelector('#stage');"
            "const g=c.getContext('webgl2')||c.getContext('webgl');"
            "return g? g.getParameter(g.VERSION): null;"
        )
        east = driver.execute_script("return window.__cl.screen(118.8, 32.1)")
        west = driver.execute_script("return window.__cl.screen(87.6, 43.8)")
        (OUT / "points.json").write_text(
            json.dumps({"east": east, "west": west}, ensure_ascii=False), encoding="utf-8"
        )
        dawn = OUT / "01_dawn_0630.png"
        clean_shot(driver, dawn)

        driver.get(f"{BASE}/?t=23:00")
        time.sleep(6)
        night = OUT / "02_night_2300.png"
        clean_shot(driver, night)

        driver.get(f"{BASE}/?t=12:00")
        time.sleep(6)
        noon = OUT / "03_noon_1200.png"
        clean_shot(driver, noon)

        # 相机控制：拖拽应旋转视角，滚轮应缩放
        camera_before = driver.execute_script("return window.__cl.camera()")
        canvas = driver.find_element("id", "stage")
        ActionChains(driver).move_to_element(canvas).click_and_hold().move_by_offset(140, 26).release().perform()
        time.sleep(1.4)
        camera_rotated = driver.execute_script("return window.__cl.camera()")
        ActionChains(driver).move_to_element(canvas).scroll_by_amount(0, -260).perform()
        time.sleep(1.4)
        camera_zoomed = driver.execute_script("return window.__cl.camera()")

        # 极端视角：拉到最远 + 压到最低角，检查是否露出纯黑
        canvas = driver.find_element("id", "stage")
        for _ in range(7):
            ActionChains(driver).move_to_element(canvas).scroll_by_amount(0, 320).perform()
            time.sleep(0.3)
        ActionChains(driver).move_to_element(canvas).click_and_hold().move_by_offset(0, -300).release().perform()
        time.sleep(1.6)
        extreme = OUT / "05_extreme_view.png"
        clean_shot(driver, extreme)

        driver.execute_script("window.__cl.openCity('shanghai')")
        time.sleep(5)
        debug = driver.execute_script("return window.__cl.debug()") or {}
        panel_open = bool(
            driver.execute_script("return document.getElementById('panel').classList.contains('show')")
        )
        bubble = driver.execute_script("return document.getElementById('speech-bubble').textContent") or ""
        opened = OUT / "04_shanghai_opened.png"
        clean_shot(driver, opened)

        # 路线规划：先回到初始视角，再进入模式 → 点五个城市标签 → LKH 求解 → 截图
        driver.get(f"{BASE}/?t=12:00")
        time.sleep(5)
        driver.find_element("id", "route-btn").click()
        time.sleep(0.6)
        route_active = driver.execute_script("return window.__cl.route().active")
        for slug in ("beijing", "shanghai", "guangzhou", "xian", "chengdu"):
            driver.find_element("css selector", f'.city-label[data-slug="{slug}"]').click()
            time.sleep(0.2)
        driver.set_script_timeout(60)
        route_result = driver.execute_async_script(
            "const done = arguments[arguments.length - 1];"
            "window.__cl.routeSolve().then((value) => done(value));"
        )
        route_state = driver.execute_script("return window.__cl.route()")
        time.sleep(1.2)
        route_shot = OUT / "06_route.png"
        clean_shot(driver, route_shot)

        errors = driver.execute_script("return window.__errors || []") or []
    finally:
        driver.quit()

    dawn_luma = brightness(dawn)
    night_luma = brightness(night)
    noon_luma = brightness(noon)
    opened_luma = brightness(opened)

    print(f"城市标签：{labels} 个")
    print(f"WebGL：{gl}")
    print(f"幕布状态：{debug}")
    print(f"面板展开：{panel_open}，讲解气泡字数：{len(bubble)}")
    print(f"亮度：黎明 {dawn_luma:.1f} / 正午 {noon_luma:.1f} / 夜间 {night_luma:.1f} / 拉开后 {opened_luma:.1f}")

    if labels != 5:
        failures.append(f"城市标签应为 5 个，实际 {labels}")
    if not gl:
        failures.append("WebGL 上下文未创建")
    if not panel_open:
        failures.append("点击城市后面板未展开")
    if debug.get("landmark", 0) < 0.9:
        failures.append(f"地标未升起：{debug.get('landmark')}")
    if debug.get("open", 0) < 0.9:
        failures.append(f"幕布未拉开：open={debug.get('open')}")
    if debug.get("city") != "shanghai":
        failures.append(f"当前城市错误：{debug.get('city')}")
    if len(bubble) < 10:
        failures.append("讲解气泡没有内容")
    if min(dawn_luma, noon_luma, night_luma) < 8:
        failures.append(f"画面过暗，可能没有渲染出舞台：{min(dawn_luma, noon_luma, night_luma):.1f}")
    if camera_before["position"] == camera_rotated["position"]:
        failures.append("拖拽没有改变相机位置（视角不可调节）")
    distance_before = sum((a - b) ** 2 for a, b in zip(camera_before["position"], camera_before["target"])) ** 0.5
    distance_after = sum((a - b) ** 2 for a, b in zip(camera_zoomed["position"], camera_zoomed["target"])) ** 0.5
    if abs(distance_after - distance_before) < 0.2:
        failures.append(f"滚轮没有改变相机距离：{distance_before:.2f} → {distance_after:.2f}")
    print(f"相机控制：拖拽 {'生效' if camera_before['position'] != camera_rotated['position'] else '无效'}"
          f"，缩放 {distance_before:.2f} → {distance_after:.2f}")

    if route_result:
        print(f"路线求解：{route_result['solver']} | {len(route_result['order'])} 城 | {route_result['distance_km']} 公里 | {route_result['elapsed_ms']} ms")
        print(f"路线顺序：{' → '.join(route_result['names'])}")
    if not route_active:
        failures.append("点击「路线规划」后没有进入路线模式")
    if route_state.get("selected") and not route_result:
        failures.append("路线求解没有返回结果")
    elif route_result["solver"] != "LKH-3.0.14":
        failures.append(f"未使用 LKH 求解：{route_result['solver']}")
    elif not 3000 < route_result["distance_km"] < 5500:
        failures.append(f"路线里程异常：{route_result['distance_km']}")
    if len(route_state.get("selected", [])) != 5:
        failures.append(f"选中城市数量异常：{route_state.get('selected')}")

    severe = [item for item in errors if not item.startswith("console.warn")]
    print(f"页面记录条目 {len(errors)} 条，其中错误 {len(severe)} 条")
    for item in errors[:12]:
        print(f"  {item[:240]}")
    if severe:
        failures.append(f"页面存在 {len(severe)} 条错误")

    if failures:
        print("\n未通过：")
        for item in failures:
            print(f" - {item}")
        return 1
    print("\n浏览器验证通过")
    return 0


if __name__ == "__main__":
    sys.exit(main())
