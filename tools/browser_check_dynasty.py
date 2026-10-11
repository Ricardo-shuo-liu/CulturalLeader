"""端到端验收：穿越系统（唐 / 宋 / 明 示意疆域 + 历史地名 + 诗词 + 朝代对话）。

运行前先启动服务（./run.sh），然后执行：
    python tools/browser_check_dynasty.py
产物：tests_artifacts/20_dynasty_tang.png · 21_dynasty_poem.png · 22_dynasty_back.png · 23_dynasty_glow.png
"""

from __future__ import annotations

import time
import urllib.request
from pathlib import Path

from selenium import webdriver
from selenium.webdriver.firefox.options import Options
from selenium.webdriver.firefox.service import Service

BASE = "http://127.0.0.1:8000"
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "tests_artifacts"
# 本机是 snap 版 Firefox：直接用 snap 内的 geckodriver / 浏览器二进制最稳（/snap/bin 的包装脚本会起不来）
GECKODRIVER = "/snap/firefox/current/usr/lib/firefox/geckodriver"
FIREFOX_BINARY = "/snap/firefox/current/usr/lib/firefox/firefox"

NOISE = ("setPointerCapture", "自适应", "自适应画质", "InvalidStateError")

# 时期清单：key / 名称 / 疆域环点数 / 至少应该看到的地名
PERIODS = [
    ("qin", "秦", 61, "咸阳"),
    ("han", "汉", 70, "长安"),
    ("sanguo", "三国", 58, "洛阳"),
    ("jin", "晋·南北朝", 49, "建康"),
    ("sui", "隋", 49, "大兴城"),
    ("tang", "唐", 67, "长安"),
    ("song", "宋", 49, "东京开封府"),
    ("yuan", "元", 52, "大都"),
    ("ming", "明", 61, "应天"),
    ("qing", "清", 58, "京师"),
    ("modern", "现代", 67, "北京"),
]


