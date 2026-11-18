"""Wide crop grid preview for the photo-guided Buddha."""

from pathlib import Path
from PIL import Image, ImageDraw

PROJECT = Path(__file__).resolve().parents[1]
SRC = PROJECT / "images" / "lushena_head.jpg"
OUT = PROJECT / "notes"

CROP = (400, 280, 2300, 2100)  # 1900 x 1820
TW, TH = 245, 235

img = Image.open(SRC).convert("RGB")
crop = img.crop(CROP)
small = crop.resize((TW, TH), Image.LANCZOS)
small.save(OUT / "photo_wide_crop.png", "PNG")

scale = 3
preview = small.resize((TW * scale, TH * scale), Image.NEAREST)
d = ImageDraw.Draw(preview)
for x in range(0, TW, 10):
    color = (255, 80, 80) if x % 50 == 0 else (255, 220, 120)
    d.line([(x * scale, 0), (x * scale, TH * scale)], fill=color, width=1)
    d.text((x * scale + 1, 1), str(x), fill=(255, 255, 255))
for y in range(0, TH, 10):
    color = (255, 80, 80) if y % 50 == 0 else (255, 220, 120)
    d.line([(0, y * scale), (TW * scale, y * scale)], fill=color, width=1)
    d.text((1, y * scale + 1), str(y), fill=(255, 255, 255))
preview.save(OUT / "photo_wide_grid.png", "PNG")
print("saved", OUT / "photo_wide_grid.png", preview.size)
