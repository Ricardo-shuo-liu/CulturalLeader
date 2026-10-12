"""端到端验收：旅行电影（A3 轻量版）。

自行造一条流程 + 一份攻略（不走腾讯 Key，通勤时间用估算），
然后用 headless Firefox 真的录一段 WebM，落到 tests_artifacts/旅行电影.webm。

运行前先启动服务（./run.sh），然后执行：
    python tools/browser_check_movie.py

脚本会自己造一条「西安电影一日」流程与一份「西安一日电影」攻略，跑完自动删除。
"""

from __future__ import annotations

import base64
import json
import time
import urllib.request
from pathlib import Path

from selenium import webdriver
from selenium.webdriver.firefox.options import Options
from selenium.webdriver.firefox.service import Service

BASE = "http://127.0.0.1:8000"
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "tests_artifacts"
GECKODRIVER = "/snap/firefox/current/usr/lib/firefox/geckodriver"
FIREFOX_BINARY = "/snap/firefox/current/usr/lib/firefox/firefox"

NOISE = ("setPointerCapture", "自适应", "自适应画质", "InvalidStateError")

POINTS = [
    ("钟楼", 108.9402, 34.2596, "09:00-22:00", 60),
    ("西安城墙·永宁门", 108.9469, 34.2519, "08:00-22:00", 90),
    ("大雁塔", 108.9640, 34.2186, "09:00-17:00", 90),
    ("回民街", 108.9400, 34.2650, "10:00-22:00", 60),
]


def api(method: str, path: str, payload: dict | None = None) -> dict:
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    request = urllib.request.Request(
        f"{BASE}{path}",
        data=data,
        method=method,
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=60) as response:  # noqa: S310
        return json.loads(response.read().decode("utf-8"))


