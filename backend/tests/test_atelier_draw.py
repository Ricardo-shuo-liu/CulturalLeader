import random

from PIL import Image, ImageDraw

from backend.app.services.atelier.draw.noise import bayer4, value_noise_1d
from backend.app.services.atelier.draw.sky import draw_sky
from backend.app.services.atelier.draw.terrain import draw_terrain
from backend.app.services.atelier.draw.water import draw_water
from backend.app.services.atelier.palette import load_palette, validate_scene_image
from backend.app.services.atelier.scene_spec import build_rule_scene


def _canvas():
    return Image.new("RGBA", (960, 540), (0, 0, 0, 0))


def test_noise_is_bounded_and_bayer_is_4x4():
    rng = random.Random(1)
    values = value_noise_1d(960, rng, 64)
    assert len(values) == 960
    assert all(0.0 <= value <= 1.0 for value in values)
    assert {bayer4(x, y) for x in range(4) for y in range(4)} == set(range(16))


def test_sky_terrain_water_draw_in_palette():
    palette = load_palette()
    spec = build_rule_scene("洛阳龙门石窟，黄昏", seed=3)
    img = _canvas()
    draw = ImageDraw.Draw(img)
    rng = random.Random(3)
    draw_sky(img, draw, spec, palette, rng)
    draw_terrain(img, draw, spec, palette, rng)
    draw_water(img, draw, spec, palette, rng)
    result = validate_scene_image(img, palette=palette)
    assert result.ok is True
    assert result.colors > 2
