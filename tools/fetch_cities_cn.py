"""生成全国城市清单（前端离线数据）frontend/js/data/cities-cn.js。

优先使用腾讯位置服务「行政区划」接口（需 TENCENT_MAP_KEY）；没有 Key 时退回 DataV 公开数据：
  https://geo.datav.aliyun.com/areas_v3/bound/100000_full.json   （省级）
  https://geo.datav.aliyun.com/areas_v3/bound/<adcode>_full.json （该省地级市，带 center 坐标）

用法：
    python tools/fetch_cities_cn.py                    # 自动选源
    python tools/fetch_cities_cn.py --source datav     # 强制 DataV（无需 Key）
    python tools/fetch_cities_cn.py --source tencent   # 强制腾讯（需 TENCENT_MAP_KEY）
"""

from __future__ import annotations

import argparse
import json
import os
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TARGET = ROOT / "frontend" / "js" / "data" / "cities-cn.js"

DATAV_BASE = "https://geo.datav.aliyun.com/areas_v3/bound"
TENCENT_DISTRICT = "https://apis.map.qq.com/ws/district/v1"

# 直辖市：省级即城市
MUNICIPALITIES = {"110000": "北京市", "120000": "天津市", "310000": "上海市", "500000": "重庆市"}
# 特别行政区同样按城市处理
SAR = {"810000": "香港特别行政区", "820000": "澳门特别行政区"}
# 省会（用于 tier 标注）
PROVINCE_CAPITALS = {
    "河北省": "石家庄市", "山西省": "太原市", "内蒙古自治区": "呼和浩特市", "辽宁省": "沈阳市",
    "吉林省": "长春市", "黑龙江省": "哈尔滨市", "江苏省": "南京市", "浙江省": "杭州市",
    "安徽省": "合肥市", "福建省": "福州市", "江西省": "南昌市", "山东省": "济南市",
    "河南省": "郑州市", "湖北省": "武汉市", "湖南省": "长沙市", "广东省": "广州市",
    "广西壮族自治区": "南宁市", "海南省": "海口市", "四川省": "成都市", "贵州省": "贵阳市",
    "云南省": "昆明市", "西藏自治区": "拉萨市", "陕西省": "西安市", "甘肃省": "兰州市",
    "青海省": "西宁市", "宁夏回族自治区": "银川市", "新疆维吾尔自治区": "乌鲁木齐市",
    "台湾省": "台北市",
}
# 计划单列市
SUB_PROVINCIAL = {"大连市", "青岛市", "宁波市", "厦门市", "深圳市"}


def download(url: str, timeout: int = 60) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": "CulturalLeader/0.1"})
    with urllib.request.urlopen(request, timeout=timeout) as response:  # noqa: S310
        return response.read()


def tier_of(name: str, province: str, adcode: str) -> str:
    if adcode in MUNICIPALITIES:
        return "municipality"
    if adcode in SAR:
        return "sar"
    if name in SUB_PROVINCIAL:
        return "subprovincial"
    if PROVINCE_CAPITALS.get(province) == name:
        return "capital"
    return "prefecture"


def fetch_datav() -> list[dict]:
    provinces = json.loads(download(f"{DATAV_BASE}/100000_full.json"))["features"]
    cities: list[dict] = []
    for feature in provinces:
        props = feature["properties"]
        adcode = str(props.get("adcode") or "")
        name = props.get("name") or ""
        if not adcode or not name:
            continue
        if adcode in MUNICIPALITIES or adcode in SAR:
            center = props.get("center") or props.get("centroid")
            if center:
                cities.append(
                    {
                        "adcode": adcode,
                        "name": name,
                        "province": name if adcode in MUNICIPALITIES else name,
                        "lng": float(center[0]),
                        "lat": float(center[1]),
                        "tier": tier_of(name, name, adcode),
                    }
                )
            continue
        try:
            detail = json.loads(download(f"{DATAV_BASE}/{adcode}_full.json"))
        except Exception as error:  # noqa: BLE001
            print(f"  [跳过] {name} {adcode}：{error}")
            continue
        for child in detail.get("features", []):
            child_props = child["properties"]
            if child_props.get("level") not in {"city"}:
                continue
            center = child_props.get("center") or child_props.get("centroid")
            if not center:
                continue
            child_name = child_props.get("name") or ""
            cities.append(
                {
                    "adcode": str(child_props.get("adcode") or ""),
                    "name": child_name,
                    "province": name,
                    "lng": float(center[0]),
                    "lat": float(center[1]),
                    "tier": tier_of(child_name, name, str(child_props.get("adcode") or "")),
                }
            )
        print(f"  {name}: 累计 {len(cities)} 城")
        time.sleep(0.15)
    return cities


def fetch_tencent(key: str) -> list[dict]:
    """腾讯位置服务行政区划：先取省级列表，再逐省取下级（地级市）。"""
    provinces = json.loads(download(f"{TENCENT_DISTRICT}/list?key={key}"))
    if provinces.get("status") != 0:
        raise SystemExit(f"腾讯返回错误：{provinces.get('message')}（status={provinces.get('status')}）")
    cities: list[dict] = []
    groups = provinces.get("result") or []
    for province in groups[0] if groups else []:
        province_name = province.get("fullname") or province.get("name") or ""
        children = json.loads(download(f"{TENCENT_DISTRICT}/getchildren?key={key}&id={province.get('id')}"))
        for child in (children.get("result") or [[]])[0]:
            location = child.get("location") or {}
            name = child.get("fullname") or child.get("name") or ""
            if not location:
                continue
            cities.append(
                {
                    "adcode": str(child.get("id") or ""),
                    "name": name,
                    "province": province_name,
                    "lng": float(location.get("lng")),
                    "lat": float(location.get("lat")),
                    "tier": tier_of(name, province_name, str(child.get("id") or "")),
                }
            )
        time.sleep(0.1)
    return cities


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", default="auto", choices=("auto", "datav", "tencent"))
    args = parser.parse_args()

    key = (os.environ.get("TENCENT_MAP_KEY") or "").strip()
    source = args.source
    if source == "auto":
        source = "tencent" if key else "datav"
    print(f"[cities] 数据源：{source}")

    cities = fetch_tencent(key) if source == "tencent" else fetch_datav()

    seen = set()
    unique: list[dict] = []
    for city in cities:
        if city["adcode"] in seen or not city["name"]:
            continue
        seen.add(city["adcode"])
        unique.append(city)
    unique.sort(key=lambda item: (item["province"], item["name"]))

    TARGET.parent.mkdir(parents=True, exist_ok=True)
    body = json.dumps(unique, ensure_ascii=False, separators=(",", ":"))
    TARGET.write_text(
        "// 由 tools/fetch_cities_cn.py 生成：全国地级市（名称/省份/中心坐标/层级）。\n"
        "// tier: municipality 直辖市 · sar 特别行政区 · subprovincial 计划单列市 · capital 省会 · prefecture 地级市\n"
        f"export const CITIES_CN = {body};\n",
        encoding="utf-8",
    )
    print(f"[cities] 共 {len(unique)} 城 -> {TARGET.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
