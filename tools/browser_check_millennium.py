"""端到端验收：开场 30 秒 + 一块土地的千年（+ 旅行电影入口）。

运行前先启动服务（./run.sh），然后执行：
    python tools/browser_check_millennium.py
产物：tests_artifacts/24_intro.png · 25_millennium_tang.png · 26_millennium_qin.png · 27_millennium_strata.png
"""

from __future__ import annotations

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

NOISE = ("setPointerCapture", "自适应", "自适应画质", "InvalidStateError", "MediaRecorder")


def api_json(path: str) -> dict:
    with urllib.request.urlopen(f"{BASE}{path}", timeout=15) as response:  # noqa: S310
        return json.loads(response.read().decode("utf-8"))


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    payload = api_json("/api/dynasty/millennium?name=%E8%A5%BF%E5%AE%89&lng=108.94&lat=34.34")
    matches = payload["counts"]["matched"]
    print(f"[INFO] 西安千年数据：{matches}/11 期有内容（featured={payload['featured']}）")
    if matches < 9:
        print("千年接口数据不足，先检查后端；服务未启动时请先执行 ./run.sh")
        return 2

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
    failures: list[str] = []

    def check(name: str, condition: bool, detail: str = "") -> None:
        mark = "PASS" if condition else "FAIL"
        print(f"[{mark}] {name} → {detail}")
        if not condition:
            failures.append(name)

    try:
        # ── 1. 开场：每次加载都播、2 秒后可跳过、可以重播 ──
        driver.get(f"{BASE}/")
        for _ in range(60):
            if driver.execute_script("return Boolean(window.__cl)"):
                break
            time.sleep(0.5)
        time.sleep(1.2)
        intro = driver.execute_script("return window.__cl.intro()")
        overlay = driver.execute_script(
            "return { hidden: document.getElementById('intro').classList.contains('hidden'), body: document.body.classList.contains('intro-mode') }"
        )
        check("开场：打开即播（相机在运镜、界面退场）", bool(intro.get("running")) and overlay["body"], f"running={intro.get('running')}")
        time.sleep(2.4)
        skip_visible = driver.execute_script(
            "return !document.getElementById('intro-skip').classList.contains('hidden')"
        )
        check("开场：2 秒后出现「跳过」", bool(skip_visible), f"skip 可见={skip_visible}")
        driver.save_screenshot(str(OUT / "24_intro.png"))
        driver.execute_script("window.__cl.introSkip(); return true;")
        time.sleep(0.6)
        after_skip = driver.execute_script("return { intro: window.__cl.intro(), debug: window.__cl.debug() }")
        check(
            "开场：跳过后回到实时日照、镜头交还用户",
            (not after_skip["intro"]["running"]) and after_skip["debug"]["time"]["live"] is True,
            f"live={after_skip['debug']['time']['live']}",
        )
        driver.execute_script("window.__cl.introReplay(); return true;")
        time.sleep(0.8)
        replay = driver.execute_script("return window.__cl.intro()")
        check("开场：抽屉「重播开场」可用", bool(replay.get("running")), f"running={replay.get('running')}")
        driver.execute_script("window.__cl.introSkip(); return true;")
        time.sleep(0.5)

        # ── 2. 千年：从城市卡进入（真实按钮）──
        driver.execute_script(
            """
            const card = document.getElementById('city-card');
            card.__city = { name: '西安', lng: 108.94, lat: 34.34 };
            card.classList.remove('hidden');
            document.getElementById('city-card-millennium').click();
            return true;
            """
        )
        for _ in range(40):
            state = driver.execute_script("return window.__cl.millennium()")
            if state and state.get("active"):
                break
            time.sleep(0.4)
        time.sleep(1.8)
        state = driver.execute_script("return window.__cl.millennium()")
        debug = driver.execute_script("return window.__cl.debug()")
        check(
            "千年：城市卡「一块土地的千年」进入并锁定西安",
            state and state["city"] == "西安" and state["matched"] >= 9,
            f"city={state and state['city']} · matched={state and state['matched']}/11",
        )
        check(
            "千年：默认从唐开始，古名是长安",
            state["era"] == "tang" and state["ancient"] == "长安",
            f"era={state['era']} · ancient={state['ancient']} · chain={ ' → '.join(state['chain'][:5]) }",
        )
        check(
            "千年：疆域重建为唐代示意疆域、现代图层收起",
            debug["terrain"]["rings"] == 1
            and debug["terrain"]["points"] == 67
            and (not debug["layers"]["cityPoints"])
            and debug["layers"]["cityLayerOpacity"] < 0.05,
            f"{debug['terrain']['rings']} 环 / {debug['terrain']['points']} 点",
        )
        check(
            "千年：日照切到唐的代表时刻（夏至黄昏）",
            debug["time"]["live"] is False and debug["time"]["override"] is not None,
            f"override={debug['time']['override']}",
        )
        timeline = driver.execute_script(
            """
            const chips = Array.from(document.querySelectorAll('#millennium-timeline button'));
            return {
              count: chips.length,
              names: chips.map((el) => el.textContent).join('|'),
              active: chips.findIndex((el) => el.classList.contains('active')),
              label: document.querySelector('.millennium-label.primary .ml-name')?.textContent || '',
            };
            """
        )
        check(
            "千年：底部 11 期时间轴与锁定点名牌",
            timeline["count"] == 11 and timeline["active"] == 5 and timeline["label"] == "长安",
            f"chips={timeline['count']} · active={timeline['active']} · label={timeline['label']}",
        )
        driver.save_screenshot(str(OUT / "25_millennium_tang.png"))

        # ── 3. 拖动时间轴：秦（策展补注）→ 宋（京兆府）──
        driver.execute_script("window.__cl.millenniumEra(0); return true;")
        time.sleep(1.6)
        qin = driver.execute_script("return window.__cl.millennium()")
        qin_terrain = driver.execute_script("return window.__cl.debug().terrain")
        check(
            "千年：拖到秦——古名「内史」+ 策展补注 + 秦疆域重建",
            qin["era"] == "qin" and qin["ancient"] == "内史" and qin_terrain["points"] == 61,
            f"{qin['ancient']} · {qin_terrain['points']} 点",
        )
        driver.save_screenshot(str(OUT / "26_millennium_qin.png"))
        driver.execute_script("window.__cl.millenniumEra(6); return true;")
        time.sleep(1.6)
        song = driver.execute_script("return window.__cl.millennium()")
        check("千年：拖到宋——古名「京兆府」", song["era"] == "song" and song["ancient"] == "京兆府", f"{song['ancient']}")

        # ── 4. 历史地层抽屉 ──
        opened = driver.execute_script("return window.__cl.millenniumStrata(true)")
        time.sleep(0.6)
        strata = driver.execute_script(
            """
            const layers = Array.from(document.querySelectorAll('.millennium-layer'));
            return {
              count: layers.length,
              names: layers.map((el) => el.querySelector('.mlr-name')?.textContent || ''),
              text: layers.map((el) => el.textContent).join('|').slice(0, 120),
            };
            """
        )
        check(
            "千年：历史地层抽屉一期一层、可点击跳期",
            bool(opened)
            and strata["count"] == 11
            and "长安" in strata["names"]
            and "奉元路" in strata["names"],
            f"{strata['count']} 层 · {' → '.join(strata['names'])}",
        )
        driver.save_screenshot(str(OUT / "27_millennium_strata.png"))
        driver.execute_script(
            """
            const layers = Array.from(document.querySelectorAll('.millennium-layer'));
            layers.find((el) => el.textContent.includes('奉元路'))?.click();
            return true;
            """
        )
        time.sleep(1.6)
        yuan = driver.execute_script("return window.__cl.millennium()")
        check("千年：点地层跳到元——奉元路", yuan["era"] == "yuan" and yuan["ancient"] == "奉元路", f"{yuan['ancient']}")

        # ── 5. 与当朝人对话（有 Key 走大模型，没 Key 也应有可读提示）──
        driver.execute_script(
            """
            document.querySelector('.millennium-label.primary')?.click();
            return true;
            """
        )
        time.sleep(0.8)
        card = driver.execute_script("return window.__cl.millenniumCard()")
        check(
            "千年：卡片含当期古名与说明",
            card.get("card") and "奉元路" in card.get("title", ""),
            f"title={card.get('title')} · sub={card.get('sub')}",
        )
        driver.execute_script("window.__cl.millenniumAsk('这里当时热闹吗？'); return true;")
        answer = None
        for _ in range(50):
            answer = driver.execute_script(
                """
                const log = document.getElementById('mc-log');
                const assistant = log?.querySelector('.dc-msg.assistant');
                const system = Array.from(log?.querySelectorAll('.dc-msg.system') || []).pop();
                return {
                  text: (assistant && assistant.textContent) || '',
                  system: (system && system.textContent) || '',
                  streaming: window.__cl.millennium()?.streaming || false,
                };
                """
            )
            if not answer["streaming"] and (len(answer["text"]) > 6 or answer["system"]):
                break
            time.sleep(1)
        detail = (answer.get("text") or answer.get("system") or "").strip()
        check(
            "千年：与当朝人对话（大模型流式回答 / 无 Key 时给出可读提示）",
            len(answer.get("text") or "") > 6 or "OPENAI" in detail or "不可用" in detail,
            detail[:70],
        )

        # ── 6. 退出：现代图层与实时日照恢复 ──
        driver.execute_script("window.__cl.millenniumExit(); return true;")
        time.sleep(1.4)
        back = driver.execute_script("return { debug: window.__cl.debug(), state: window.__cl.millennium() }")
        check(
            "千年：返回沙盘后恢复现代国境与实时日照",
            (not back["state"]["active"])
            and back["debug"]["terrain"]["rings"] >= 20
            and back["debug"]["time"]["live"] is True
            and back["debug"]["layers"]["cityPoints"] is True,
            f"rings={back['debug']['terrain']['rings']} · live={back['debug']['time']['live']}",
        )

        # ── 7. 旅行电影入口（录制本身在正常浏览器里人工验收）──
        movie = driver.execute_script("return window.__cl.movie()")
        button = driver.execute_script("return Boolean(document.getElementById('guide-movie'))")
        check(
            "电影：导出入口就绪（不支持录制的浏览器会给出提示）",
            movie is not None and bool(button),
            f"movie={movie}",
        )

        # ── 8. 控制台零错误 ──
        errors = driver.execute_script(
            """
            const noise = arguments[0];
            return (window.__errors || []).filter((line) => !noise.some((item) => line.includes(item)));
            """,
            list(NOISE),
        )
        check("全程无控制台错误", not errors, " / ".join(errors[:3])[:200])
    finally:
        driver.quit()

    print()
    if failures:
        print(f"{len(failures)} 项未通过：" + "、".join(failures))
        return 1
    print("开场 + 千年端到端全部通过")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
