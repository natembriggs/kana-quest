"""Generate the PWA / home-screen icons.

Run:  python3 tools/make_icons.py
"""
from PIL import Image, ImageDraw, ImageFont

BG = (232, 85, 61)      # --accent
FG = (255, 255, 255)
GLYPH = "か"        # ka

FONT_CANDIDATES = [
    "/System/Library/Fonts/AquaKana.ttc",
    "/System/Library/Fonts/Hiragino Sans GB.ttc",
    "/System/Library/Fonts/AppleSDGothicNeo.ttc",
]


def load_font(size):
    for path in FONT_CANDIDATES:
        for index in (0, 1, 2):
            try:
                font = ImageFont.truetype(path, size, index=index)
                if font.getbbox(GLYPH)[2] > 0:
                    return font, f"{path}#{index}"
            except Exception:
                continue
    raise SystemExit("No font on this Mac rendered the kana glyph.")


def make(size, radius_frac=0.22, pad_frac=0.0):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    pad = int(size * pad_frac)
    draw.rounded_rectangle(
        [pad, pad, size - 1 - pad, size - 1 - pad],
        radius=int(size * radius_frac), fill=BG,
    )
    font, _ = load_font(int(size * 0.56))
    left, top, right, bottom = draw.textbbox((0, 0), GLYPH, font=font)
    draw.text(
        ((size - (right - left)) / 2 - left, (size - (bottom - top)) / 2 - top),
        GLYPH, font=font, fill=FG,
    )
    return img


if __name__ == "__main__":
    _, used = load_font(64)
    print("font:", used)
    for size in (192, 512):
        make(size).save(f"icons/icon-{size}.png")
    # iOS ignores transparency and rounds corners itself, so ship a full bleed.
    make(180, radius_frac=0.0).convert("RGB").save("icons/icon-180.png")
    print("wrote icons/icon-192.png, icons/icon-512.png, icons/icon-180.png")
