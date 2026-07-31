#!/usr/bin/env python3
"""Builds a macOS Big Sur style layered icon.icns for MkCleaner.

macOS 11+ icons are layered: a background layer (the colour field), a
foreground layer (the mark), and a mask layer (the squircle). Tauri's
`tauri icon` only produces flat icons, so this script assembles the
layered icns by hand.

Layers (Apple ICNS format):
  ic07 / ic08  — background, 512 / 256
  ic09 / ic10  — foreground, 512 / 256
  ic11 / ic12  — mask,       512 / 256
  ic13 / ic14  — flat composite for non-layered contexts, 512 / 1024
  icp4..icp6   — small flat composites, 16 / 32 / 64

Usage: make-layered-icon.py <foreground-512.png> <output.icns>
"""

import struct
import sys
from pathlib import Path

from PIL import Image, ImageDraw

SQUIRCLE_RADIUS = 0.2237  # share of the size, Apple's squircle corner radius

BG_TOP = (224, 135, 104)    # clay light
BG_BOTTOM = (196, 92, 66)   # clay dark


def background(size: int) -> Image.Image:
    """Diagonal clay gradient, dark in the bottom-right corner."""
    img = Image.new("RGB", (size, size))
    for y in range(size):
        t = y / (size - 1)
        row = tuple(int(BG_TOP[i] + (BG_BOTTOM[i] - BG_TOP[i]) * t) for i in range(3))
        img.paste(row, (0, y, size, y + 1))
    return img


def mask(size: int) -> Image.Image:
    """White squircle on transparent, the system's icon silhouette."""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    r = int(size * SQUIRCLE_RADIUS)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=r, fill=(255, 255, 255, 255))
    return img


def composite(bg: Image.Image, fg: Image.Image, size: int) -> Image.Image:
    """Flat icon: background under the foreground mark, masked to the squircle."""
    bg = bg.resize((size, size), Image.LANCZOS)
    fg = fg.resize((size, size), Image.LANCZOS)
    m = mask(size)
    out = bg.convert("RGBA")
    out.paste(fg, (0, 0), fg)
    out.putalpha(m.getchannel("A"))
    return out


def png_bytes(img: Image.Image) -> bytes:
    import io

    buf = io.BytesIO()
    img.save(buf, "PNG")
    return buf.getvalue()


def build_icns(layers: list[tuple[str, Image.Image]]) -> bytes:
    """Assembles an icns from (type, image) pairs, with a table of contents."""
    blocks = []
    for kind, img in layers:
        data = png_bytes(img)
        blocks.append((kind, data))

    toc = b"TOC " + struct.pack(">I", 8 + 8 * len(blocks))
    for kind, data in blocks:
        toc += kind.encode() + struct.pack(">I", len(data) + 8)

    out = b"icns" + struct.pack(">I", 8 + len(toc) + sum(len(d) + 8 for _, d in blocks))
    out += toc
    for kind, data in blocks:
        out += kind.encode() + struct.pack(">I", len(data) + 8) + data
    return out


def main() -> None:
    fg_path, out_path = sys.argv[1], sys.argv[2]
    fg = Image.open(fg_path).convert("RGBA")

    bg512 = background(512)
    bg256 = background(256)
    fg512 = fg.resize((512, 512), Image.LANCZOS)
    fg256 = fg.resize((256, 256), Image.LANCZOS)
    m512 = mask(512)
    m256 = mask(256)
    c512 = composite(bg512, fg512, 512)
    c1024 = composite(bg512, fg512, 1024)

    layers = [
        ("icp4", c512.resize((16, 16), Image.LANCZOS)),
        ("icp5", c512.resize((32, 32), Image.LANCZOS)),
        ("icp6", c512.resize((64, 64), Image.LANCZOS)),
        ("ic07", bg512),
        ("ic08", bg256),
        ("ic09", fg512),
        ("ic10", fg256),
        ("ic11", m512),
        ("ic12", m256),
        ("ic13", c512),
        ("ic14", c1024),
    ]

    Path(out_path).write_bytes(build_icns(layers))
    print(f"wrote {out_path} ({Path(out_path).stat().st_size} bytes)")


if __name__ == "__main__":
    main()
