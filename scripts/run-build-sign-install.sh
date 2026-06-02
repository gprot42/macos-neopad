#!/bin/bash
# =============================================================================
# run-build-sign-install.sh
#
# Convenience wrapper — reads credentials from .env at the project root,
# then runs the full build → sign → notarize → install → DMG pipeline.
#
# Setup:
#   cp .env.example .env
#   # edit .env with your Developer ID credentials
#   ./scripts/run-build-sign-install.sh
#
# Pass any extra flags through to 02-build-sign-install.sh, e.g.:
#   ./scripts/run-build-sign-install.sh --skip-notarize
# =============================================================================
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "$SCRIPT_DIR/02-build-sign-install.sh" "$@"
