"""Erzeugt die App-Icons (PNG) für Jarvis.  Aufruf:  python3 tools/make_icons.py
Benötigt Pillow:  pip install pillow
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter

OUT = Path(__file__).resolve().parent.parent / "icons"
OUT.mkdir(exist_ok=True)
BG = (5, 12, 22)
CYAN = (0, 200, 255)


def draw_icon(size: int, maskable: bool = False) -> Image.Image:
    s = size * 4  # Supersampling für glatte Kanten
    img = Image.new("RGB", (s, s), BG)
    c = s / 2
    # Maskierbare Icons brauchen eine "Safe Zone" (innere 80 %)
    scale = 0.62 if maskable else 0.8
    r = s * scale / 2

    # Glow-Ebene
    glow = Image.new("RGB", (s, s), (0, 0, 0))
    g = ImageDraw.Draw(glow)
    g.ellipse([c - r, c - r, c + r, c + r], outline=CYAN, width=int(s * 0.05))
    glow = glow.filter(ImageFilter.GaussianBlur(s * 0.03))
    img.paste(glow, (0, 0), glow.convert("L"))

    d = ImageDraw.Draw(img)
    # Äußerer Ring
    d.ellipse([c - r, c - r, c + r, c + r], outline=CYAN, width=int(s * 0.025))
    # Segmentierter Innenring
    r2 = r * 0.78
    for i in range(12):
        start = i * 30 + 4
        d.arc([c - r2, c - r2, c + r2, c + r2], start, start + 20, fill=(120, 230, 255), width=int(s * 0.03))
    # Leuchtender Kern
    r3 = r * 0.42
    core = Image.new("RGB", (s, s), (0, 0, 0))
    cd = ImageDraw.Draw(core)
    cd.ellipse([c - r3, c - r3, c + r3, c + r3], fill=(150, 240, 255))
    core = core.filter(ImageFilter.GaussianBlur(s * 0.035))
    img.paste(core, (0, 0), core.convert("L"))
    d = ImageDraw.Draw(img)
    r4 = r * 0.28
    d.ellipse([c - r4, c - r4, c + r4, c + r4], fill=(230, 252, 255))
    return img.resize((size, size), Image.LANCZOS)


for name, size, mask in [
    ("icon-192.png", 192, False),
    ("icon-512.png", 512, False),
    ("icon-maskable-512.png", 512, True),
    ("apple-touch-icon.png", 180, False),
    ("favicon-32.png", 32, False),
]:
    draw_icon(size, mask).save(OUT / name, optimize=True)
    print("erstellt:", OUT / name)
