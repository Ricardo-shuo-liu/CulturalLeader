import random

from PIL import Image, ImageDraw

from backend.app.services.atelier.draw.landmarks import LANDMARK_DRAWERS
from backend.app.services.atelier.palette import load_palette, validate_scene_image
from backend.app.services.atelier.scene_spec import build_rule_scene


def _draw_landmark(kind: str):
    palette = load_palette()
    spec = build_rule_scene("洛阳龙门石窟，黄昏", seed=5)
    spec.landmark_type = kind
    img = Image.new("RGBA", (960, 540), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    LANDMARK_DRAWERS[kind](img, draw, spec, palette, random.Random(5))
    return img, palette


def test_cliff_pagoda_gate_render_non_empty_in_palette():
    for kind in ("cliff_buddha", "pagoda", "palace_gate"):
        img, palette = _draw_landmark(kind)
        assert validate_scene_image(img, palette=palette).ok is True
        non_empty = sum(1 for pixel in img.getdata() if pixel[3] == 255)
        assert non_empty > 5000, kind


def test_water_town_mountain_skyline_render_non_empty_in_palette():
    for kind in ("water_town", "mountain_temple", "skyline"):
        img, palette = _draw_landmark(kind)
        assert validate_scene_image(img, palette=palette).ok is True
        non_empty = sum(1 for pixel in img.getdata() if pixel[3] == 255)
        assert non_empty > 5000, kind


def test_draw_scene_all_types_are_valid_and_deterministic():
    from backend.app.services.atelier.renderer import draw_scene, to_2x

    for kind in ("cliff_buddha", "pagoda", "palace_gate", "water_town", "mountain_temple", "skyline"):
        spec = build_rule_scene("洛阳龙门石窟，黄昏", seed=11)
        spec.landmark_type = kind
        first = draw_scene(spec)
        second = draw_scene(spec)
        assert first.size == (960, 540)
        assert validate_scene_image(first).ok is True
        assert first.tobytes() == second.tobytes(), kind
        assert to_2x(first).size == (1920, 1080)


def test_draw_scene_reports_monotonic_progress():
    from backend.app.services.atelier.renderer import draw_scene

    spec = build_rule_scene("苏州水乡，春雨", seed=12)
    events = []
    draw_scene(spec, progress=lambda pct, detail: events.append((pct, detail)))
    percents = [pct for pct, _ in events]
    assert percents == sorted(percents)
    assert percents[-1] == 100
    assert all(isinstance(detail, str) and detail for _, detail in events)


def test_postcard_is_2112x1432_and_contains_2x_scene():
    from backend.app.services.atelier.renderer import draw_scene, make_postcard

    spec = build_rule_scene("洛阳龙门石窟，黄昏", seed=21)
    scene = draw_scene(spec)
    card = make_postcard(scene, spec)
    assert card.size == (2112, 1432)
    assert card.getpixel((96, 96)) == scene.getpixel((0, 0))
