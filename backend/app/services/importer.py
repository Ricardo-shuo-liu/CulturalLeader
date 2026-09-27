"""攻略导入（抄作业）：链接 / 正文 / 截图 → 解析成「一城一天」的计划块 + 草稿攻略。

设计要点：
- 抓取只用 httpx + 正则启发式提取正文，不引入额外依赖；小红书/抖音这类强反爬站点
  抓不到正文时，由前端引导用户改用「粘贴正文」或「上传截图」。
- 解析引擎两级：配了 OPENAI_API_KEY 走大模型（文本与截图都支持）；否则走规则解析。
  模型返回非法 JSON 会自动降级到规则解析，并在结果里标注 engine。
- 地点定位用腾讯 POI 搜索：置信度达标 = confirmed（有坐标），否则 = pending（待定位，
  保留名称与序号，前端在真实地图上点一下就落位）。
"""

from __future__ import annotations

import base64
import html as html_module
import json
import os
import re
import uuid
from datetime import datetime
from difflib import SequenceMatcher
from pathlib import Path
from urllib.parse import urlparse

import httpx

from ..config import get_settings
from .tencent_map import MapError, TencentMapClient

IMPORT_PREFIX = "imp-"
USER_AGENT = "Mozilla/5.0 (compatible; CulturalLeader/0.1; +local)"
MAX_HTML_BYTES = 3_000_000
DEFAULT_DWELL = 60
MATCH_THRESHOLD = 0.62


class ImportError_(RuntimeError):
    """导入失败基类。"""


class ImportFetchFailed(ImportError_):
    pass


class ImportKeyMissing(ImportError_):
    pass


class ImportParseFailed(ImportError_):
    pass


class ImportNotFound(FileNotFoundError):
    pass


def imports_dir() -> Path:
    path = Path(get_settings().imports_dir)
    path.mkdir(parents=True, exist_ok=True)
    return path


def import_path(import_id: str) -> Path:
    safe = "".join(ch for ch in str(import_id) if ch.isalnum() or ch in "-_")
    if not safe.startswith(IMPORT_PREFIX):
        raise ImportNotFound("导入 id 非法")
    return imports_dir() / f"{safe}.json"


def new_id() -> str:
    return f"{IMPORT_PREFIX}{datetime.now().strftime('%Y%m%d')}-{uuid.uuid4().hex[:6]}"


def _now() -> str:
    return datetime.now().isoformat(timespec="seconds")


def save_import(payload: dict) -> dict:
    payload = dict(payload)
    payload.setdefault("id", new_id())
    payload["updated_at"] = _now()
    payload.setdefault("created_at", payload["updated_at"])
    path = import_path(payload["id"])
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(tmp, path)
    return payload


def load_import(import_id: str) -> dict:
    path = import_path(import_id)
    if not path.exists():
        raise ImportNotFound(f"导入记录不存在：{import_id}")
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        raise ImportNotFound(f"导入记录损坏：{import_id}") from error


def delete_import(import_id: str) -> None:
    path = import_path(import_id)
    if path.exists():
        path.unlink()


def list_imports() -> list[dict]:
    items: list[dict] = []
    for path in sorted(imports_dir().glob(f"{IMPORT_PREFIX}*.json")):
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            continue
        days = payload.get("days") or []
        items.append(
            {
                "id": payload.get("id"),
                "title": payload.get("title") or "未命名导入",
                "source": payload.get("source") or "text",
                "url": payload.get("url") or "",
                "engine": payload.get("engine") or "",
                "days": len(days),
                "places": sum(len(day.get("places") or []) for day in days),
                "pending": sum(
                    1 for day in days for place in (day.get("places") or []) if place.get("status") == "pending"
                ),
                "committed": bool(payload.get("committed")),
                "updated_at": payload.get("updated_at"),
            }
        )
    items.sort(key=lambda item: item.get("updated_at") or "", reverse=True)
    return items


# ───────────────────────── 抓取与正文提取 ─────────────────────────

BLOCK_TAGS = re.compile(
    r"<(script|style|noscript|svg|iframe|nav|header|footer|aside|form)[^>]*>.*?</\1>", re.S | re.I
)
TAG = re.compile(r"<[^>]+>")
BREAK = re.compile(r"</?(p|div|br|li|h[1-6]|tr|section|article)[^>]*>", re.I)


