#!/usr/bin/env bash
# Crop one element out of a reference at full source resolution and upscale it, to read details that a contact sheet
# or a 640 px frame turns into a blob (a character's face, a prop in the distance). The crop is also the image
# reference for generating that element (generate-media), so the generated asset copies the video, not your words.
# Usage: crop-frame.sh <video|image> <out.png> <x> <y> <w> <h> [time_s]
#   x y w h: the box as fractions (0-1) of the frame, top-left origin, e.g. 0.30 0.55 0.12 0.25
#   time_s:  for a video, the moment to grab (default: the middle of the clip)
# Output: <out.png>, upscaled (lanczos) so its longer side is about 1024 px (at most 6x).
set -euo pipefail
src="${1:?usage: crop-frame.sh <video|image> <out.png> <x> <y> <w> <h> [time_s]}"
out="${2:?out.png required}"; x="${3:?x}"; y="${4:?y}"; w="${5:?w}"; h="${6:?h}"; at="${7:-}"
command -v ffmpeg >/dev/null || { echo "ffmpeg is required" >&2; exit 127; }
for v in "$x" "$y" "$w" "$h"; do
  awk -v v="$v" 'BEGIN{ exit !(v >= 0 && v <= 1) }' || { echo "x y w h are fractions 0-1, got $v" >&2; exit 2; }
done
read -r W H < <(ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0:s=x "$src" | tr x ' ')
seek=()
if [[ -z "$at" ]]; then
  dur=$(ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 "$src" 2>/dev/null || true)
  if [[ -n "$dur" && "$dur" != "N/A" ]]; then at=$(awk -v d="$dur" 'BEGIN{ printf "%.3f", d / 2 }'); fi
fi
[[ -n "$at" ]] && seek=(-ss "$at")
read -r cx cy cw ch scale < <(awk -v W="$W" -v H="$H" -v x="$x" -v y="$y" -v w="$w" -v h="$h" 'BEGIN{
  cw = int(W * w / 2) * 2; ch = int(H * h / 2) * 2; if (cw < 2) cw = 2; if (ch < 2) ch = 2
  cx = int(W * x); cy = int(H * y); if (cx + cw > W) cx = W - cw; if (cy + ch > H) cy = H - ch
  long = cw > ch ? cw : ch; s = 1024 / long; if (s > 6) s = 6; if (s < 1) s = 1
  printf "%d %d %d %d %.4f\n", cx, cy, cw, ch, s }')
mkdir -p "$(dirname "$out")"
ffmpeg -v error -y ${seek[@]+"${seek[@]}"} -i "$src" -frames:v 1 \
  -vf "crop=${cw}:${ch}:${cx}:${cy},scale=trunc(iw*${scale}/2)*2:-2:flags=lanczos" "$out"
echo "cropped ${cw}x${ch} at ${cx},${cy} of ${W}x${H}${at:+ (t=${at}s)}, x${scale} -> $out"
