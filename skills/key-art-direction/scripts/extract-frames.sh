#!/usr/bin/env bash
# Extract representative key frames from a reference video + a contact sheet.
# Usage: extract-frames.sh <video> <outdir> [max_frames=12] [scene_threshold=0.3]
# Output: <outdir>/frame_XX.png (scene changes, topped up with evenly spaced frames), <outdir>/contact-sheet.png
set -euo pipefail
video="${1:?usage: extract-frames.sh <video> <outdir> [max_frames] [threshold]}"
out="${2:?outdir required}"; max="${3:-12}"; thr="${4:-0.3}"
command -v ffmpeg >/dev/null || { echo "ffmpeg is required" >&2; exit 127; }
mkdir -p "$out"; rm -f "$out"/frame_*.png "$out"/_scene_*.png "$out"/_even_*.png
dur=$(ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 "$video")
# 1) scene-change frames
ffmpeg -v error -i "$video" -vf "select='gt(scene,$thr)',scale=640:-2" -fps_mode vfr -frames:v "$max" "$out/_scene_%02d.png" || true
n_scene=$(find "$out" -name '_scene_*.png' | wc -l | tr -d ' ')
# 2) evenly spaced frames to reach max (always include at least 4)
need=$(( max - n_scene )); if (( need < 4 )); then need=4; fi
fps=$(awk -v n="$need" -v d="$dur" 'BEGIN{ printf "%.5f", n / (d > 0 ? d : 1) }')
ffmpeg -v error -i "$video" -vf "fps=$fps,scale=640:-2" -frames:v "$need" "$out/_even_%02d.png"
i=0
for f in $(find "$out" \( -name '_scene_*.png' -o -name '_even_*.png' \) | sort | head -n "$max"); do
  i=$((i+1)); mv "$f" "$(printf "%s/frame_%02d.png" "$out" "$i")"
done
rm -f "$out"/_scene_*.png "$out"/_even_*.png
cols=4; rows=$(( (i + cols - 1) / cols ))
ffmpeg -v error -y -pattern_type glob -i "$out/frame_*.png" -vf "scale=320:-2,tile=${cols}x${rows}:padding=4:color=white" -frames:v 1 "$out/contact-sheet.png"
echo "extracted $i frames ($n_scene scene changes, duration ${dur}s) -> $out (contact-sheet.png)"
