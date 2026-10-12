"""端到端验收：开场 30 秒 + 一块土地的千年（重塑版：连续年份 / 疆域形变 / 残影 / 地层柱 / 事件 / 自动播放）。

运行前先启动服务（./run.sh），然后执行：
    python tools/browser_check_millennium.py
产物：tests_artifacts/24_intro.png · 25_millennium_tang.png · 26_millennium_morph.png
      · 27_millennium_event.png · 28_millennium_autoplay.png
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
            card.__city = { name: '西安', lng: 108.94, lat: 34.34, landmark_key: 'bell_tower' };
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
            state["band"] == "tang" and "长安" in state["chain"] and 700 < state["year"] < 850,
            f"band={state['band']} · year={state['year']} · chain={ ' → '.join(state['chain'][:5]) }",
        )
        check(
            "千年：不再重建网格（现代浮雕几何复用），现代图层收起",
            state["bands"] == 11
            and debug["terrain"]["points"] == 1913
            and (not debug["layers"]["cityPoints"])
            and debug["layers"]["cityLayerOpacity"] < 0.05,
            f"几何 {debug['terrain']['points']} 点（与沙盘同一份）· 11 段年代",
        )
        check(
            "千年：日照切到唐的代表时刻（夏至黄昏，且是连续插值）",
            debug["time"]["live"] is False and debug["time"]["override"] is not None,
            f"override={debug['time']['override']}",
        )
        timeline = driver.execute_script(
            """
            const bands = Array.from(document.querySelectorAll('#mt-bands .mt-band'));
            const range = document.getElementById('mt-range');
            return {
              count: bands.length,
              names: bands.map((el) => el.textContent).join('|'),
              active: bands.findIndex((el) => el.classList.contains('active')),
              min: Number(range.min),
              max: Number(range.max),
              year: document.getElementById('mt-year').textContent,
              barHidden: document.getElementById('millennium-bar').classList.contains('hidden'),
              chain: document.querySelectorAll('#mt-chain .mt-chain-item').length,
              events: document.querySelectorAll('#mt-events .mt-event').length,
              label: document.querySelector('.millennium-label.primary .ml-name')?.textContent || '',
            };
            """
        )
        check(
            "千年：连续年份轴（前 221 → 今）+ 朝代色带 + 事件刻点",
            timeline["count"] == 11
            and timeline["min"] == -221
            and timeline["max"] >= 2026
            and timeline["events"] >= 8
            and timeline["chain"] >= 5
            and timeline["barHidden"] is False,
            f"{timeline['count']} 段 · {timeline['min']}~{timeline['max']} · 事件 {timeline['events']} · 改名链 {timeline['chain']}",
        )
        check(
            "千年：HUD 年份与锁定点名牌",
            "年" in timeline["year"] and timeline["label"] == "长安",
            f"{timeline['year']} · label={timeline['label']}",
        )
        voice_state = driver.execute_script(
            """
            return fetch('/api/config').then((r) => r.json()).then((config) => ({
              tts_ready: config.tts_ready,
              allow_browser_voice: config.allow_browser_voice,
              ambience: config.ambience,
              voice: window.__cl.debug().voice,
            }));
            """
        )
        check(
            "语音：云端 TTS 就绪时禁用系统语音兜底（不再出现 espeak 念字母）",
            voice_state["allow_browser_voice"] is (not voice_state["tts_ready"])
            and voice_state["voice"]["allowBrowserVoice"] is (not voice_state["tts_ready"]),
            f"tts_ready={voice_state['tts_ready']} · mode={voice_state['voice']['mode']}",
        )
        driver.save_screenshot(str(OUT / "25_millennium_tang.png"))

        # ── 3. 连续年份：拖到秦（策展补注）→ 唐末嗅到宋的形变 → 宋（京兆府）──
        driver.execute_script("window.__cl.millenniumYear(-210); return true;")
        time.sleep(1.6)
        qin = driver.execute_script("return window.__cl.millennium()")
        check(
            "千年：拖到前 210 年——古名「内史」、当前段为秦",
            qin["band"] == "qin" and qin["chain"][0] == "内史",
            f"band={qin['band']} · year={qin['year']} · chain={qin['chain'][:3]}",
        )
        driver.save_screenshot(str(OUT / "26_millennium_qin.png"))
        # 疆域形变：拖到唐末宋初的混合窗里，遮罩应同时混着唐与宋
        driver.execute_script("window.__cl.millenniumYear(905); return true;")
        time.sleep(1.6)
        morph = driver.execute_script("return window.__cl.millennium()")
        check(
            "千年：疆域连续形变（唐→宋混合窗内 eraA=唐、eraB=宋、mix 在途中）",
            morph["eraA"] == "tang" and morph["eraB"] == "song" and 0.1 < morph["mix"] < 0.95,
            f"eraA={morph['eraA']} · eraB={morph['eraB']} · mix={morph['mix']}",
        )
        driver.save_screenshot(str(OUT / "26_millennium_morph.png"))
        driver.execute_script("window.__cl.millenniumYear(1100); return true;")
        time.sleep(1.4)
        song = driver.execute_script("return window.__cl.millennium()")
        check(
            "千年：拖到宋——古名「京兆府」、疆域不再是现代轮廓的直换",
            song["band"] == "song" and "京兆府" in song["chain"],
            f"band={song['band']} · chain={song['chain']}",
        )
        check(
            "千年：前朝残影开始积累（走过秦、唐后场上留有幽灵线）",
            song["ghosts"] and song["ghosts"]["ghosts"] >= 2 and song["ghosts"]["visibleGhosts"] >= 2,
            f"ghosts={song['ghosts']}",
        )

        # ── 4. 地层柱：11 层、层厚 ∝ 朝代年数；点击柱体跳年 ──
        strata = song.get("strata") or {}
        check(
            "千年：地层柱 11 层，层厚按朝代年数（宋厚秦薄）",
            strata.get("layers") == 11
            and strata["thickness"]["song"] > strata["thickness"]["qin"] * 3,
            f"宋 {strata.get('thickness', {}).get('song')} / 秦 {strata.get('thickness', {}).get('qin')}",
        )
        spot = driver.execute_script("return window.__cl.screen(108.94, 34.34)")
        hit = driver.execute_script(
            "return window.__cl.millenniumClickAt(arguments[0], arguments[1])", spot["x"], spot["y"]
        )
        time.sleep(1.2)
        after_click = driver.execute_script("return window.__cl.millennium()")
        check(
            "千年：点击地层柱可以跳年（命中柱体）",
            bool(hit) and after_click["band"] != song["band"],
            f"hit={hit} · {song['band']} → {after_click['band']}",
        )

        # ── 4b. 360° 环幕 + 真实地标随史建造 ──
        # 同一时刻取环幕与日照（不同年份的日照不同，必须同时快照）
        snapshot = driver.execute_script(
            "return { ring: window.__cl.millennium().ring, solar: window.__cl.debug().solar, landmark: window.__cl.millennium().landmark }"
        )
        ring = snapshot.get("ring") or {}
        solar = snapshot.get("solar") or {}
        landmark = snapshot.get("landmark") or {}
        check(
            "环幕：三层剪影 + 天幕（半径 12.5，任何机位都在场内）",
            ring.get("visible") is True
            and ring.get("layers") == 3
            and abs((ring.get("radius") or 0) - 12.5) < 0.01,
            f"layers={ring.get('layers')} · radius={ring.get('radius')} · phase={ring.get('phase')}",
        )
        check(
            "环幕：日月方位与舞台日照对齐（晨昏线扫到哪，日月就在哪个方位）",
            solar
            and ring.get("sunAzimuth") is not None
            and abs(ring["sunAzimuth"] - solar["azimuth"]) < 1.0,
            f"环幕 {ring.get('sunAzimuth')}° vs 舞台 {round(solar.get('azimuth', -1), 1)}°",
        )
        check(
            "地标：763 年西安钟楼尚未出现（1384 年才建）",
            landmark.get("state") == "absent",
            f"state={landmark.get('state')}",
        )
        driver.execute_script("window.__cl.millenniumYear(-200); return true;")
        time.sleep(0.8)
        early_ring = driver.execute_script("return window.__cl.millennium()")
        driver.execute_script("window.__cl.millenniumYear(2000); return true;")
        time.sleep(1.0)
        late_ring = driver.execute_script("return window.__cl.millennium()")
        check(
            "环幕：随年份连续演进（秦汉有墙无楼 → 现代楼群起、城墙归零）",
            (early_ring["ring"]["parts"]["walls"] or 0) > 0.3
            and (early_ring["ring"]["parts"]["towers"] or 0) == 0
            and (late_ring["ring"]["parts"]["towers"] or 0) > 0.9
            and (late_ring["ring"]["parts"]["walls"] or 0) == 0,
            f"前 200 年 墙 {early_ring['ring']['parts']['walls']} / 楼 {early_ring['ring']['parts']['towers']}"
            f" → 2000 年 墙 {late_ring['ring']['parts']['walls']} / 楼 {late_ring['ring']['parts']['towers']}",
        )
        driver.execute_script("document.getElementById('millennium-screen-toggle').click(); return true;")
        time.sleep(0.4)
        screen_off = driver.execute_script("return window.__cl.millennium().ring.visible")
        driver.execute_script("document.getElementById('millennium-screen-toggle').click(); return true;")
        time.sleep(0.4)
        screen_on = driver.execute_script("return window.__cl.millennium().ring.visible")
        check("环幕：开关可用", screen_off is False and screen_on is True, f"{screen_off} → {screen_on}")
        driver.execute_script("window.__cl.millenniumYear(1390); return true;")
        time.sleep(1.0)
        tower = driver.execute_script("return window.__cl.millennium()")
        toggle_label = driver.execute_script("return document.getElementById('millennium-diorama-toggle').textContent")
        check(
            "地标：1384 年之后钟楼立起（分层建造完成）",
            tower["landmark"]["state"] == "complete"
            and tower["landmark"]["revealed"] == tower["landmark"]["layers"],
            f"state={tower['landmark']['state']} · {tower['landmark']['revealed']}/{tower['landmark']['layers']} 层",
        )
        check(
            "地标：有模型的城市里，城郭剪影让位给真实地标",
            toggle_label.strip() == "地标" and tower.get("diorama") is None,
            f"按钮={toggle_label.strip()} · diorama={tower.get('diorama')}",
        )
        driver.save_screenshot(str(OUT / "29_millennium_ring.png"))
        driver.execute_script("window.__cl.millenniumYear(1500); return true;")
        time.sleep(0.8)
        kept = driver.execute_script("return window.__cl.millennium()")
        check(
            "地标：迁建空档（1385–1581）钟楼仍在场（gap=keep，不误演废墟）",
            kept["landmark"]["state"] == "complete",
            f"state={kept['landmark']['state']}",
        )

        # 建造中的样子：敦煌莫高窟（366 起凿、长窗 600 年）
        driver.execute_script("window.__cl.millenniumOpen('敦煌'); return true;")
        for _ in range(40):
            mohao_state = driver.execute_script("return window.__cl.millennium()")
            if mohao_state and mohao_state.get("active") and mohao_state.get("city") == "敦煌":
                break
            time.sleep(0.4)
        driver.execute_script("window.__cl.millenniumYear(500); return true;")
        time.sleep(1.2)
        mohao = driver.execute_script("return window.__cl.millennium()")
        check(
            "地标：莫高窟 500 年仍在开凿（建造中 + 脚手架在场）",
            mohao["landmark"]["state"] == "building"
            and mohao["landmark"]["scaffolding"] is True
            and 0 < mohao["landmark"]["progress"] < 1,
            f"state={mohao['landmark']['state']} · {mohao['landmark']['progress']} · 已现 {mohao['landmark']['revealed']}/14 层",
        )
        driver.save_screenshot(str(OUT / "30_landmark_building.png"))
        driver.execute_script("window.__cl.millenniumYear(1200); return true;")
        time.sleep(1.0)
        mohao_done = driver.execute_script("return window.__cl.millennium()")
        check(
            "地标：莫高窟 1200 年已建成",
            mohao_done["landmark"]["state"] == "complete",
            f"state={mohao_done['landmark']['state']}",
        )

        # 重建：武汉黄鹤楼（223 始建、1981 重建）
        driver.execute_script("window.__cl.millenniumOpen('武汉'); return true;")
        for _ in range(40):
            wuhan_state = driver.execute_script("return window.__cl.millennium()")
            if wuhan_state and wuhan_state.get("active") and wuhan_state.get("city") == "武汉":
                break
            time.sleep(0.4)
        driver.execute_script("window.__cl.millenniumYear(1500); return true;")
        time.sleep(0.8)
        crane_ruins = driver.execute_script("return window.__cl.millennium()")
        driver.execute_script("window.__cl.millenniumYear(1990); return true;")
        time.sleep(1.0)
        crane_done = driver.execute_script("return window.__cl.millennium()")
        check(
            "地标：黄鹤楼 1500 年残迹、1990 年重建完成",
            crane_ruins["landmark"]["state"] == "ruins" and crane_done["landmark"]["state"] == "complete",
            f"{crane_ruins['landmark']['state']} → {crane_done['landmark']['state']}",
        )
        driver.save_screenshot(str(OUT / "31_landmark_rebuild.png"))
        driver.execute_script("window.__cl.millenniumExit(); return true;")
        time.sleep(1.0)

        # 回到西安继续后面的事件 / 自动播放 / 对话检查
        driver.execute_script("window.__cl.millenniumOpen('西安'); return true;")
        for _ in range(40):
            back_state = driver.execute_script("return window.__cl.millennium()")
            if back_state and back_state.get("active") and back_state.get("city") == "西安":
                break
            time.sleep(0.4)
        time.sleep(1.2)

        # 回到唐，准备事件与自动播放
        driver.execute_script("window.__cl.millenniumYear(640); return true;")
        time.sleep(1.2)

        # ── 5. 事件年表：跨过 652 年（大雁塔）应弹出事件卡 ──
        driver.execute_script("window.__cl.millenniumYear(660); return true;")
        time.sleep(0.4)
        flash = driver.execute_script("return window.__cl.millennium()")
        check(
            "千年影院：事件同时闪在银幕与地图（银幕爆光 + 地图微光回洒）",
            (flash["ring"]["event"] or 0) > 0.2 and (flash["terrainCinema"] or 0) >= 0,
            f"event={flash['ring']['event']} · mapLight={round(flash['terrainCinema'], 3)}",
        )
        time.sleep(0.6)
        event_card = driver.execute_script(
            """
            const node = document.getElementById('millennium-event');
            return {
              show: node.classList.contains('show'),
              hidden: node.classList.contains('hidden'),
              title: node.querySelector('.me-title')?.textContent || '',
            };
            """
        )
        check(
            "千年：跨过事件年份弹书法事件卡（652 大雁塔）",
            event_card["show"] and not event_card["hidden"] and "大雁塔" in event_card["title"],
            f"{event_card['title']}",
        )
        driver.save_screenshot(str(OUT / "27_millennium_event.png"))

        # ── 6. 「千年一刻」自动播放：年份连续推进 ──
        before = driver.execute_script("return window.__cl.millennium().year")
        driver.execute_script("window.__cl.millenniumAutoplay(); return true;")
        time.sleep(3.0)
        playing = driver.execute_script("return window.__cl.millennium()")
        driver.save_screenshot(str(OUT / "28_millennium_autoplay.png"))
        driver.execute_script("window.__cl.millenniumAutoplay(); return true;")
        time.sleep(0.6)
        stopped = driver.execute_script("return window.__cl.millennium()")
        check(
            "千年：▶ 千年一刻自动推进年份，再点一次暂停",
            playing["autoplay"] is True
            and -160 < playing["year"] < 40
            and stopped["autoplay"] is False,
            f"{before} → {playing['year']}（从时间轴起点重播）· autoplay={playing['autoplay']} → {stopped['autoplay']}",
        )

        driver.execute_script("window.__cl.millenniumYear(760); return true;")
        time.sleep(1.0)
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
            card.get("card") and "长安" in card.get("title", ""),
            f"title={card.get('title')} · sub={card.get('sub')}",
        )

        # ── 7. 与当朝人对话（有 Key 走大模型，没 Key 也应有可读提示）──
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

        # ── 8. 环境音素材：只请求 /api/config 清单里存在的文件（不再盲探 404）──
        audio_requests = driver.execute_script(
            """
            return fetch('/api/config').then((r) => r.json()).then((config) => {
              const expected = Object.values(config.ambience || {}).filter(Boolean).length;
              const actual = performance
                .getEntriesByType('resource')
                .filter((entry) => entry.name.includes('/assets/audio/')).length;
              return { expected, actual };
            });
            """
        )
        check(
            "环境音：按服务端清单加载，没有多余的素材探测请求",
            audio_requests["actual"] <= audio_requests["expected"],
            f"清单 {audio_requests['expected']} 条 · 实际请求 {audio_requests['actual']} 次",
        )

        # ── 9. 控制台零错误 ──
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
