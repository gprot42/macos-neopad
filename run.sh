#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

VERSION="$(awk '/## Current Version/{flag=1;next}/^##/{flag=0}flag && /^[0-9]/{print;exit}' version.md)"
echo "Neo Edit v${VERSION} — starting dev server..."

bun run dev
