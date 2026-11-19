#!/usr/bin/env bash
set -euo pipefail
# Builds the recorder of "שיחה חיה" (native/sumit-audio.swift) into bin/sumit-audio, which electron-builder puts in
# the app's Resources/bin. Needs the Xcode command line tools (swiftc). Usage: bash scripts/build-audio.sh [arm64|x64|universal]
MACOS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$MACOS_DIR"
ARCH="${1:-$(uname -m)}"
SRC=native/sumit-audio.swift
OUT=bin/sumit-audio
mkdir -p bin
build() { swiftc -O -target "$1-apple-macos14.2" "$SRC" -o "$2"; }
case "$ARCH" in
  arm64) build arm64 "$OUT" ;;
  x64|x86_64) build x86_64 "$OUT" ;;
  universal|both|all)
    build arm64 bin/.sumit-audio-arm64; build x86_64 bin/.sumit-audio-x64
    lipo -create bin/.sumit-audio-arm64 bin/.sumit-audio-x64 -output "$OUT"; rm -f bin/.sumit-audio-arm64 bin/.sumit-audio-x64 ;;
  dir) build "$(uname -m)" "$OUT" ;;
  *) echo "Unknown architecture '$ARCH'" >&2; exit 1 ;;
esac
chmod 755 "$OUT"
"$OUT" check
