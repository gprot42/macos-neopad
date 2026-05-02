#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

VERSION="$(awk '/## Current Version/{flag=1;next}/^##/{flag=0}flag && /^[0-9]/{print;exit}' version.md)"
echo "Neo Edit v${VERSION} — starting dev server..."

# Clean up stale single-instance sockets from prior runs that didn't exit cleanly.
# A stale socket causes the fresh instance to be treated as a duplicate and exits immediately.
rm -f /tmp/com_neoedit*.sock /tmp/com_neo*.sock 2>/dev/null || true

bun run dev
