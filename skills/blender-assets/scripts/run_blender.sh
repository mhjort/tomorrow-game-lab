#!/usr/bin/env bash
# Run a Blender Python script headless. Usage: run_blender.sh <script.py> [-- script args]
# Env: BLENDER=/path/to/blender (defaults to `blender` on PATH, then macOS app bundle)
set -euo pipefail
script="${1:?usage: run_blender.sh <script.py> [args...]}"; shift || true
B="${BLENDER:-}"
if [[ -z "$B" ]]; then
  if command -v blender >/dev/null; then B=blender
  elif [[ -x /Applications/Blender.app/Contents/MacOS/Blender ]]; then B=/Applications/Blender.app/Contents/MacOS/Blender
  else echo "blender not found; set BLENDER=" >&2; exit 127; fi
fi
exec "$B" -b --factory-startup --python-exit-code 1 -P "$script" -- "$@"
