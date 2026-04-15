#!/usr/bin/env bash
DMG_PATH="dist/NeoEdit-*-signed.dmg"
if ! ls $DMG_PATH 1>/dev/null 2>&1; then
  echo "Error: DMG not found at $DMG_PATH"
  echo "Run ./scripts/run-build-sign-install.sh first"
  exit 1
fi

hdiutil attach dist/NeoEdit-*-signed.dmg -nobrowse -quiet
cp -R /Volumes/Neo\ Edit/Neo\ Edit.app /Applications/
hdiutil detach /Volumes/Neo\ Edit -quiet
echo "Neo Edit installed to /Applications/"