def build_guide() -> tuple[str, str]:
    flow = api(
        "POST",
        "/api/flows",
        {"city": {"name": "西安", "province": "陕西省", "adcode": "610100", "lng": 108.9398, "lat": 34.3416}, "name": "西安电影一日"},
    )
    flow["points"] = [
        {
            "id": f"pt-{index}",
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
    flow = api("PUT", f"/api/flows/{flow['id']}", flow)
    optimized = api("POST", f"/api/flows/{flow['id']}/optimize", {})
    flow = optimized.get("flow") or flow
    guide = api("POST", "/api/guides", {"name": "西安一日电影", "items": [{"flowId": flow["id"]}]})
    return flow["id"], guide["id"]


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    try:
        flow_id, guide_id = build_guide()
    except Exception as error:  # noqa: BLE001
        print(f"服务未启动或接口不可用（{error}）；请先执行 ./run.sh")
        return 2
    print(f"[INFO] 已准备流程 {flow_id} / 攻略 {guide_id}")

    options = Options()
    options.add_argument("-headless")
    options.add_argument("--width=1500")
    options.add_argument("--height=950")
    if Path(FIREFOX_BINARY).exists():
        options.binary_location = FIREFOX_BINARY
    driver = webdriver.Firefox(
        options=options,
        service=Service(executable_path=GECKODRIVER if Path(GECKODRIVER).exists() else "/snap/bin/geckodriver"),
    )
    driver.set_script_timeout(120)
    failures: list[str] = []

    def check(name: str, condition: bool, detail: str = "") -> None:
        mark = "PASS" if condition else "FAIL"
        print(f"[{mark}] {name} → {detail}")
        if not condition:
            failures.append(name)

    try:
        driver.get(f"{BASE}/?intro=0")
        for _ in range(40):
            if driver.execute_script("return Boolean(window.__cl)"):
                break
            time.sleep(0.5)
        time.sleep(2.5)
        # 模拟一次用户手势：浏览器要求手势后才允许 AudioContext 出声
        driver.find_element("tag name", "canvas").click()
        time.sleep(0.4)
        # 走真实入口：打开「我的攻略」，点「导出旅行电影」
        driver.execute_script("window.__cl.guideOpen(); return true;")
        for _ in range(20):
            opened = driver.execute_script("return window.__cl.guide().open")
            if opened:
                break
            time.sleep(0.4)
        time.sleep(2.0)
        current = driver.execute_script("return document.getElementById('guide-name').value")
        print(f"[INFO] 攻略面板已打开：{current}")

        caps = driver.execute_script(
            """
            const canvas = document.getElementById('stage');
            return {
              recorder: typeof window.MediaRecorder === 'function',
              capture: typeof canvas.captureStream === 'function',
              webm: window.MediaRecorder?.isTypeSupported?.('video/webm') || false,
            };
            """
        )
        if not (caps["recorder"] and caps["capture"] and caps["webm"]):
            print(f"[SKIP] 这个浏览器不支持录制：{caps}（正常浏览器里为人工验收项）")
            return 0

        driver.find_element("id", "guide-movie").click()
        started = None
        for _ in range(40):
            started = driver.execute_script("return window.__cl.movie()")
            if started and started.get("active"):
                break
            time.sleep(0.5)
        check(
            "电影：开始录制（脚本编译出天数与时长）",
            bool(started and started.get("active")) and started["script"]["days"] >= 1,
            f"script={started and started['script']}",
        )
        time.sleep(1.5)
        driver.save_screenshot(str(OUT / "28_movie_recording.png"))
        progress = driver.execute_script(
            "return { text: document.getElementById('movie-status').textContent, live: !document.getElementById('movie-live').classList.contains('hidden') }"
        )
        check("电影：录制中有进度与实时预览", progress["live"] and "拍摄" in progress["text"], progress["text"])

        # 等录制自然结束（1 天 ≈ 10 秒脚本时长）
        finished = None
        for _ in range(60):
            finished = driver.execute_script("return window.__cl.movie()")
            result_visible = driver.execute_script(
                "return !document.getElementById('movie-result').classList.contains('hidden')"
            )
            if finished and not finished.get("active") and result_visible:
                break
            time.sleep(1)
        result = driver.execute_script(
            """
            const video = document.getElementById('movie-video');
            return {
              visible: !document.getElementById('movie-result').classList.contains('hidden'),
              src: video.src || '',
              duration: video.duration || 0,
              status: document.getElementById('movie-status').textContent,
              download: document.getElementById('movie-download').getAttribute('download'),
            };
            """
        )
        check(
            "电影：录完出现预览与下载按钮",
            result["visible"] and result["src"].startswith("blob:") and "完成" in result["status"],
            f"{result['status']} · download={result['download']}",
        )
        driver.save_screenshot(str(OUT / "29_movie_result.png"))

        # 把 Blob 拉回本地落盘（人工验收/留档用）
        payload = driver.execute_async_script(
            """
            const done = arguments[arguments.length - 1];
            const video = document.getElementById('movie-video');
            fetch(video.src).then((response) => response.blob()).then((blob) => {
              const reader = new FileReader();
              reader.onloadend = () => done({ size: blob.size, type: blob.type, data: reader.result.split(',')[1] });
              reader.readAsDataURL(blob);
            }).catch((error) => done({ error: String(error) }));
            """
        )
        if payload.get("data"):
            target = OUT / "旅行电影.webm"
            target.write_bytes(base64.b64decode(payload["data"]))
            size = target.stat().st_size
            check(
                "电影：导出的 WebM 落盘且体积正常",
                size > 80_000 and payload["type"].startswith("video/webm"),
                f"{target.name} · {size // 1024} KB · {payload['type']}",
            )
        else:
            check("电影：导出的 WebM 落盘且体积正常", False, str(payload)[:120])

        errors = driver.execute_script(
            """
            const noise = arguments[0];
            return (window.__errors || []).filter((line) => !noise.some((item) => line.includes(item)));
            """,
            list(NOISE),
        )
        check("电影：录制全程无控制台错误", not errors, " / ".join(errors[:3])[:200])
    finally:
        driver.quit()

    # 清理验收数据（只删本脚本创建的那两条）
    try:
        for item in api("GET", "/api/guides").get("guides", []):
            if item.get("name") == "西安一日电影":
                api("DELETE", f"/api/guides/{item['id']}")
        for item in api("GET", "/api/flows").get("flows", []):
            if item.get("name") == "西安电影一日":
                api("DELETE", f"/api/flows/{item['id']}")
        print("[INFO] 已清理验收用的流程与攻略")
    except Exception as error:  # noqa: BLE001
        print(f"[WARN] 清理验收数据失败：{error}")

    print()
    if failures:
        print(f"{len(failures)} 项未通过：" + "、".join(failures))
        return 1
    print("旅行电影端到端全部通过")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
