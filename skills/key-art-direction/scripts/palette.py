#!/usr/bin/env python3
"""Dominant colour palette of an image (or video frame) using ffmpeg + pure-Python k-means.

Usage: palette.py <image> [-k 6] [-o palette.json]
Prints JSON: {"colors": [{"hex": "#rrggbb", "share": 0.31, "luma": 0.42}, ...]} sorted by share.
No Python packages needed; requires ffmpeg on PATH.
"""
import argparse
import json
import random
import subprocess
import sys


def pixels(path, size=96):
    raw = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", path, "-frames:v", "1", "-vf", f"scale={size}:{size}:flags=area",
         "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], capture_output=True, check=True).stdout
    return [tuple(raw[i:i + 3]) for i in range(0, len(raw), 3)]


def kmeans(px, k, iters=20, seed=1):
    rnd = random.Random(seed)
    cents = [list(c) for c in rnd.sample(px, k)]
    for _ in range(iters):
        groups = [[] for _ in range(k)]
        for p in px:
            j = min(range(k), key=lambda i: sum((p[d] - cents[i][d]) ** 2 for d in range(3)))
            groups[j].append(p)
        for i, g in enumerate(groups):
            if g:
                cents[i] = [sum(p[d] for p in g) / len(g) for d in range(3)]
    return cents, groups


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("image")
    ap.add_argument("-k", type=int, default=6)
    ap.add_argument("-o", "--out")
    a = ap.parse_args()
    px = pixels(a.image)
    cents, groups = kmeans(px, a.k)
    total = len(px)
    colors = []
    for c, g in zip(cents, groups):
        if not g:
            continue
        r, gg, b = (round(v) for v in c)
        colors.append({"hex": f"#{r:02x}{gg:02x}{b:02x}", "share": round(len(g) / total, 3),
                       "luma": round((0.2126 * r + 0.7152 * gg + 0.0722 * b) / 255, 3)})
    colors.sort(key=lambda c: -c["share"])
    out = json.dumps({"source": a.image, "colors": colors}, indent=2)
    if a.out:
        open(a.out, "w").write(out + "\n")
    print(out)


if __name__ == "__main__":
    sys.exit(main())
