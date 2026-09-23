"""截图像素统计：用同一真实地点在不同时刻的明暗变化，验证晨昏线随时间扫过。

取样点由 tools/browser_check.py 通过页面内的投影函数导出（points.json），
因此比较的是真实经纬度位置的画面，而不是固定屏幕区域。
"""

from __future__ import annotations

import json
import statistics
import sys
from pathlib import Path

from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "tests_artifacts"
HALF_BOX = 46


def sample(path: Path, point: dict, scale: tuple[float, float]) -> dict:
    image = Image.open(path).convert("RGB")
    cx = point["x"] * scale[0]
    cy = point["y"] * scale[1]
    box = (int(cx - HALF_BOX), int(cy - HALF_BOX), int(cx + HALF_BOX), int(cy + HALF_BOX))
    crop = image.crop(box).resize((60, 60))
    pixels = list(crop.getdata())
    luma = statistics.fmean(0.299 * r + 0.587 * g + 0.114 * b for r, g, b in pixels)
    warmth = statistics.fmean(r for r, _, _ in pixels) - statistics.fmean(b for _, _, b in pixels)
    return {"luma": luma, "warmth": warmth}


def main() -> int:
    points_path = OUT / "points.json"
    if not points_path.exists():
        print("缺少 points.json，请先运行 tools/browser_check.py")
        return 1
    points = json.loads(points_path.read_text(encoding="utf-8"))

    reference = Image.open(OUT / "01_dawn_0630.png")
    scale = (reference.width / points["east"]["width"], reference.height / points["east"]["height"])

    dawn_east = sample(OUT / "01_dawn_0630.png", points["east"], scale)
    dawn_west = sample(OUT / "01_dawn_0630.png", points["west"], scale)
    night_east = sample(OUT / "02_night_2300.png", points["east"], scale)
    night_west = sample(OUT / "02_night_2300.png", points["west"], scale)
    noon_east = sample(OUT / "03_noon_1200.png", points["east"], scale)
    noon_west = sample(OUT / "03_noon_1200.png", points["west"], scale)

    print(f"上海附近（121.5E,31.2N）：黎明 {dawn_east['luma']:.1f} / 正午 {noon_east['luma']:.1f} / 夜间 {night_east['luma']:.1f}")
    print(f"天山附近（85.0E,41.5N）：黎明 {dawn_west['luma']:.1f} / 正午 {noon_west['luma']:.1f} / 夜间 {night_west['luma']:.1f}")
    print(f"暖度：上海 黎明{dawn_east['warmth']:+.1f} 夜间{night_east['warmth']:+.1f} | 天山 黎明{dawn_west['warmth']:+.1f} 夜间{night_west['warmth']:+.1f}")

    delta_dawn_east = dawn_east["luma"] - night_east["luma"]
    delta_dawn_west = dawn_west["luma"] - night_west["luma"]
    delta_noon_east = noon_east["luma"] - night_east["luma"]
    delta_noon_west = noon_west["luma"] - night_west["luma"]
    warmth_gain_east = dawn_east["warmth"] - night_east["warmth"]

    print(f"相对夜间的增亮：黎明 东 {delta_dawn_east:+.1f} 西 {delta_dawn_west:+.1f} | 正午 东 {delta_noon_east:+.1f} 西 {delta_noon_west:+.1f}")
    print(f"黎明东侧暖度增量：{warmth_gain_east:+.1f}")

    failures: list[str] = []
    if delta_dawn_east < 5:
        failures.append(f"06:30 时东部应已见晨光：相对夜间仅增亮 {delta_dawn_east:+.1f}")
    if delta_dawn_east - delta_dawn_west < 5:
        failures.append(
            f"同一时刻东西差异不足（东 {delta_dawn_east:+.1f} 西 {delta_dawn_west:+.1f}），晨昏线未体现"
        )
    if delta_noon_east < 6 or delta_noon_west < 6:
        failures.append(f"正午两地都应显著增亮：东 {delta_noon_east:+.1f} 西 {delta_noon_west:+.1f}")
    if warmth_gain_east < 1.0:
        failures.append(f"黎明东侧应偏暖，实际暖度增量 {warmth_gain_east:+.1f}")

    # 国境描边可见性：地图区域内应有明显数量的高亮线与边缘
    map_view = Image.open(OUT / "03_noon_1200.png").convert("L")
    width, height = map_view.size
    crop = map_view.crop((int(width * 0.22), int(height * 0.18), int(width * 0.78), int(height * 0.92)))
    values = list(crop.getdata())
    bright_pixels = sum(1 for value in values if value > 110)
    strong_edges = sum(1 for value in crop.filter(ImageFilter.FIND_EDGES).getdata() if value > 40)
    print(f"地图区域：高亮像素 {bright_pixels}，强边缘像素 {strong_edges}")
    if bright_pixels < 1500:
        failures.append(f"国境描边不明显：高亮像素仅 {bright_pixels}")
    if strong_edges < 3000:
        failures.append(f"地图层次不足：强边缘像素仅 {strong_edges}")

    # 极端视角下不应出现大片纯黑（地面 / 幕布 / 天穹必须覆盖视野）
    extreme = Image.open(OUT / "05_extreme_view.png").convert("L").resize((220, 124))
    extreme_values = list(extreme.getdata())
    black_ratio = sum(1 for value in extreme_values if value < 3) / len(extreme_values)
    print(f"极端视角：纯黑占比 {black_ratio * 100:.1f}%")
    if black_ratio > 0.1:
        failures.append(f"极端视角仍有大片纯黑：{black_ratio * 100:.1f}%")

    # 沙盘四周应有壁画内容（不是纯黑空场）
    ring = Image.open(OUT / "03_noon_1200.png").convert("L")
    rw, rh = ring.size
    ring_crop = ring.crop((int(rw * 0.04), int(rh * 0.62), int(rw * 0.96), int(rh * 0.99)))
    ring_values = list(ring_crop.resize((160, 60)).getdata())
    ring_mean = statistics.fmean(ring_values)
    ring_std = statistics.pstdev(ring_values)
    print(f"四周壁画带：均值 {ring_mean:.1f} 标准差 {ring_std:.1f}")
    if ring_mean < 4 or ring_std < 3:
        failures.append(f"沙盘四周过于空旷：均值 {ring_mean:.1f} 标准差 {ring_std:.1f}")

    # 路线图：地图区域应出现金色航线
    route_image = Image.open(OUT / "06_route.png").convert("RGB")
    rw, rh = route_image.size
    route_crop = route_image.crop((int(rw * 0.1), int(rh * 0.2), int(rw * 0.9), int(rh * 0.95)))
    route_values = list(route_crop.resize((240, 150)).getdata())
    gold_pixels = sum(1 for r, g, b in route_values if r > 120 and r - b > 35 and g > 90)
    print(f"路线金色像素：{gold_pixels}")
    if gold_pixels < 120:
        failures.append(f"地图上没有画出金色航线：{gold_pixels}")

    # 沙盘两侧应有暖色壁画（敦煌土红），不能被地面光池盖成冷色
    mural = Image.open(OUT / "03_noon_1200.png").convert("RGB")
    mw, mh = mural.size
    warm_total = 0
    warm_all = 0
    for box in ((int(mw * 0.02), int(mh * 0.35), int(mw * 0.22), int(mh * 0.95)),
                (int(mw * 0.78), int(mh * 0.35), int(mw * 0.98), int(mh * 0.95))):
        pixels = list(mural.crop(box).resize((100, 60)).getdata())
        warm_total += sum(1 for r, g, b in pixels if r > b + 8 and r > 40)
        warm_all += len(pixels)
    warm_ratio = warm_total / max(warm_all, 1)
    print(f"沙盘两侧壁画暖色占比：{warm_ratio * 100:.0f}%")
    if warm_ratio < 0.25:
        failures.append(f"沙盘周围看不到壁画：暖色占比仅 {warm_ratio * 100:.0f}%")

    opened = Image.open(OUT / "04_shanghai_opened.png").convert("L").resize((200, 140))
    data = list(opened.getdata())
    mean = statistics.fmean(data)
    contrast = statistics.pstdev(data)
    print(f"拉开幕布后：均值 {mean:.1f} 对比度 {contrast:.1f}")
    if mean < 25 or contrast < 12:
        failures.append(f"内场地标场景应清晰可读：均值 {mean:.1f} 对比度 {contrast:.1f}")

    if failures:
        print("\n未通过：")
        for item in failures:
            print(f" - {item}")
        return 1
    print("\n画面统计验证通过")
    return 0


if __name__ == "__main__":
    sys.exit(main())