def api_get(path: str) -> int:
    with urllib.request.urlopen(f"{BASE}{path}", timeout=15) as response:  # noqa: S310
        return response.status


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    if api_get("/api/dynasty/list") != 200:
        print("服务未启动或穿越接口不可用，请先执行 ./run.sh")
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

    def click_canvas(x: float, y: float) -> None:
        driver.execute_script(
            """
            const canvas = document.getElementById('stage');
            const options = { bubbles: true, clientX: arguments[0], clientY: arguments[1], button: 0 };
            canvas.dispatchEvent(new PointerEvent('pointermove', options));
            canvas.dispatchEvent(new PointerEvent('pointerdown', options));
            canvas.dispatchEvent(new PointerEvent('pointerup', options));
            """,
            x,
            y,
        )

    try:
        driver.get(f"{BASE}/")
        for _ in range(40):
            if driver.execute_script("return Boolean(window.__cl)"):
                break
            time.sleep(0.5)
        time.sleep(3)
        baseline = driver.execute_script("return window.__cl.debug()")
        check(
            "现代沙盘基线（国境多环 + 城市光点可见）",
            baseline["terrain"]["rings"] >= 20
            and baseline["terrain"]["points"] > 1000
            and baseline["layers"]["cityPoints"],
            f"{baseline['terrain']['rings']} 环 / {baseline['terrain']['points']} 点",
        )

        # ── 1. 抽屉里选唐 → 开始穿越 ──
        driver.execute_script(
            """
            document.getElementById('nav-toggle').click();
            const select = document.getElementById('dynasty-select');
            select.value = 'tang';
            select.dispatchEvent(new Event('change', { bubbles: true }));
            document.getElementById('dynasty-enter').click();
            """
        )
        for _ in range(30):
            state = driver.execute_script("return window.__cl.dynasty()")
            if state.get("active"):
                break
            time.sleep(0.3)
        time.sleep(1.6)
        state = driver.execute_script("return window.__cl.dynasty()")
        debug = driver.execute_script("return window.__cl.debug()")
        check(
            "穿越：进入唐朝（示意疆域重建）",
            state.get("active") == "tang" and debug["terrain"]["rings"] == 1 and debug["terrain"]["points"] == 67,
            f"active={state.get('active')} · {debug['terrain']['rings']} 环 / {debug['terrain']['points']} 点",
        )
        check(
            "穿越：现代图层整体隐藏",
            (not debug["layers"]["cityPoints"])
            and (not debug["layers"]["cityStage"])
            and debug["layers"]["cityLayerOpacity"] < 0.05
            and (not debug["layers"]["provinceGroup"]),
            f"layers={debug['layers']}",
        )
        check(
            "穿越：历史地名与诗词标记出现",
            state["markers"]["places"] >= 12
            and state["markers"]["poems"] >= 12
            and state["markers"]["glow"] >= 4,
            f"地名 {state['markers']['places']} · 诗词光点 {state['markers']['poems']} · 光字 {state['markers']['glow']}",
        )
        bar = driver.execute_script(
            """
            const bar = document.getElementById('dynasty-bar');
            return { text: bar.textContent, hidden: bar.classList.contains('hidden') };
            """
        )
        check(
            "穿越：顶部朝代状态条",
            (not bar["hidden"]) and "唐" in bar["text"] and "长安" in bar["text"],
            bar["text"].strip()[:60],
        )
        place_labels = driver.execute_script(
            """
            const nodes = Array.from(document.querySelectorAll('.dynasty-place-label'));
            const visible = nodes.filter((el) => el.style.display !== 'none');
            return {
              total: nodes.length,
              visible: visible.length,
              text: visible.map((el) => el.textContent).join('|'),
              options: document.querySelectorAll('#dynasty-select option').length,
            };
            """
        )
        check(
            "穿越：地图上显示历史地名（不是只有光点）",
            place_labels["total"] >= 12
            and place_labels["visible"] >= 8
            and "长安" in place_labels["text"]
            and "西安" in place_labels["text"],
            f"标签 {place_labels['visible']}/{place_labels['total']} 可见 · 例：{place_labels['text'][:40]}",
        )
        check(
            "穿越：抽屉里可选秦→现代共 11 个时期",
            place_labels["options"] == 11,
            f"{place_labels['options']} 个时期",
        )
        # 常驻地名：相机不动时可见集合必须一致（不闪、不跳）
        label_sig_js = """
            const nodes = Array.from(document.querySelectorAll('.dynasty-place-label'));
            const visible = nodes.filter((el) => el.style.display !== 'none');
            return { count: visible.length, names: visible.map((el) => el.textContent).sort().join('|') };
        """
        first_labels = driver.execute_script(label_sig_js)
        time.sleep(2.2)
        second_labels = driver.execute_script(label_sig_js)
        check(
            "穿越：地名常驻不闪（静止 2 秒可见集合不变）",
            first_labels["count"] >= 8 and first_labels["names"] == second_labels["names"],
            f"{first_labels['count']} 个地名 · 集合一致={first_labels['names'] == second_labels['names']}",
        )
        driver.save_screenshot(str(OUT / "20_dynasty_tang.png"))

        # ── 2. 悬停 + 点击历史地名（真实命中判定）──
        spot = driver.execute_script("return window.__cl.screen(108.9398, 34.3416)")
        driver.execute_script(
            """
            const canvas = document.getElementById('stage');
            canvas.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: arguments[0], clientY: arguments[1] }));
            """,
            spot["x"],
            spot["y"],
        )
        time.sleep(0.4)
        tip = driver.execute_script(
            """
            const tip = document.getElementById('dynasty-tip');
            return { text: tip.textContent, hidden: tip.classList.contains('hidden') };
            """
        )
        check("穿越：悬停显示历史地名名牌", (not tip["hidden"]) and "长安" in tip["text"], tip["text"])

        click_canvas(spot["x"], spot["y"])
        time.sleep(0.6)
        card = driver.execute_script("return window.__cl.dynastyCard()")
        check(
            "穿越：点击长安弹出地点卡",
            card.get("card") == "place:changan" and "长安" in card.get("title", "") and "西安" in card.get("sub", ""),
            f"{card.get('title')} · {card.get('sub')}",
        )

        # ── 3. 与数字人讨论：对话只走大模型，这里要求拿到真实回答 ──
        driver.execute_script("window.__cl.dynastyAsk('长安城有多大？'); return true;")
        answer = None
        for _ in range(60):
            answer = driver.execute_script(
                """
                const log = document.getElementById('dc-log');
                const assistant = log.querySelector('.dc-msg.assistant');
                const system = Array.from(log.querySelectorAll('.dc-msg.system')).pop();
                return {
                  text: (assistant && assistant.textContent) || '',
                  system: (system && system.textContent) || '',
                  streaming: window.__cl.dynasty().streaming,
                };
                """
            )
            if not answer["streaming"] and (len(answer["text"]) > 6 or answer["system"]):
                break
            time.sleep(1)
        detail = (answer.get("text") or answer.get("system") or "").strip()
        check(
            "穿越：与数字人对话（大模型流式回答）",
            len(answer.get("text") or "") > 6,
            detail[:70],
        )

        # ── 4. 诗词卡片（含「一说」存疑标注）──
        driver.execute_script("window.__cl.dynastyPoem('jingyesi'); return true;")
        time.sleep(0.8)
        poem_card = driver.execute_script(
            """
            const body = document.getElementById('dc-body').textContent;
            return {
              title: document.getElementById('dc-title').textContent,
              hasVerse: body.includes('床前明月光'),
              hasNote: body.includes('一说'),
              hasPlace: body.includes('扬州'),
            };
            """
        )
        check(
            "穿越：诗词卡含全文 / 写作地 / 一说标注",
            poem_card["title"].startswith("《静夜思》")
            and poem_card["hasVerse"]
            and poem_card["hasNote"]
            and poem_card["hasPlace"],
            f"{poem_card['title']} · 全文{poem_card['hasVerse']} · 一说{poem_card['hasNote']}",
        )
        driver.save_screenshot(str(OUT / "21_dynasty_poem.png"))

        # ── 4b. 光韵字：首联两列浮在写作地上方，悬停出名牌、点击弹卡 ──
        time.sleep(1.0)
        stele = driver.execute_script("return window.__cl.dynastyGlow('jingyesi')")
        in_view = bool(stele) and (0 < stele["x"] < 1500) and (0 < stele["y"] < 950)
        check(
            "穿越：诗词全部浮起光韵字（首联两列）",
            bool(stele) and in_view,
            f"{len(state['markers'].get('glowIds') or [])} 组光字 · 静夜思光字屏幕位置 ({round(stele['x']) if stele else '—'}, {round(stele['y']) if stele else '—'})",
        )
        if in_view:
            driver.execute_script(
                """
                const canvas = document.getElementById('stage');
                canvas.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: arguments[0], clientY: arguments[1] }));
                """,
                stele["x"],
                stele["y"],
            )
            time.sleep(0.4)
            stele_tip = driver.execute_script(
                """
                const tip = document.getElementById('dynasty-tip');
                return { text: tip.textContent, hidden: tip.classList.contains('hidden') };
                """
            )
            check(
                "穿越：悬停光字显示诗词名牌",
                (not stele_tip["hidden"]) and "静夜思" in stele_tip["text"],
                stele_tip["text"],
            )
            click_canvas(stele["x"], stele["y"])
            time.sleep(0.6)
            stele_card = driver.execute_script("return window.__cl.dynastyCard()")
            check(
                "穿越：点击光字弹出对应诗词卡",
                stele_card.get("card") == "poem:jingyesi",
                f"card={stele_card.get('card')}",
            )
            driver.save_screenshot(str(OUT / "23_dynasty_glow.png"))

        # ── 5. 抽屉里的本朝诗词列表可直接飞到写作地 ──
        driver.execute_script(
            """
            document.getElementById('nav-toggle').click();
            document.querySelector('#dynasty-poems .dynasty-poem').click();
            """
        )
        time.sleep(1.0)
        list_card = driver.execute_script(
            """
            return {
              title: document.getElementById('dc-title').textContent,
              count: document.querySelectorAll('#dynasty-poems .dynasty-poem').length,
              drawerOpen: document.getElementById('drawer').classList.contains('open'),
            };
            """
        )
        check(
            "穿越：诗词列表 12+ 首、点击飞到写作地并弹卡",
            list_card["count"] >= 12 and ("《" in list_card["title"]) and (not list_card["drawerOpen"]),
            f"{list_card['count']} 首 · 当前 {list_card['title']}",
        )

        # ── 6. 穿越模式下双击城市不进流程编辑 ──
        driver.execute_script(
            """
            const label = document.querySelector('.city-label[data-slug="beijing"]');
            label.click();
            label.click();
            return true;
            """
        )
        time.sleep(1.2)
        planner_open = driver.execute_script("return window.__cl.planner().open")
        check("穿越：双击城市不会打开流程编辑器", planner_open is False, f"planner.open={planner_open}")

        # ── 7. 返回现代 ──
        driver.execute_script("document.getElementById('dynasty-bar-exit').click(); return true;")
        for _ in range(30):
            state = driver.execute_script("return window.__cl.dynasty()")
            if not state.get("active"):
                break
            time.sleep(0.3)
        time.sleep(2.0)
        restored = driver.execute_script("return window.__cl.debug()")
        dynasty_class = driver.execute_script("return document.body.classList.contains('dynasty-mode')")
        check(
            "返回现代：国境与全部图层恢复",
            restored["terrain"]["rings"] >= 20
            and restored["terrain"]["points"] > 1000
            and restored["layers"]["cityPoints"]
            and restored["layers"]["cityLayerOpacity"] > 0.4
            and (not dynasty_class),
            f"{restored['terrain']['rings']} 环 / {restored['terrain']['points']} 点 · cityLayer={restored['layers']['cityLayerOpacity']}",
        )
        bar_hidden = driver.execute_script("return document.getElementById('dynasty-bar').classList.contains('hidden')")
        check("返回现代：朝代状态条收起", bar_hidden is True, f"hidden={bar_hidden}")
        driver.save_screenshot(str(OUT / "22_dynasty_back.png"))

        # ── 7b. 秦 → 现代 11 个时期都能切换（疆域重建 + 地名标签 + 光字）──
        # 静音跑完这一轮，避免为每个时期都生成一段旁白语音（省额度）
        driver.execute_script("document.getElementById('mute-btn').click(); return true;")
        for key, name, points, expect_name in PERIODS:
            if key == "tang":
                continue  # 唐已经完整测过
            driver.execute_script("window.__cl.dynastyEnter(arguments[0]); return true;", key)
            for _ in range(30):
                probe = driver.execute_script("return window.__cl.dynasty()")
                if probe.get("active") == key:
                    break
                time.sleep(0.3)
            time.sleep(1.3)
            probe = driver.execute_script("return window.__cl.dynasty()")
            terrain = driver.execute_script("return window.__cl.debug().terrain")
            labels = driver.execute_script(
                """
                const nodes = Array.from(document.querySelectorAll('.dynasty-place-label'));
                const visible = nodes.filter((el) => el.style.display !== 'none');
                const poems = Array.from(document.querySelectorAll('.dynasty-poem-label'));
                const poemsVisible = poems.filter((el) => el.style.display !== 'none');
                return {
                  visible: visible.length,
                  text: visible.map((el) => el.textContent).join('|'),
                  tiers: visible.map((el) => el.className).join(' '),
                  poemLabels: poemsVisible.length,
                  minorLabels: visible.filter((el) => el.className.includes('tier-3')).length,
                  compact: document.getElementById('dynasty-labels').classList.contains('compact'),
                };
                """
            )
            check(
                f"穿越：切换到{name}（疆域 {points} 点 + 地名标签 + 光字）",
                probe.get("active") == key
                and terrain["rings"] == 1
                and terrain["points"] == points
                and probe["markers"]["places"] >= 12
                and probe["markers"]["poems"] >= 10
                and probe["markers"]["glow"] == probe["markers"]["poems"]
                and probe["markers"]["minorPlaces"] >= 8
                and probe["markers"]["routes"] >= 20
                and labels["visible"] >= 10,
                f"{terrain['rings']} 环 / {terrain['points']} 点 · 地名 {probe['markers']['places']}(+次级 {probe['markers']['minorPlaces']}) · 驿道 {probe['markers']['routes']} 段 · 标签 {labels['visible']} · 诗签 {labels['poemLabels']} · 光字 {probe['markers']['glow']}/{probe['markers']['poems']}",
            )
            check(
                f"穿越：{name} 的地名有分级、次级地名填空、诗词有成组题名",
                "tier-0" in labels["tiers"] and labels["minorLabels"] >= 2 and labels["poemLabels"] >= 2,
                f"都城级={('tier-0' in labels['tiers'])} · 次级标签 {labels['minorLabels']} · 题名 {labels['poemLabels']} · 紧凑模式={labels['compact']}",
            )
            if expect_name:
                check(f"穿越：{name} 的地名标签含「{expect_name}」", expect_name in labels["text"], labels["text"][:60])
            driver.execute_script("window.__cl.dynastyExit(); return true;")
            time.sleep(1.4)
        driver.execute_script("document.getElementById('mute-btn').click(); return true;")

        # ── 7c. 懒加载：详情按时期缓存，来回切换不重复请求 ──
        cache_info = driver.execute_script("return window.__cl.dynasty().markers.cachedPeriods")
        check("穿越：时期详情按需加载并缓存", cache_info >= 10, f"已缓存 {cache_info} 个时期")

        # ── 7d. 状态条 ◀ / ▶ 按时间线切换 + 缓存后的切换速度 ──
        driver.execute_script("window.__cl.dynastyEnter('tang'); return true;")
        for _ in range(20):
            if driver.execute_script("return window.__cl.dynasty().active") == "tang":
                break
            time.sleep(0.3)
        time.sleep(0.8)
        driver.execute_script("document.getElementById('dynasty-next').click(); return true;")
        time.sleep(1.6)
        forward = driver.execute_script("return window.__cl.dynasty().active")
        driver.execute_script("document.getElementById('dynasty-prev').click(); return true;")
        time.sleep(1.6)
        backward = driver.execute_script("return window.__cl.dynasty().active")
        check(
            "穿越：状态条 ◀ / ▶ 按时间线前后切换",
            forward == "song" and backward == "tang",
            f"唐 → ▶ {forward} → ◀ {backward}",
        )
        elapsed = driver.execute_script(
            """
            const t0 = performance.now();
            return window.__cl.dynastyEnter('qing').then(() => performance.now() - t0);
            """
        )
        check(
            "穿越：已缓存的时期切换很快（懒加载 + 内存缓存）",
            elapsed is not None and elapsed < 3000,
            f"{elapsed:.0f} ms" if elapsed is not None else "未取到耗时",
        )
        driver.execute_script("window.__cl.dynastyExit(); return true;")
        time.sleep(1.2)

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
    print("穿越系统端到端全部通过")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
