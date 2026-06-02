#!/usr/bin/env bash
set -euo pipefail

# Resolve repo root so the script works from any cwd
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

DMG_GLOB="dist/NeoEdit-*-signed.dmg"
DMG_FILE="$(ls $DMG_GLOB 2>/dev/null | head -1 || true)"

if [ -z "$DMG_FILE" ]; then
  echo "Error: DMG not found at $REPO_ROOT/$DMG_GLOB"
  echo "Run ./scripts/run-build-sign-install.sh first"
  exit 1
fi

hdiutil attach "$DMG_FILE" -nobrowse -quiet
cp -R "/Volumes/NeoPad/NeoPad.app" /Applications/
hdiutil detach "/Volumes/NeoPad" -quiet
echo "NeoPad installed to /Applications/"
