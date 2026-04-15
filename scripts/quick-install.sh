#!/usr/bin/env bash
hdiutil attach dist/dmg/NeoEdit-*-signed.dmg -nobrowse -quiet
cp -R /Volumes/Neo\ Edit/Neo\ Edit.app /Applications/
hdiutil detach /Volumes/Neo\ Edit -quiet
