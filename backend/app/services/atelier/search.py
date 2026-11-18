from __future__ import annotations

import hashlib
import json
import os
import time
from dataclasses import asdict, dataclass
from pathlib import Path
from urllib.parse import quote

import httpx

from ...config import get_settings

WIKI_API = "https://zh.wikipedia.org/w/api.php"
COMMONS_API = "https://commons.wikimedia.org/w/api.php"
CACHE_DIR = Path(get_settings().atelier_dir) / "cache" / "search"
CACHE_TTL = 24 * 3600
USER_AGENT = "CulturalLeader-Atelier/0.1 (educational demo; contact: local)"


def http_proxy() -> str | None:
    """只选择 httpx 支持的 http(s) 代理。

    本机环境可能把 ALL_PROXY 设成 socks://，httpx 未安装 socks 依赖时会直接报
    Unknown scheme；这里优先使用 HTTPS_PROXY/HTTP_PROXY，跳过 socks。
    """

    for name in ("HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy"):
        value = os.environ.get(name, "").strip()
        if value.startswith(("http://", "https://")):
            return value
    return None


@dataclass(frozen=True)
class SearchHit:
    title: str
    url: str
    publisher: str = ""
    license: str = ""
    summary: str = ""


def _pages(payload: dict) -> list[dict]:
    pages = payload.get("query", {}).get("pages", {})
    if isinstance(pages, dict):
        return [value for value in pages.values() if isinstance(value, dict)]
    if isinstance(pages, list):
        return [value for value in pages if isinstance(value, dict)]
    return []


def _page_url(page: dict, fallback_prefix: str) -> str:
    fullurl = page.get("fullurl")
    if fullurl:
        return str(fullurl)
    return f"{fallback_prefix}{quote(str(page.get('title', '')), safe='')}"


def _search_titles(payload: dict) -> list[str]:
    """list=search 的结果在 query.search，不在 query.pages。"""

    items = payload.get("query", {}).get("search", [])
    if not isinstance(items, list):
        return []
    return [str(item.get("title") or "") for item in items if isinstance(item, dict) and item.get("title")]


def _parse_wikipedia(payload: dict) -> list[SearchHit]:
    hits: list[SearchHit] = []
    for page in _pages(payload):
        title = str(page.get("title") or "").strip()
        if not title:
            continue
        extract = str(page.get("extract") or "").strip()
        hits.append(
            SearchHit(
                title=title,
                url=_page_url(page, "https://zh.wikipedia.org/wiki/"),
                publisher="维基百科",
                summary=extract[:400],
            )
        )
    return hits


def _parse_commons(payload: dict) -> list[SearchHit]:
    hits: list[SearchHit] = []
    for page in _pages(payload):
        title = str(page.get("title") or "").removeprefix("File:").strip()
        if not title:
            continue
        imageinfo = page.get("imageinfo")
        info = imageinfo[0] if isinstance(imageinfo, list) and imageinfo else {}
        metadata = info.get("extmetadata") if isinstance(info, dict) else {}
        license_value = ""
        artist = ""
        if isinstance(metadata, dict):
            license_value = str((metadata.get("LicenseShortName") or {}).get("value") or "")
            artist = str((metadata.get("Artist") or {}).get("value") or "")
        url = str(info.get("descriptionurl") or info.get("url") or "") if isinstance(info, dict) else ""
        hits.append(
            SearchHit(
                title=title,
                url=url or f"https://commons.wikimedia.org/wiki/File:{quote(title, safe='')}",
                publisher="Wikimedia Commons",
                license=license_value,
                summary=(artist[:120] + " · 参考图片") if artist else "参考图片",
            )
        )
    return hits


async def _fetch_json(url: str, params: dict, timeout: float) -> dict:
    async with httpx.AsyncClient(
        timeout=timeout,
        follow_redirects=True,
        trust_env=False,
        proxy=http_proxy(),
        headers={"User-Agent": USER_AGENT},
    ) as client:
        response = await client.get(url, params=params)
        response.raise_for_status()
        return response.json()


def _cache_read(key: str) -> list[SearchHit] | None:
    path = CACHE_DIR / f"{key}.json"
    try:
        if not path.exists() or time.time() - path.stat().st_mtime > CACHE_TTL:
            return None
        payload = json.loads(path.read_text(encoding="utf-8"))
        return [SearchHit(**item) for item in payload]
    except (OSError, ValueError, TypeError):
        return None


def _cache_write(key: str, hits: list[SearchHit]) -> None:
    try:
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        (CACHE_DIR / f"{key}.json").write_text(
            json.dumps([asdict(hit) for hit in hits], ensure_ascii=False),
            encoding="utf-8",
        )
    except OSError:
        pass


async def search_place(query: str, *, limit: int = 3, timeout: float = 4.0) -> list[SearchHit]:
    text = (query or "").strip()
    if not text:
        return []
    key = hashlib.sha1(text.encode("utf-8")).hexdigest()
    cached = _cache_read(key)
    if cached is not None:
        return cached[:limit]

    try:
        search_payload = await _fetch_json(
            WIKI_API,
            {
                "action": "query",
                "list": "search",
                "srsearch": text,
                "srlimit": max(1, min(limit, 5)),
                "format": "json",
                "utf8": 1,
            },
            timeout,
        )
        titles = [title for title in _search_titles(search_payload) if title]
        hits: list[SearchHit] = []
        if titles:
            extract_payload = await _fetch_json(
                WIKI_API,
                {
                    "action": "query",
                    "prop": "extracts|info",
                    "inprop": "url",
                    "exintro": 1,
                    "explaintext": 1,
                    "titles": "|".join(titles[:limit]),
                    "format": "json",
                    "utf8": 1,
                    "redirects": 1,
                },
                timeout,
            )
            hits.extend(_parse_wikipedia(extract_payload))
        if len(hits) < limit:
            commons_payload = await _fetch_json(
                COMMONS_API,
                {
                    "action": "query",
                    "generator": "search",
                    "gsrsearch": text,
                    "gsrnamespace": 6,
                    "gsrlimit": max(1, limit - len(hits)),
                    "prop": "imageinfo",
                    "iiprop": "url|extmetadata",
                    "format": "json",
                    "utf8": 1,
                },
                timeout,
            )
            hits.extend(_parse_commons(commons_payload))
    except Exception:  # noqa: BLE001 外部搜索失败不阻塞造境
        return []

    deduped: list[SearchHit] = []
    seen: set[str] = set()
    for hit in hits:
        if not hit.title or hit.url in seen:
            continue
        seen.add(hit.url)
        deduped.append(hit)
        if len(deduped) >= limit:
            break
    if deduped:
        _cache_write(key, deduped)
    return deduped