def html_to_text(raw: str) -> tuple[str, str]:
    """返回 (标题, 正文纯文本)。启发式：优先公众号正文容器，其次 article，最后整页文字。"""
    title = ""
    match = re.search(r"<title[^>]*>(.*?)</title>", raw, re.S | re.I)
    if match:
        title = html_module.unescape(TAG.sub("", match.group(1))).strip()

    body = BLOCK_TAGS.sub(" ", raw)
    for pattern in (
        r'<div[^>]+id="js_content"[^>]*>(.*?)</div>\s*</div>',
        r"<article[^>]*>(.*?)</article>",
        r'<div[^>]+class="[^"]*(?:rich_media_content|article-content|post-content|content)[^"]*"[^>]*>(.*?)</div>',
    ):
        found = re.search(pattern, body, re.S | re.I)
        if found and len(TAG.sub("", found.group(1))) > 120:
            body = found.group(1)
            break
        # 很多页面 <article> 没有闭合标签：直接取到文末
        opened = re.search(r"<(?:article|div)[^>]*(?:id|class)=\"[^\"]*(?:js_content|rich_media_content|article-content|post-content)[^\"]*\"[^>]*>", body, re.I)
        if opened:
            body = body[opened.end():]
            break
    text = BREAK.sub("\n", body)
    text = TAG.sub("", text)
    text = html_module.unescape(text)
    text = re.sub(r"[ \t\u3000]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return title.strip(), text.strip()


def fetch_url(url: str) -> tuple[str, str]:
    """抓取链接并提取正文；失败抛 ImportFetchFailed（前端据此引导粘贴/截图）。"""
    target = str(url or "").strip()
    if not re.match(r"^https?://", target, re.I):
        raise ImportFetchFailed("链接需要以 http(s):// 开头")
    host = urlparse(target).netloc.lower()
    if host.endswith("xiaohongshu.com") or host.endswith("douyin.com"):
        raise ImportFetchFailed(
            "小红书/抖音的正文需要登录才可见，服务端抓不到；请用「粘贴正文」或「上传截图」导入"
        )
    try:
        response = httpx.get(
            target,
            headers={"User-Agent": USER_AGENT, "Accept-Language": "zh-CN,zh;q=0.9"},
            timeout=15,
            follow_redirects=True,
        )
        response.raise_for_status()
    except Exception as error:  # noqa: BLE001
        raise ImportFetchFailed(f"抓取失败：{error}；可以改用「粘贴正文」或「上传截图」") from error
    raw = response.text[:MAX_HTML_BYTES]
    title, text = html_to_text(raw)
    if len(text) < 80:
        raise ImportFetchFailed("这个链接的正文几乎抓不到（可能是动态渲染页面），请改用「粘贴正文」或「上传截图」")
    return title, text


# ───────────────────────── 规则解析 ─────────────────────────

DAY_RE = re.compile(r"(?:day\s*0?(\d{1,2})|d\s*0?(\d{1,2})|第\s*([一二三四五六七八九十0-9]{1,3})\s*天)", re.I)
TIME_HINTS = [
    ("清晨", "07:30"),
    ("早上", "08:30"),
    ("上午", "09:00"),
    ("中午", "12:00"),
    ("午餐", "12:00"),
    ("下午", "14:00"),
    ("傍晚", "17:30"),
    ("晚餐", "18:30"),
    ("晚上", "19:30"),
    ("夜里", "21:00"),
]
EXPLICIT_TIME = re.compile(r"(\d{1,2})\s*[:：]\s*(\d{2})")
DWELL_RE = re.compile(r"(?:玩|逛|停留|游览|约|大约)?\s*(\d{1,3})\s*(分钟|min|小时|h)", re.I)
BULLET_RE = re.compile(r"^\s*(?:[-–—*•·∙●○▪️◆▶→>]+|\d{1,2}[.、)）]|[（(]\d{1,2}[)）])\s*")
NOISE_RE = re.compile(
    r"(攻略|收藏|关注|点赞|评论|转发|链接|原文|来源|版权|合作|广告|投稿|拍|出片|机位|穿搭|人均|消费|门票|价格|"
    r"注意|建议|小贴士|tips?|day|行程|路线|安排|住宿|酒店|民宿|交通|地铁|公交|打车|自驾|机场|高铁|车站|"
    r"评论区|主页|更多|合集|未完|待续)",
    re.I,
)
EMOJI_RE = re.compile(
    "[\U0001f300-\U0001faff\U00002600-\U000027bf\U0001f1e6-\U0001f1ff\ufe0f\u2764\u2b50\u2705\u2714\u274c\u2757]"
)


def _clean(text: str) -> str:
    text = EMOJI_RE.sub(" ", str(text or ""))
    text = text.replace("｜", "|").replace("　", " ")
    return re.sub(r"\s{2,}", " ", text).strip()


def _cn_number(token: str) -> int | None:
    if token.isdigit():
        return int(token)
    digits = {"一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9, "十": 10}
    if token == "十":
        return 10
    if token.startswith("十") and len(token) == 2:
        return 10 + digits.get(token[1], 0)
    if token.endswith("十") and len(token) == 2:
        return digits.get(token[0], 0) * 10
    if len(token) == 3 and token[1] == "十":
        return digits.get(token[0], 0) * 10 + digits.get(token[2], 0)
    return digits.get(token)


def _day_of(line: str) -> int | None:
    match = DAY_RE.search(line)
    if not match:
        return None
    for group in match.groups():
        if not group:
            continue
        value = _cn_number(group) if not group.isdigit() else int(group)
        if value and 1 <= value <= 30:
            return value
    return None


def _time_of(line: str) -> str | None:
    explicit = EXPLICIT_TIME.search(line)
    if explicit:
        hour, minute = int(explicit.group(1)), int(explicit.group(2))
        if 0 <= hour <= 23 and 0 <= minute <= 59:
            return f"{hour:02d}:{minute:02d}"
    for hint, value in TIME_HINTS:
        if hint in line:
            return value
    return None


def _dwell_of(line: str) -> int | None:
    match = DWELL_RE.search(line)
    if not match:
        return None
    value = int(match.group(1))
    unit = match.group(2).lower()
    minutes = value * 60 if unit.startswith("小时") or unit == "h" else value
    return max(15, min(600, minutes))


def _split_candidates(line: str) -> list[str]:
    parts = re.split(r"[·•∙・、,，;；/|]+|\s+[-–—]\s+|→|->|-->", line)
    return [_clean(BULLET_RE.sub("", part)) for part in parts]


def _looks_like_place(token: str) -> bool:
    if not token or len(token) < 2 or len(token) > 16:
        return False
    if not re.search(r"[\u4e00-\u9fa5]", token):
        return False
    if _day_of(token):
        return False
    if NOISE_RE.search(token):
        return False
    if re.fullmatch(r"[\d\s.、()（）]+", token):
        return False
    return True


def _city_hints() -> list[dict]:
    """可识别的城市清单（复用全国城市数据）。"""
    try:
        from ..routers.geo import _load_cities

        return _load_cities()
    except Exception:  # noqa: BLE001
        return []


def _detect_city(line: str, cities: list[dict]) -> str | None:
    for city in cities:
        name = str(city.get("name") or "").replace("市", "")
        if len(name) >= 2 and name in line:
            return str(city.get("name"))
    return None


def rule_parse(text: str, *, fallback_city: str = "") -> dict:
    """规则解析：按 Day / 时间桶 / 项目符号切出「天 → 地点」。"""
    cities = _city_hints()
    lines = [line for line in re.split(r"[\n\r]+", _clean_multi(text)) if line.strip()]
    days: dict[int, dict] = {}
    current_day = 1
    current_time: str | None = None
    day_city: dict[int, str] = {}
    overall_city = ""
    for line in lines:
        detected_day = _day_of(line)
        if detected_day:
            current_day = detected_day
            line = DAY_RE.sub(" ", line)
        detected_city = _detect_city(line, cities)
        if detected_city:
            day_city[current_day] = detected_city
            overall_city = overall_city or detected_city
        if detected_day is None:
            bucket = _time_of(line)
            if bucket and (len(line) <= 8 or re.match(r"^\s*[（(]?\s*\d{1,2}[:：]?\d{0,2}", line)):
                current_time = bucket
        for token in _split_candidates(line):
            token = _clean(token)
            # 先把粘在名字前/后的时间词摘掉：「上午 钟楼」「陕西历史博物馆 上午」
            token_time = None
            for hint, value in TIME_HINTS:
                if token.startswith(hint):
                    token_time = token_time or value
                    token = _clean(token[len(hint):])
                if token.endswith(hint):
                    token_time = token_time or value
                    token = _clean(token[: -len(hint)])
            if not _looks_like_place(token):
                continue
            time_value = _time_of(token) or token_time or current_time
            dwell = _dwell_of(token) or DEFAULT_DWELL
            name = _clean(re.sub(r"\d{1,2}\s*[:：]\s*\d{2}", "", token))
            name = _clean(DWELL_RE.sub(" ", name))
            name = _clean(re.sub(r"[（(][^）)]{0,12}[）)]\s*$", "", name))
            # 去掉「西安 钟楼」这类前缀城市名，但保留「西安城墙」这种本身就是景点名的写法
            if detected_city:
                short = detected_city.replace("市", "")
                name = _clean(re.sub(rf"^{re.escape(short)}\s+", "", name))
            name = _clean(re.sub(rf"(?:^|\s)(?:{'|'.join(hint for hint, _ in TIME_HINTS)})(?=\s|$)", " ", name))
            name = _clean(re.sub(r"^(?:打卡|游玩|游览|去|到|逛一逛|逛)", "", name))
            if not _looks_like_place(name):
                continue
            bucket = days.setdefault(current_day, {"day": current_day, "city": "", "places": []})
            if day_city.get(current_day):
                bucket["city"] = day_city[current_day]
            bucket["places"].append(
                {
                    "name": name,
                    "time": time_value or "",
                    "dwell_minutes": dwell,
                    "note": "",
                    "lng": None,
                    "lat": None,
                    "poi_id": "",
                    "confidence": 0.0,
                    "status": "pending",
                    "candidates": [],
                }
            )
    items = []
    for index, day in enumerate(sorted(days.values(), key=lambda item: item["day"]), start=1):
        day["day"] = index
        day["city"] = day.get("city") or fallback_city or overall_city or ""
        # 同一天内按出现顺序去重
        seen = set()
        unique = []
        for place in day["places"]:
            key = place["name"]
            if key in seen:
                continue
            seen.add(key)
            unique.append(place)
        day["places"] = unique
        if unique:
            items.append(day)
    return {"days": items, "engine": "rule"}


def _clean_multi(text: str) -> str:
    return EMOJI_RE.sub(" ", str(text or ""))


# ───────────────────────── 大模型解析（可选） ─────────────────────────

LLM_PROMPT = """你在帮旅行者把别人写的攻略整理成可编辑的行程清单。
只输出 JSON，不要任何解释。结构如下：
{"title": "标题", "days": [{"day": 1, "city": "城市名", "places": [{"name": "地点名", "time": "09:00", "dwell_minutes": 90, "note": "可选备注"}]}]}
要求：
1. day 从 1 开始连续编号；原文没有分天就全部放在 day 1。
2. city 用中文城市名（如「西安」）；分不清就留空字符串。
3. places 只保留可在地图上定位的地点（景点、街区、餐厅、车站、酒店），按原文顺序，不要编造。
4. time 用 24 小时制 HH:MM，原文没有就留空；dwell_minutes 是建议停留分钟，默认 60。
5. 去掉营销话术、表情、话题标签。"""


async def llm_parse_text(text: str, *, model: str) -> dict:
    from openai import AsyncOpenAI

    settings = get_settings()
    client = AsyncOpenAI(api_key=settings.openai_api_key, base_url=settings.base_url)
    payload = f"以下是攻略原文：\n\n{text[:12000]}"
    last_error: Exception | None = None
    for attempt in range(2):
        try:
            response = await client.chat.completions.create(
                model=model,
                messages=[
                    {"role": "system", "content": LLM_PROMPT},
                    {"role": "user", "content": payload if attempt == 0 else payload + "\n\n只输出 JSON。"},
                ],
                temperature=0.2,
                max_tokens=2000,
            )
            content = response.choices[0].message.content or "{}"
            data = json.loads(_extract_json(content))
            return {"title": str(data.get("title") or ""), "days": data.get("days") or [], "engine": "llm"}
        except Exception as error:  # noqa: BLE001
            last_error = error
    raise ImportParseFailed(f"模型解析失败：{last_error}") from last_error


async def llm_parse_images(images: list[tuple[bytes, str]], *, model: str) -> dict:
    from openai import AsyncOpenAI

    settings = get_settings()
    client = AsyncOpenAI(api_key=settings.openai_api_key, base_url=settings.base_url)
    content: list[dict] = [{"type": "text", "text": "请把这几张攻略截图里的行程整理成 JSON（结构见系统提示）。"}]
    for data, mime in images[:4]:
        encoded = base64.b64encode(data).decode("ascii")
        content.append({"type": "image_url", "image_url": {"url": f"data:{mime or 'image/png'};base64,{encoded}"}})
    response = await client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": LLM_PROMPT},
            {"role": "user", "content": content},
        ],
        temperature=0.2,
        max_tokens=2000,
    )
    data = json.loads(_extract_json(response.choices[0].message.content or "{}"))
    return {"title": str(data.get("title") or ""), "days": data.get("days") or [], "engine": "llm"}


