"""Draws the JSON Peek icon (braces around a magnifier dot) at store sizes. Run once; PNGs are committed."""
import sys
from PIL import Image, ImageDraw, ImageFont
out = sys.argv[1]
FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf'
for size in (16, 32, 48, 128):
    S = 512
    im = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle([16, 16, S - 16, S - 16], radius=110, fill=(37, 99, 235, 255))
    f = ImageFont.truetype(FONT, 330)
    d.text((S * 0.27, S * 0.47), '{', font=f, fill='white', anchor='mm')
    d.text((S * 0.73, S * 0.47), '}', font=f, fill='white', anchor='mm')
    # magnifier lens in the middle
    cx, cy, r = S * 0.5, S * 0.45, 52
    d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=(255, 214, 77, 255), width=26)
    d.line([cx + r * 0.7, cy + r * 0.7, cx + r * 1.7, cy + r * 1.7], fill=(255, 214, 77, 255), width=30)
    im.resize((size, size), Image.LANCZOS).save(f'{out}/{size}.png')
print('ok')
