from PIL import Image

from backend.app.services.atelier.palette import load_palette, quantize_to_palette, validate_scene_image


def test_palette_has_48_unique_colors():
    palette = load_palette()
    assert len(palette) == 48
    assert len(set(palette)) == 48


def test_validate_accepts_palette_scene():
    palette = load_palette()
    img = Image.new("RGBA", (960, 540), (0, 0, 0, 0))
    img.putpixel((0, 0), (14, 15, 18, 255))
    result = validate_scene_image(img, palette=palette)
    assert result.ok is True
    assert result.size_ok is True
    assert result.alpha_ok is True


def test_validate_rejects_off_palette_and_semi_alpha():
    palette = load_palette()
    img = Image.new("RGBA", (960, 540), (0, 0, 0, 0))
    img.putpixel((0, 0), (1, 2, 3, 255))
    assert validate_scene_image(img, palette=palette).ok is False
    img.putpixel((0, 0), (14, 15, 18, 128))
    assert validate_scene_image(img, palette=palette).alpha_ok is False


def test_quantize_makes_off_palette_valid():
    palette = load_palette()
    img = Image.new("RGBA", (960, 540), (0, 0, 0, 0))
    img.putpixel((0, 0), (200, 30, 30, 255))
    fixed = quantize_to_palette(img, palette=palette)
    assert validate_scene_image(fixed, palette=palette).ok is True