def _extract_json(text: str) -> str:
    match = re.search(r"\{.*\}", text, re.S)
    return match.group(0) if match else text


def normalize_days(raw_days: list[dict], *, fallback_city: str = "") -> list[dict]:
    """把任意来源的 days 结构规整成统一形状。"""
    result: list[dict] = []
    for index, day in enumerate(raw_days or [], start=1):
        if not isinstance(day, dict):
            continue
        places = []
        for raw in day.get("places") or []:
            if isinstance(raw, str):
                raw = {"name": raw}
            if not isinstance(raw, dict):
                continue
            name = _clean(raw.get("name") or "")
            if not name:
                continue
            places.append(
                {
                    "name": name,
                    "time": str(raw.get("time") or ""),
                    "dwell_minutes": int(raw.get("dwell_minutes") or DEFAULT_DWELL),
                    "note": _clean(raw.get("note") or ""),
                    "lng": raw.get("lng"),
                    "lat": raw.get("lat"),
                    "poi_id": str(raw.get("poi_id") or ""),
                    "confidence": float(raw.get("confidence") or 0),
                    "status": raw.get("status") if raw.get("status") in {"confirmed", "pending"} else "pending",
                    "candidates": raw.get("candidates") or [],
                }
            )
        if not places:
            continue
        result.append(
            {
                "day": index,
                "city": _clean(day.get("city") or "") or fallback_city,
                "places": places,
            }
        )
    return result


