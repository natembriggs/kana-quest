"""Export the approved icon. Run: python3 tools/make_icons.py (Pillow).

See tools/icon-src/README.md for artwork and release instructions.
"""
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'tools/icon-src/book-trail.png'
MASKABLE_SCALE = 0.64


def maskable(source, size=512):
    """Fit the book in the 80%-diameter safe circle, bleeding edge colours.

    The approved book including cover fits within radius 0.62 of the source
    width. Scaling to 0.64 puts it within radius 0.40. A 10% rectangular
    inset alone would not protect the book's bottom corners.
    """
    inner = round(size * MASKABLE_SCALE)
    inset = (size - inner) // 2
    right = inset + inner
    mark = source.resize((inner, inner), Image.Resampling.LANCZOS)
    image = Image.new('RGB', (size, size))
    image.paste(mark, (inset, inset))
    # Extend nearest edge pixels outward, avoiding a visible square seam.
    for box, dest in [
        ((0, 0, inner, 1), (inset, 0, right, inset)),
        ((0, inner - 1, inner, inner), (inset, right, right, size)),
        ((0, 0, 1, inner), (0, inset, inset, right)),
        ((inner - 1, 0, inner, inner), (right, inset, size, right)),
        ((0, 0, 1, 1), (0, 0, inset, inset)),
        ((inner - 1, 0, inner, 1), (right, 0, size, inset)),
        ((0, inner - 1, 1, inner), (0, right, inset, size)),
        ((inner - 1, inner - 1, inner, inner), (right, right, size, size)),
    ]:
        image.paste(mark.crop(box).resize(
            (dest[2] - dest[0], dest[3] - dest[1]), Image.Resampling.NEAREST
        ), dest)
    return image


def main():
    with Image.open(SOURCE) as artwork:
        if artwork.width != artwork.height:
            raise ValueError('Icon source must be square')
        # Flatten future alpha against the approved indigo background.
        source = Image.new('RGBA', artwork.size, (11, 40, 100, 255))
        source.alpha_composite(artwork.convert('RGBA'))
        source = source.convert('RGB')
    destination = ROOT / 'icons'
    destination.mkdir(exist_ok=True)
    for size in (180, 192, 512):
        source.resize((size, size), Image.Resampling.LANCZOS).save(
            destination / f'icon-{size}.png', optimize=True
        )
    maskable(source).save(destination / 'icon-512-maskable.png', optimize=True)
    print('Exported opaque 180, 192, 512 and separate maskable 512 PNGs.')


if __name__ == '__main__':
    main()
