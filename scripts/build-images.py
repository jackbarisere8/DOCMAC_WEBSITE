#!/usr/bin/env python3
"""Generate optimized Docmac logo, favicon, PWA, and Open Graph images.

Requires Pillow:  python -m pip install pillow
Run from the repository root:  python scripts/build-images.py
"""

from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
IMAGES = ROOT / "assets" / "images"
SOURCE = IMAGES / "docmac-logo.png"

BLUE = (28, 113, 248)
NAVY = (10, 28, 60)
DEEP_BLUE = (13, 78, 175)
LIGHT = (199, 217, 248)
WHITE = (255, 255, 255)


def resized(image: Image.Image, size: int) -> Image.Image:
    return image.resize((size, size), Image.Resampling.LANCZOS)


def save_logo_variants(logo: Image.Image) -> None:
    for size in (34, 68, 136, 192, 512):
        png = IMAGES / f"docmac-logo-{size}.png"
        resized(logo, size).save(png, optimize=True)
        print(f"wrote {png.relative_to(ROOT)}")

    for size in (34, 68, 136):
        webp = IMAGES / f"docmac-logo-{size}.webp"
        resized(logo, size).save(webp, "WEBP", quality=90, method=6)
        print(f"wrote {webp.relative_to(ROOT)}")


def save_icons(logo: Image.Image) -> None:
    resized(logo, 32).save(IMAGES / "favicon-32.png", optimize=True)
    resized(logo, 16).save(IMAGES / "favicon-16.png", optimize=True)
    resized(logo, 48).save(
        IMAGES / "favicon.ico",
        sizes=[(16, 16), (32, 32), (48, 48)],
    )

    apple = Image.new("RGB", (180, 180), (10, 61, 145))
    mark = resized(logo, 148)
    apple.paste(mark, (16, 16), mark if mark.mode == "RGBA" else None)
    apple.save(IMAGES / "apple-touch-icon.png", optimize=True)
    print("wrote favicons and apple-touch-icon.png")


def load_font(name: str, size: int) -> ImageFont.FreeTypeFont:
    candidates = [
        Path("C:/Windows/Fonts") / name,
        Path("/usr/share/fonts/truetype/dejavu") / name,
    ]
    for candidate in candidates:
        if candidate.exists():
            return ImageFont.truetype(str(candidate), size)
    return ImageFont.load_default()


def draw_tracked_text(draw, position, text, font, fill, tracking=0):
    x, y = position
    for character in text:
        draw.text((x, y), character, font=font, fill=fill)
        x += draw.textlength(character, font=font) + tracking
    return x


def build_og_image(logo: Image.Image) -> None:
    width, height = 1200, 630
    image = Image.new("RGB", (width, height), NAVY)
    draw = ImageDraw.Draw(image)

    for y in range(height):
        ratio = y / (height - 1)
        color = tuple(
            round(NAVY[index] + (DEEP_BLUE[index] - NAVY[index]) * ratio)
            for index in range(3)
        )
        draw.line([(0, y), (width, y)], fill=color)

    overlay = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    overlay_draw = ImageDraw.Draw(overlay)
    for radius, alpha in ((340, 20), (250, 26), (160, 32)):
        overlay_draw.ellipse(
            (width - radius * 2 + 130, height // 2 - radius, width + 130, height // 2 + radius),
            outline=(120, 170, 255, alpha),
            width=2,
        )
    image = Image.alpha_composite(image.convert("RGBA"), overlay)

    mark = resized(logo, 92)
    image.paste(mark, (80, 82), mark)
    draw = ImageDraw.Draw(image)
    draw.text((190, 96), "docmac", font=load_font("segoeuib.ttf", 46), fill=WHITE)
    draw.text(
        (192, 148),
        "PRIVATE BY DESIGN",
        font=load_font("seguisb.ttf", 16),
        fill=(150, 190, 255),
    )

    draw.text(
        (80, 238),
        "Your people,",
        font=load_font("segoeuib.ttf", 76),
        fill=WHITE,
    )
    draw.text(
        (80, 322),
        "closer than ever.",
        font=load_font("segoeuib.ttf", 76),
        fill=(121, 174, 255),
    )
    draw.text(
        (84, 430),
        "Private conversations, circles, and moments.",
        font=load_font("segoeui.ttf", 28),
        fill=LIGHT,
    )

    badge = (80, 505, 430, 569)
    draw.rounded_rectangle(badge, radius=18, fill=WHITE)
    draw.text(
        (108, 520),
        "Download for Android",
        font=load_font("segoeuib.ttf", 24),
        fill=(10, 61, 145),
    )
    draw.text(
        (382, 520),
        "\u2193",
        font=load_font("segoeuib.ttf", 24),
        fill=(10, 61, 145),
    )

    draw_tracked_text(
        draw,
        (900, 555),
        "DOCMAC FOR ANDROID",
        load_font("seguisb.ttf", 15),
        (150, 190, 255),
        tracking=2,
    )

    image.convert("RGB").save(IMAGES / "og-image.png", optimize=True)
    print("wrote og-image.png")


def main() -> None:
    if not SOURCE.exists():
        raise SystemExit(f"Missing source logo: {SOURCE}")
    logo = Image.open(SOURCE).convert("RGBA")
    save_logo_variants(logo)
    save_icons(logo)
    build_og_image(logo)


if __name__ == "__main__":
    main()
