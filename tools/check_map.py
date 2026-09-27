"""腾讯位置服务 Key 自检：确认 WebService Key 与 JS Key 是否可用，并给出可执行的修复建议。

直接读项目 .env（无需启动服务）：
    python tools/check_map.py
"""

from __future__ import annotations

import sys
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from backend.app.config import get_settings  # noqa: E402
from backend.app.services.tencent_map import STATUS_HINTS, MapError, TencentMapClient  # noqa: E402

def _public_ip() -> str:
    """查询本机出口 IP（供加入腾讯 Key 的白名单）。"""
    for url in ("https://ifconfig.me/ip", "https://api.ipify.org", "https://ipinfo.io/ip"):
        try:
            request = urllib.request.Request(url, headers={"User-Agent": "curl/8"})
            with urllib.request.urlopen(request, timeout=6) as response:  # noqa: S310
                value = response.read().decode("utf-8").strip()
            if value and len(value) <= 45:
                return value
        except Exception:  # noqa: BLE001
            continue
    return "（查询失败，可在浏览器搜索「我的IP」查看）"


def _live_call(client, path: str, params: dict) -> dict:
    """绕过缓存直接打腾讯接口：这样才能真实反映「现在的 Key + 现在的出口 IP」是否可用。"""
    import json as _json
    import urllib.parse
    import urllib.request

    query = dict(params)
    query["key"] = client.settings.tencent_map_key
    signature = client._signature(path, query)
    if signature:
        query["sig"] = signature
    url = f"https://apis.map.qq.com/{path}?" + urllib.parse.urlencode(query)
    try:
        with urllib.request.urlopen(  # noqa: S310
            urllib.request.Request(url, headers={"User-Agent": "CulturalLeader/0.1"}), timeout=15
        ) as response:
            payload = _json.loads(response.read().decode("utf-8"))
    except Exception as error:  # noqa: BLE001
        raise MapError(f"请求失败：{error}") from error
    status = int(payload.get("status") or 0)
    if status != 0:
        raise MapError(
            f"{payload.get('message') or '请求失败'}（status={status}）→ "
            f"{STATUS_HINTS.get(status, '检查 Key 与授权设置')}"
        )
    return payload


def _check_district(client) -> str:
    payload = _live_call(client, "ws/district/v1/list", {})
    return f"ok（{len(payload.get('result') or [])} 项）"


def _check_poi(client) -> str:
    payload = _live_call(
        client, "ws/place/v1/search", {"keyword": "咖啡", "boundary": "region(北京市,0)", "page_size": 1}
    )
    return f"ok（{len(payload.get('data') or [])} 条）"


def _check_route(client) -> str:
    _live_call(client, "ws/direction/v1/walking", {"from": "39.908,116.397", "to": "39.916,116.407"})
    return "ok"


def _check_reverse(client) -> str:
    payload = _live_call(
        client, "ws/geocoder/v1", {"location": "34.555,112.477", "get_poi": 1, "poi_options": "radius=200;page_size=1"}
    )
    nearest = ((payload.get("result") or {}).get("pois") or [{}])[0].get("title") or "（无最近地点）"
    return f"ok（最近：{nearest}）"


CHECKS = [
    ("行政区划（district/list）", lambda client: _check_district(client)),
    ("POI 搜索（place/search）", lambda client: _check_poi(client)),
    ("路径规划（direction/walking）", lambda client: _check_route(client)),
    ("地图取点（geocoder 逆地理）", lambda client: _check_reverse(client)),
]


def main() -> int:
    settings = get_settings()
    print("腾讯位置服务 Key 自检")
    print("-" * 60)
    env_path = ROOT / ".env"
    print(f".env 路径：{env_path}{'（不存在）' if not env_path.exists() else ''}")
    print(f"WebService Key：{'已配置（长度 %d）' % len(settings.tencent_map_key) if settings.tencent_map_key else '未配置'}")
    print(f"签名 SK：{'已配置' if settings.tencent_map_sk else '未配置（Key 未开启签名校验时留空即可）'}")
    print(f"JS Key：{'已配置（长度 %d）' % len(settings.tencent_map_js_key) if settings.tencent_map_js_key else '未配置'}")
    print(f"每日上限：{settings.map_daily_limit} · QPS：{settings.map_qps} · 允许估算：{settings.allow_estimate}")
    print(f"Referer（域名授权时用）：{settings.tencent_map_referer or '未配置'}")
    print(f"本机出口公网 IP：{_public_ip()}   ← IP 白名单要填这个，不是 127.0.0.1")
    print("-" * 60)

    failures = 0
    if not settings.tencent_map_key:
        print("[FAIL] 没有 WebService Key，后端无法取真实通勤时长与 POI")
        print("       在 .env 填写：TENCENT_MAP_KEY=你的WebServiceKey")
        print("       控制台步骤：lbs.qq.com → 控制台 → 应用管理 → 我的应用 → 添加Key")
        print("       → 勾选「WebServiceAPI」并配置授权 IP（这是唯一必需的服务类型）")
        failures += 1
    else:
        client = TencentMapClient(settings)
        for name, run in CHECKS:
            try:
                result = run(client)
                count = len(result) if isinstance(result, list) else len((result or {}).get("data", []) if isinstance(result, dict) else []) or "ok"
                print(f"[PASS] {name} → {count}")
            except MapError as error:
                # 配额类错误（status=120/121）：只要允许降级估算，功能仍然可用，按 WARN 处理
                quota_limited = "status=121" in str(error) or "status=120" in str(error) or "配额" in str(error)
                if quota_limited and settings.allow_estimate:
                    print(f"[WARN] {name} → 该子服务配额不足，已自动改用直线估算（功能可用，界面会标注“估算”）")
                    print(f"      {error}")
                    continue
                print(f"[FAIL] {name}")
                print(f"      {error}")
                if "无来源信息" in str(error) or "status=110" in str(error):
                    print("      ▸ 这个 Key 用的是『域名(Referer)授权』，服务端调用默认不带来源。两种解法：")
                    print("        ① 控制台把该 Key 的授权方式改成「IP 白名单」，把下面这个出口 IP 加进去：")
                    print(f"           出口 IP：{_public_ip()}")
                    print("        ② 保持域名授权，在 .env 填 TENCENT_MAP_REFERER=https://你白名单里的域名")
                failures += 1
            except Exception as error:  # noqa: BLE001
                print(f"[FAIL] {name} → {error}")
                failures += 1

    print(
        "[INFO] 城内地图默认加载腾讯 GL 矢量底图（JS Key，可连续拖拽/缩放）；"
        "没有 JS Key 时自动降级为自建矢量底图，功能完整"
    )
    if settings.tencent_map_js_key:
        print("[PASS] 另已配置 JS Key（矢量地图模式）")

    print("-" * 60)
    if failures:
        print(f"结论：有 {failures} 项未通过，按上面的提示修正后重新运行本脚本")
        return 1
    print("结论：全部通过，重启服务后即可使用真实地图与真实通勤时长")
    return 0


if __name__ == "__main__":
    sys.exit(main())
