"""端到端验收：数字人回答接入本地非遗资料库 RAG。

运行前先启动服务（./run.sh），然后执行：
    python tools/browser_check_rag.py
产物：tests_artifacts/30_rag_sources.png
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
NOISE = ("setPointerCapture", "自适应", "自适应画质", "InvalidStateError")


def http_json(path: str, method: str = "GET", payload: dict | None = None) -> dict:
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8") if payload is not None else None
    request = urllib.request.Request(
        f"{BASE}{path}", data=data, method=method, headers={"Content-Type": "application/json"}
    )
    with urllib.request.urlopen(request, timeout=30) as response:  # noqa: S310
        return json.loads(response.read().decode("utf-8"))


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    try:
        status = http_json("/api/rag/status")
    except Exception as error:  # noqa: BLE001
        print("服务未启动或 RAG 接口不可用：", error)
        return 2
    failures: list[str] = []

    def check(name: str, condition: bool, detail: str = "") -> None:
        mark = "PASS" if condition else "FAIL"
        print(f"[{mark}] {name} → {detail}")
        if not condition:
            failures.append(name)

    check(
        "RAG 索引就绪",
        status.get("ready") is True and status.get("counts", {}).get("chunks", 0) > 1000,
        f"{status.get('counts', {}).get('chunks')} 块 · {status.get('counts', {}).get('titles')} 个标题 · "
        f"{round(status.get('size_bytes', 0) / 1e6, 1)} MB",
    )
    search = http_json("/api/rag/search", "POST", {"query": "苗族古歌讲的是什么", "top_k": 3})
    check(
        "RAG 检索命中实体卡与正文",
        search.get("count", 0) >= 2 and any(hit["title"] == "苗族古歌" for hit in search.get("hits", [])),
        " / ".join(f"{hit['title']}({hit['tier']})" for hit in search.get("hits", [])[:3]),
    )

    options = Options()
    options.add_argument("-headless")
    options.add_argument("--width=1500")
    options.add_argument("--height=950")
    if Path(FIREFOX_BINARY).exists():
        options.binary_location = FIREFOX_BINARY
    driver = webdriver.Firefox(
        options=options,
        service=Service(
            executable_path=GECKODRIVER if Path(GECKODRIVER).exists() else "/snap/bin/geckodriver"
        ),
    )
    try:
        driver.get(f"{BASE}/")
        for _ in range(40):
            if driver.execute_script("return Boolean(window.__cl)"):
                break
            time.sleep(0.5)
        time.sleep(2.5)

        # 进入唐朝 → 打开长安卡 → 在卡片里问一个非遗问题
        driver.execute_script("window.__cl.dynastyEnter('tang'); return true;")
        for _ in range(40):
            if driver.execute_script("return window.__cl.dynasty().active") == "tang":
                break
            time.sleep(0.3)
        time.sleep(1.2)
        driver.execute_script("window.__cl.dynastyPlace('changan'); return true;")
        time.sleep(0.5)
        driver.execute_script("window.__cl.dynastyAsk('苗族古歌讲的是什么？请用两句话介绍。'); return true;")

        answer = ""
        sources_text = ""
        deadline = time.time() + 90
        while time.time() < deadline:
            snapshot = driver.execute_script(
                """
                const log = document.getElementById('dc-log');
                const assistant = log?.querySelector('.dc-msg.assistant');
                const sources = log?.querySelector('.dc-msg.sources');
                return {
                  answer: (assistant && assistant.textContent) || '',
                  sources: (sources && sources.textContent) || '',
                  streaming: window.__cl.dynasty().streaming,
                };
                """
            )
            answer = snapshot["answer"] or ""
            sources_text = snapshot["sources"] or ""
            if not snapshot["streaming"] and answer and sources_text:
                break
            time.sleep(1)
        check(
            "数字人回答来自资料库内容",
            "古歌" in answer and ("开天辟地" in answer or "洪水" in answer or "迁徙" in answer),
            answer[:90],
        )
        check(
            "回答附带参考资料",
            "参考资料" in sources_text and "苗族古歌" in sources_text,
            sources_text[:100],
        )
        try:
            driver.save_screenshot(str(OUT / "30_rag_sources.png"))
        except Exception:  # noqa: BLE001
            pass
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
    print("RAG 端到端全部通过")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