# ───────────────────────── 地点定位 ─────────────────────────

TYPE_HINTS = {
    "景点": ("风景", "公园", "寺庙", "古迹", "博物馆", "展览", "教堂", "广场", "塔", "山", "湖"),
    "美食": ("餐厅", "小吃", "美食", "火锅", "面馆", "咖啡", "茶"),
    "交通": ("车站", "机场", "地铁", "港口"),
    "住宿": ("酒店", "宾馆", "民宿", "公寓"),
}


def _similarity(a: str, b: str) -> float:
    left = re.sub(r"[^\u4e00-\u9fa5A-Za-z0-9]", "", a or "")
    right = re.sub(r"[^\u4e00-\u9fa5A-Za-z0-9]", "", b or "")
    if not left or not right:
        return 0.0
    if left in right or right in left:
        return 0.92
    return SequenceMatcher(None, left, right).ratio()


def _city_info(name: str) -> dict:
    for city in _city_hints():
        if str(city.get("name") or "").replace("市", "") == str(name or "").replace("市", "") and name:
            return {
                "name": city.get("name") or name,
                "province": city.get("province") or "",
                "adcode": city.get("adcode") or "",
                "lng": city.get("lng"),
                "lat": city.get("lat"),
            }
    return {"name": name or "", "province": "", "adcode": "", "lng": None, "lat": None}


