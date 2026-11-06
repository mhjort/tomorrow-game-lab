#!/usr/bin/env bash
# Extract representative key frames from a reference video + a contact sheet.
# Usage: extract-frames.sh <video> <outdir> [max_frames=12] [scene_threshold=0.3]
# Output: <outdir>/frame_XX.png (scene changes, topped up with evenly spaced frames, numbered in time order),
#         <outdir>/times.txt ("frame_XX.png <seconds>", so a brief can cite "frame_08, t=8.8 s" and crop-frame.sh can
#         grab the same moment at full resolution), <outdir>/contact-sheet.png
set -euo pipefail
video="${1:?usage: extract-frames.sh <video> <outdir> [max_frames] [threshold]}"
out="${2:?outdir required}"; max="${3:-12}"; thr="${4:-0.3}"
command -v ffmpeg >/dev/null || { echo "ffmpeg is required" >&2; exit 127; }
mkdir -p "$out"; rm -f "$out"/frame_*.png "$out"/_scene_*.png "$out"/_even_*.png "$out"/times.txt
dur=$(ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 "$video")
list="$out/_times.tmp"; : > "$list"
# 1) scene-change frames (showinfo logs each kept frame's pts_time)
ffmpeg -v info -i "$video" -vf "select='gt(scene,$thr)',showinfo,scale=640:-2" -fps_mode vfr -frames:v "$max" "$out/_scene_%02d.png" 2>&1 \
  | grep -o 'pts_time:[0-9.]*' | cut -d: -f2 | awk -v d="$out" '{ printf "%s %s/_scene_%02d.png\n", $1, d, NR }' >> "$list" || true
n_scene=$(find "$out" -name '_scene_*.png' | wc -l | tr -d ' ')
# 2) evenly spaced frames to reach max (always include at least 4)
need=$(( max - n_scene )); if (( need < 4 )); then need=4; fi
fps=$(awk -v n="$need" -v d="$dur" 'BEGIN{ printf "%.5f", n / (d > 0 ? d : 1) }')
ffmpeg -v info -i "$video" -vf "fps=$fps,showinfo,scale=640:-2" -frames:v "$need" "$out/_even_%02d.png" 2>&1 \
  | grep -o 'pts_time:[0-9.]*' | cut -d: -f2 | awk -v d="$out" '{ printf "%s %s/_even_%02d.png\n", $1, d, NR }' >> "$list"
# 3) keep every evenly spaced frame (coverage of the whole clip) plus the first scene changes up to max, then
#    number them in time order
keep_scene=$(( max - need )); if (( keep_scene < 0 )); then keep_scene=0; fi
{ grep '_even_' "$list" || true; if (( keep_scene > 0 )); then grep '_scene_' "$list" | head -n "$keep_scene" || true; fi; } | sort -n > "$list.keep"
i=0
while read -r t f; do
  [[ -f "$f" ]] || continue
  i=$((i+1))
  name=$(printf "frame_%02d.png" "$i")
  mv "$f" "$out/$name"
  printf "%s %.3f\n" "$name" "$t" >> "$out/times.txt"
done < "$list.keep"
rm -f "$list.keep"
rm -f "$out"/_scene_*.png "$out"/_even_*.png "$list"
i=$(find "$out" -name 'frame_*.png' | wc -l | tr -d ' ')
cols=4; rows=$(( (i + cols - 1) / cols ))
ffmpeg -v error -y -pattern_type glob -i "$out/frame_*.png" -vf "scale=320:-2,tile=${cols}x${rows}:padding=4:color=white" -frames:v 1 "$out/contact-sheet.png"
echo "extracted $i frames ($n_scene scene changes, duration ${dur}s) -> $out (contact-sheet.png, times.txt)"
