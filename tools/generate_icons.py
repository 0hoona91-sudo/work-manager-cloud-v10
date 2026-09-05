from pathlib import Path
from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]


def rounded_line(draw, points, fill, width):
    draw.line(points, fill=fill, width=width, joint="curve")
    radius = width // 2
    for x, y in (points[0], points[-1]):
        draw.ellipse((x - radius, y - radius, x + radius, y + radius), fill=fill)


def make_icon(size):
    scale = size / 512
    image = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)

    def box(coords):
        return tuple(round(value * scale) for value in coords)

    draw.rounded_rectangle(box((0, 0, 512, 512)), radius=round(116 * scale), fill="#5f9275")
    draw.rounded_rectangle(box((112, 92, 400, 420)), radius=round(48 * scale), fill="#ffffff")
    draw.rounded_rectangle(box((184, 66, 328, 134)), radius=round(28 * scale), fill="#315a45")
    rounded_line(draw, [box((166, 214)), box((204, 252)), box((280, 168))], "#5f9275", max(4, round(30 * scale)))
    rounded_line(draw, [box((166, 330)), box((346, 330))], "#c8d8ce", max(4, round(26 * scale)))
    image.save(ROOT / "icons" / f"app-icon-{size}.png", optimize=True)


for target_size in (192, 512):
    make_icon(target_size)