def commit_import(payload: dict, *, client: TencentMapClient | None = None) -> dict:
    """把导入结果落成计划块（一城一天一个 flow）+ 一份草稿攻略。"""
    from . import flow_store, guide_builder, guide_store

    title = str(payload.get("title") or "导入攻略").strip()
    days = payload.get("days") or []
    source = {
        "import_id": payload.get("id"),
        "url": payload.get("url") or "",
        "title": title,
        "captured_at": payload.get("created_at") or _now(),
        "engine": payload.get("engine") or "",
    }
    items: list[dict] = []
    created: list[dict] = []
    for day in days:
        groups: dict[str, list[dict]] = {}
        for place in day.get("places") or []:
            city = str(place.get("city") or "").strip() or str(day.get("city") or "").strip()
            groups.setdefault(city, []).append(place)
        for city, places in groups.items():
            info = _city_info(city)
            name = f"{title} · 第{day.get('day')}天 {info['name'] or '未定城市'}"
            flow = flow_store.empty_flow(info, name[:60])
            points = []
            for index, place in enumerate(places, start=1):
                points.append(
                    {
                        "id": flow_store.new_point_id(),
                        "poi_id": place.get("poi_id") or "",
                        "name": place.get("name") or f"地点{index}",
                        "lng": place.get("lng"),
                        "lat": place.get("lat"),
                        "address": (place.get("candidates") or [{}])[0].get("address", "") if place.get("candidates") else "",
                        "open_time": "",
                        "dwell_minutes": int(place.get("dwell_minutes") or DEFAULT_DWELL),
                        "fixed_time": place.get("time") or None,
                        "locked": False,
                        "status": "confirmed" if place.get("status") == "confirmed" and place.get("lng") is not None else "pending",
                        "note": place.get("note") or "",
                    }
                )
            flow["points"] = points
            flow["source"] = source
            if points:
                first = next((point for point in points if point.get("lng") is not None), None)
                anchor = first or {"lng": info.get("lng"), "lat": info.get("lat")}
                if anchor.get("lng") is not None:
                    flow["start"] = {
                        "name": "出发点",
                        "lng": anchor["lng"],
                        "lat": anchor["lat"],
                        "time": flow.get("day_start") or "09:00",
                    }
            saved = flow_store.save_flow(flow)
            created.append({"id": saved["id"], "day": int(day.get("day") or 1), "city": info["name"]})
            items.append({"day": int(day.get("day") or 1), "flowId": saved["id"], "notes": ""})
    if not items:
        raise ImportParseFailed("没有可生成的点位")
    guide = guide_builder.build_guide(f"{title}（导入）", items, client=client)
    saved_guide = guide_store.save_guide(guide)
    return {"flows": created, "guideId": saved_guide["id"]}


