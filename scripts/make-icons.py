"""Draws the app icon (a court in plan view with a shuttlecock) in CMU colors at every size browsers and phones ask for.

Usage: python3 scripts/make-icons.py public
Files are named court-*.png; rename them (and the links) if the design changes so phones drop cached copies.
"""
import sys
from pathlib import Path
from PIL import Image, ImageDraw

CARNEGIE_RED = (196, 18, 48)
LINE = (255, 255, 255)
GOLD_THREAD = (253, 181, 21)
PUBLIC = Path(sys.argv[1])


def draw(size: int, inset: float = 1.0) -> Image.Image:
    """`inset` < 1 shrinks the drawing toward the centre, for masks that crop the edges."""
    s = size / 512

    def p(x: float, y: float) -> tuple[float, float]:
        return (256 + (x - 256) * inset) * s, (256 + (y - 256) * inset) * s

    img = Image.new("RGB", (size, size), CARNEGIE_RED)
    d = ImageDraw.Draw(img)
    w = max(2, round(12 * s * inset))
    thin = max(1, round(6 * s * inset))
    d.rectangle([*p(110, 70), *p(402, 442)], outline=LINE, width=w)
    d.line([*p(110, 256), *p(402, 256)], fill=LINE, width=w)
    for y in (200, 312):
        d.line([*p(110, y), *p(402, y)], fill=LINE, width=thin)
    d.line([*p(256, 70), *p(256, 200)], fill=LINE, width=thin)
    d.line([*p(256, 312), *p(256, 442)], fill=LINE, width=thin)
    d.polygon([p(206, 130), p(306, 130), p(276, 230), p(236, 230)], fill=LINE)
    d.ellipse([*p(228, 214), *p(284, 270)], fill=GOLD_THREAD)
    return img


icons = PUBLIC / "icons"
icons.mkdir(parents=True, exist_ok=True)
for px in (32, 180, 192, 512):
    draw(px).save(icons / f"court-{px}.png")
# Android's adaptive icons crop to a circle or squircle: keep the court inside the safe zone.
draw(512, inset=0.78).save(icons / "court-maskable-512.png")
draw(64).save(PUBLIC / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48), (64, 64)])
