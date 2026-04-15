#!/bin/bash
# =============================================================================
# sign.sh — Sign and optionally notarize Neo Edit.app
#
# Usage:
#   ./scripts/sign.sh --identity "Developer ID Application: Your Name (TEAMID)"
#   ./scripts/sign.sh --identity "..." --notarize \
#                     --apple-id "you@email.com" \
#                     --team-id "ABCD123456" \
#                     --password "xxxx-xxxx-xxxx-xxxx"
#
# Arguments:
#   --identity   <string>   Developer ID Application certificate name (required)
#   --notarize              Submit to Apple Notary Service and staple ticket
#   --apple-id   <string>   Apple ID email (required with --notarize)
#   --team-id    <string>   10-char Apple Team ID (required with --notarize)
#   --password   <string>   App-specific password (required with --notarize)
#   --app        <path>     Path to .app bundle (default: auto-detected from build output)
#   --help                  Show this help
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

# ---------------------------------------------------------------------------
# Defaults
# ---------------------------------------------------------------------------
SIGNING_IDENTITY=""
APPLE_ID=""
APPLE_TEAM_ID=""
APPLE_APP_PASSWORD=""
NOTARIZE=false
APP_PATH="src-tauri/target/release/bundle/macos/Neo Edit.app"
ENTITLEMENTS="src-tauri/entitlements.plist"

# ---------------------------------------------------------------------------
# Parse arguments
# ---------------------------------------------------------------------------
usage() {
  sed -n '/^# Usage:/,/^# ===/p' "$0" | sed 's/^# \{0,3\}//'
  exit 0
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --identity)   SIGNING_IDENTITY="$2"; shift 2 ;;
    --apple-id)   APPLE_ID="$2";         shift 2 ;;
    --team-id)    APPLE_TEAM_ID="$2";    shift 2 ;;
    --password)   APPLE_APP_PASSWORD="$2"; shift 2 ;;
    --app)        APP_PATH="$2";         shift 2 ;;
    --notarize)   NOTARIZE=true;         shift   ;;
    --help|-h)    usage ;;
    *) echo "Unknown argument: $1"; echo "Run with --help for usage."; exit 1 ;;
  esac
done

# ---------------------------------------------------------------------------
# Validate arguments
# ---------------------------------------------------------------------------
if [ -z "$SIGNING_IDENTITY" ]; then
  echo "ERROR: --identity is required."
  echo ""
  echo "  Available identities on this machine:"
  security find-identity -v -p codesigning 2>/dev/null || echo "  (none found)"
  echo ""
  echo "  Example:"
  echo '    ./scripts/sign.sh --identity "Developer ID Application: Your Name (TEAMID)"'
  exit 1
fi

if [ ! -d "$APP_PATH" ]; then
  echo "ERROR: App bundle not found at: $APP_PATH"
  echo "       Run 'bun run build' or 'cargo tauri build' first."
  exit 1
fi

