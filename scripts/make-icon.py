#!/usr/bin/env python3
"""アプリのアイコンを生成する。

    python scripts/make-icon.py

**画像をバイナリで置かず、コードから作る。**
あとから色や形を直したくなったとき、元データが無いと作り直せない
（このリポジトリは「元 ISO を触らずパッチで表現する」など、
元に戻せる形を選んできた。アイコンも同じ扱いにする）。

出力:
    apps/desktop/build/icon.ico   Windows（16/24/32/48/64/128/256 を内包）
    apps/desktop/build/icon.png   1024x1024。macOS の icns と Linux はこれから作られる

electron-builder は `buildResources`（= `apps/desktop/build`）から
`icon.ico` / `icon.png` を拾う。**設定に書く必要は無い。**

意匠:
    紺〜藍のグラデーションの角丸正方形に、白い USB メモリを立てて置く。
    本体には「書き込む」ことを示す下向きの矢印を**背景色で抜く**。

    **Ubuntu の意匠（オレンジの円環・ワードマーク）は使わない。**
    Canonical の商標なので、このツールの配布物に入れてよいものではない。

    **16px と 32px は矢印とコネクタの穴を省く。** 小さい寸法で細部を残すと
    つぶれて「白い塊」にしか見えなくなるので、寸法ごとに描き分ける
    （大きい画像を縮小するだけでは、この判断ができない）。

依存: Pillow のみ。
"""

from __future__ import annotations

import sys
import tempfile
from pathlib import Path

try:
    from PIL import Image, ImageDraw
except ImportError:  # pragma: no cover
    sys.exit("Pillow が要ります: python -m pip install pillow")

OUT_DIR = Path(__file__).resolve().parent.parent / "apps" / "desktop" / "build"

# 角丸の背景。左上から右下へ、slate-900 から indigo-600 へ。
BG_FROM = (15, 23, 42)
BG_TO = (67, 56, 202)
DRIVE = (255, 255, 255)
# コネクタは少しだけ暗くして金属に見せる。小さい寸法では差が消えるが害はない。
CONNECTOR = (203, 213, 225)

# 描画の粗さを消すための倍率。この倍で描いてから縮める。
SUPERSAMPLE = 4


def _gradient(size: int) -> Image.Image:
    """左上から右下への線形グラデーション。"""
    img = Image.new("RGB", (size, size))
    px = img.load()
    assert px is not None
    denom = max(1, (size - 1) * 2)
    for y in range(size):
        for x in range(size):
            t = (x + y) / denom
            px[x, y] = (
                round(BG_FROM[0] + (BG_TO[0] - BG_FROM[0]) * t),
                round(BG_FROM[1] + (BG_TO[1] - BG_FROM[1]) * t),
                round(BG_FROM[2] + (BG_TO[2] - BG_FROM[2]) * t),
            )
    return img


def draw_icon(size: int) -> Image.Image:
    """1 辺 `size` のアイコンを描く。**寸法ごとに細部の有無を変える。**"""
    # 32px でも矢印は読める（16/24 は本体だけにする）。
    detailed = size >= 32
    s = size * SUPERSAMPLE

    # --- 背景（角丸正方形にグラデーションを流し込む）
    base = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    grad = _gradient(s).convert("RGBA")
    mask = Image.new("L", (s, s), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, s - 1, s - 1), radius=int(s * 0.22), fill=255)
    base.paste(grad, (0, 0), mask)

    d = ImageDraw.Draw(base)

    def box(x0: float, y0: float, x1: float, y1: float) -> tuple[int, int, int, int]:
        return (round(x0 * s), round(y0 * s), round(x1 * s), round(y1 * s))

    # --- USB メモリ
    # 小さい寸法では一回り太くする（縮めたときに線が消えないように）。
    # **図柄を大きく取る。** 余白が多いと 16px で「白い点」になる。
    if detailed:
        conn = box(0.370, 0.110, 0.630, 0.300)
        body = box(0.235, 0.272, 0.765, 0.890)
        body_r = int(s * 0.085)
    else:
        # 16/24px。細部が消えるので、本体を一回り大きくして輪郭だけで見せる。
        conn = box(0.350, 0.105, 0.650, 0.300)
        body = box(0.195, 0.270, 0.805, 0.900)
        body_r = int(s * 0.105)

    d.rectangle(conn, fill=CONNECTOR)
    d.rounded_rectangle(body, radius=body_r, fill=DRIVE)

    if detailed:
        # コネクタの穴 2 つ。背景を抜くのではなく、暗い色で描く
        # （抜くとグラデーションが透けて、白い本体との境が甘くなる）。
        hole = (71, 85, 105)
        d.rectangle(box(0.418, 0.145, 0.582, 0.185), fill=hole)
        d.rectangle(box(0.418, 0.213, 0.582, 0.253), fill=hole)

        # 本体に下向きの矢印を**背景色で抜く**（＝書き込む向き）。
        arrow = (30, 41, 59)
        d.rectangle(box(0.455, 0.375, 0.545, 0.610), fill=arrow)
        d.polygon(
            [box(0.375, 0.575, 0, 0)[:2], box(0.625, 0.575, 0, 0)[:2], box(0.500, 0.775, 0, 0)[:2]],
            fill=arrow,
        )

    return base.resize((size, size), Image.LANCZOS)


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    master = draw_icon(1024)
    master.save(OUT_DIR / "icon.png")
    print(f"書きました: {OUT_DIR / 'icon.png'} (1024x1024)")

    # **ICO は寸法ごとに描き直したものを詰める。**
    # 1 枚を縮小して詰めると 16px がつぶれる。
    sizes = [16, 24, 32, 48, 64, 128, 256]
    images = [draw_icon(n) for n in sizes]
    ico = OUT_DIR / "icon.ico"
    images[-1].save(ico, format="ICO", sizes=[(n, n) for n in sizes], append_images=images[:-1])
    print(f"書きました: {ico} ({'/'.join(str(n) for n in sizes)})")

    # 目で見て確かめるための並べた画像（配布物には入らない）。
    strip_sizes = [16, 32, 48, 64, 128, 256]
    pad = 12
    w = sum(strip_sizes) + pad * (len(strip_sizes) + 1)
    strip = Image.new("RGBA", (w, 256 + pad * 2), (245, 245, 245, 255))
    x = pad
    for n in strip_sizes:
        strip.paste(draw_icon(n), (x, pad + (256 - n) // 2), draw_icon(n))
        x += n + pad
    # **リポジトリの中には置かない**（成果物でも設定でもないので、
    # 置くとコミット対象になるか .gitignore を足すことになる）。
    preview = Path(tempfile.gettempdir()) / "seedstick-icon-preview.png"
    strip.save(preview)
    print(f"確認用（一時ファイル）: {preview}")


if __name__ == "__main__":
    main()