def resolve_places(days: list[dict], *, client: TencentMapClient | None = None) -> dict:
    """把地点名解析成坐标：置信度达标 = confirmed，否则保留候选并标为 pending。"""
    active = client or TencentMapClient()
    degraded = False
    for day in days:
        city = day.get("city") or ""
        for place in day.get("places") or []:
            if place.get("status") == "confirmed" and place.get("lng") is not None:
                continue
            try:
                items = active.poi_search(place["name"], city=city, offset=5)
            except MapError:
                degraded = True
                items = []
            scored = []
            for item in items:
                score = _similarity(place["name"], item.get("name") or "")
                category = str(item.get("type") or "")
                if category:
                    score = min(1.0, score + 0.02)
                scored.append((score, item))
            scored.sort(key=lambda pair: pair[0], reverse=True)
            place["candidates"] = [
                {
                    "name": item.get("name") or "",
                    "address": item.get("address") or "",
                    "lng": item.get("lng"),
                    "lat": item.get("lat"),
                    "poi_id": item.get("poi_id") or "",
                    "score": round(score, 3),
                }
                for score, item in scored[:3]
            ]
            if scored and scored[0][0] >= MATCH_THRESHOLD:
                best = scored[0][1]
                place.update(
                    {
                        "lng": best.get("lng"),
                        "lat": best.get("lat"),
                        "poi_id": best.get("poi_id") or "",
                        "confidence": round(scored[0][0], 3),
                        "status": "confirmed",
                    }
                )
            else:
                place.update({"confidence": round(scored[0][0], 3) if scored else 0.0, "status": "pending"})
    return {"days": days, "degraded": degraded}