if $NOTARIZE; then
  missing=()
  [ -z "$APPLE_ID" ]           && missing+=("--apple-id")
  [ -z "$APPLE_TEAM_ID" ]      && missing+=("--team-id")
  [ -z "$APPLE_APP_PASSWORD" ] && missing+=("--password")
  if [ ${#missing[@]} -gt 0 ]; then
    echo "ERROR: --notarize also requires: ${missing[*]}"
    echo ""
    echo "  Example:"
    echo '    ./scripts/sign.sh --identity "Developer ID Application: ..." \'
    echo '                      --notarize \'
    echo '                      --apple-id "you@email.com" \'
    echo '                      --team-id "ABCD123456" \'
    echo '                      --password "xxxx-xxxx-xxxx-xxxx"'
    exit 1
  fi
fi

# ---------------------------------------------------------------------------
# Step 1: Validate identity exists in Keychain
# ---------------------------------------------------------------------------
echo "==> Checking signing identity..."
if ! security find-identity -v -p codesigning | grep -qF "$SIGNING_IDENTITY"; then
  echo "ERROR: Identity not found in Keychain: \"$SIGNING_IDENTITY\""
  echo ""
  echo "  Available code-signing identities on this machine:"
  security find-identity -v -p codesigning 2>/dev/null || echo "  (none)"
  echo ""
  echo "  Pass the full certificate name exactly as shown above, e.g.:"
  echo '    --identity "Developer ID Application: Your Name (ABCD123456)"'
  echo ""
  echo "  If the list is empty, you need to install a Developer ID certificate."
  echo "  See: https://developer.apple.com/account/resources/certificates/list"
  exit 1
fi
echo "    Found: $SIGNING_IDENTITY"

# ---------------------------------------------------------------------------
# Step 2: Strip quarantine flags
# ---------------------------------------------------------------------------
echo "==> Preparing app bundle..."
xattr -cr "$APP_PATH"

# ---------------------------------------------------------------------------
# Step 3: Sign nested components (dylibs, frameworks, helper binaries)
# ---------------------------------------------------------------------------
echo "==> Signing nested components..."
find "$APP_PATH/Contents" \
  \( -name "*.dylib" -o -name "*.so" \) \
  -print0 | while IFS= read -r -d '' f; do
    codesign --force --sign "$SIGNING_IDENTITY" \
      --options runtime \
      --entitlements "$ENTITLEMENTS" \
      "$f" 2>/dev/null || true
done

find "$APP_PATH/Contents" -name "*.framework" -print0 | \
  while IFS= read -r -d '' f; do
    codesign --force --sign "$SIGNING_IDENTITY" \
      --options runtime \
      "$f" 2>/dev/null || true
done

find "$APP_PATH/Contents/MacOS" -type f -print0 | \
  while IFS= read -r -d '' f; do
    codesign --force --sign "$SIGNING_IDENTITY" \
      --options runtime \
      --entitlements "$ENTITLEMENTS" \
      "$f" 2>/dev/null || true
done

# ---------------------------------------------------------------------------
# Step 3: Sign the main app bundle
# ---------------------------------------------------------------------------
echo "==> Signing $APP_PATH..."
codesign \
  --force \
  --sign "$SIGNING_IDENTITY" \
  --options runtime \
  --entitlements "$ENTITLEMENTS" \
  --timestamp \
  --verbose \
  "$APP_PATH"

# ---------------------------------------------------------------------------
# Step 4: Verify
# ---------------------------------------------------------------------------
echo "==> Verifying signature..."
codesign --verify --deep --strict --verbose=2 "$APP_PATH"
if $NOTARIZE; then
  echo "    Signature valid (notarization pending — skipping Gatekeeper check)."
else
  spctl --assess --type execute --verbose "$APP_PATH"
  echo "    Signature OK."
fi

# ---------------------------------------------------------------------------
# Step 5: Notarize + staple (optional)
# ---------------------------------------------------------------------------
if $NOTARIZE; then
  ZIP_PATH="/tmp/NeoEdit-notarize.zip"

  echo "==> Zipping for notarization..."
  ditto -c -k --keepParent "$APP_PATH" "$ZIP_PATH"

  echo "==> Submitting to Apple Notary Service (may take a few minutes)..."
  xcrun notarytool submit "$ZIP_PATH" \
    --apple-id "$APPLE_ID" \
    --team-id "$APPLE_TEAM_ID" \
    --password "$APPLE_APP_PASSWORD" \
    --wait \
    --progress

  echo "==> Stapling notarization ticket..."
  xcrun stapler staple "$APP_PATH"

  echo "==> Verifying notarization..."
  spctl --assess --type execute --verbose "$APP_PATH"

  rm -f "$ZIP_PATH"
  echo "    Notarization complete."
fi

# ---------------------------------------------------------------------------
# Done
# ---------------------------------------------------------------------------
echo ""
echo "Done!"
echo "  App: $APP_PATH"
if $NOTARIZE; then
  echo "  Notarized and stapled — the app will pass Gatekeeper and appear in 'Open With'."
else
  echo ""
  echo "  To also notarize, add:"
  echo '    --notarize --apple-id "you@email.com" --team-id "ABCD123456" --password "xxxx-xxxx-xxxx-xxxx"'
fi
