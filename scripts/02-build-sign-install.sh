#!/bin/bash
# =============================================================================
# build-sign-install.sh — Build, sign, notarize, and install NeoPad
#
# Usage:
#   ./scripts/build-sign-install.sh \
#     --identity "Developer ID Application: Your Name (TEAMID)" \
#     --apple-id "you@email.com" \
#     --team-id "ABCD123456" \
#     --password "xxxx-xxxx-xxxx-xxxx"
#
# Arguments:
#   --identity   <string>   Developer ID Application certificate name (required)
#   --apple-id   <string>   Apple ID email (required for notarization)
#   --team-id    <string>   10-char Apple Team ID (required for notarization)
#   --password   <string>   App-specific password (required for notarization)
#   --skip-build            Skip the build step (sign + notarize + install only)
#   --skip-notarize         Skip notarization (build + sign + install only)
#   --skip-install          Skip installing to /Applications
#   --skip-dmg              Skip creating the DMG
#   --help                  Show this help
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
BOLD="\033[1m"
GREEN="\033[0;32m"
YELLOW="\033[0;33m"
RED="\033[0;31m"
CYAN="\033[0;36m"
RESET="\033[0m"

info()    { echo -e "${CYAN}==>${RESET} $*"; }
success() { echo -e "${GREEN}✓${RESET}  $*"; }
warn()    { echo -e "${YELLOW}!${RESET}  $*"; }
fail()    { echo -e "${RED}ERROR:${RESET} $*"; exit 1; }
divider() { echo -e "\n${CYAN}────────────────────────────────────────────────────────${RESET}\n"; }

# ---------------------------------------------------------------------------
# Load .env (project root takes precedence over scripts/)
# ---------------------------------------------------------------------------
for _env in "$(dirname "$SCRIPT_DIR")/.env" "$SCRIPT_DIR/.env"; do
  if [ -f "$_env" ]; then
    # shellcheck disable=SC1090
    set -a; source "$_env"; set +a
    break
  fi
done

# ---------------------------------------------------------------------------
# Defaults  (env vars pre-fill; CLI args override below)
# ---------------------------------------------------------------------------
SIGNING_IDENTITY="${NEOPAD_SIGNING_IDENTITY:-}"
APPLE_ID="${NEOPAD_APPLE_ID:-}"
APPLE_TEAM_ID="${NEOPAD_TEAM_ID:-}"
APPLE_APP_PASSWORD="${NEOPAD_APP_PASSWORD:-}"
SKIP_BUILD=false
SKIP_NOTARIZE=false
SKIP_INSTALL=false
SKIP_DMG=false

APP_NAME="NeoPad"
APP_PATH="src-tauri/target/release/bundle/macos/NeoPad.app"
DMG_DIR="dist"
ENTITLEMENTS="src-tauri/entitlements.plist"
INSTALL_PATH="/Applications/NeoPad.app"
LSREGISTER="/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"

# ---------------------------------------------------------------------------
# Parse arguments
# ---------------------------------------------------------------------------
usage() {
  sed -n '/^# Usage:/,/^# ===/p' "$0" | sed 's/^# \{0,3\}//'
  exit 0
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --identity)        SIGNING_IDENTITY="$2";   shift 2 ;;
    --apple-id)        APPLE_ID="$2";           shift 2 ;;
    --team-id)         APPLE_TEAM_ID="$2";      shift 2 ;;
    --password)        APPLE_APP_PASSWORD="$2"; shift 2 ;;
    --skip-build)      SKIP_BUILD=true;         shift   ;;
    --skip-notarize)   SKIP_NOTARIZE=true;      shift   ;;
    --skip-install)    SKIP_INSTALL=true;       shift   ;;
    --skip-dmg)        SKIP_DMG=true;           shift   ;;
    --help|-h)         usage ;;
    *) echo "Unknown argument: $1"; echo "Run with --help for usage."; exit 1 ;;
  esac
done

# ---------------------------------------------------------------------------
# Validate
# ---------------------------------------------------------------------------
if [ -z "$SIGNING_IDENTITY" ]; then
  fail "--identity is required.\n\n  Available identities:\n$(security find-identity -v -p codesigning 2>/dev/null || echo '  (none)')\n\n  Example:\n    --identity \"Developer ID Application: Your Name (TEAMID)\""
fi

if ! security find-identity -v -p codesigning | grep -qF "$SIGNING_IDENTITY"; then
  fail "Identity not found in Keychain: \"$SIGNING_IDENTITY\"\n\n  Available:\n$(security find-identity -v -p codesigning 2>/dev/null || echo '  (none)')"
fi

if ! $SKIP_NOTARIZE; then
  missing=()
  [ -z "$APPLE_ID" ]           && missing+=("--apple-id")
  [ -z "$APPLE_TEAM_ID" ]      && missing+=("--team-id")
  [ -z "$APPLE_APP_PASSWORD" ] && missing+=("--password")
  if [ ${#missing[@]} -gt 0 ]; then
    fail "Notarization requires: ${missing[*]}\n  Or pass --skip-notarize to skip."
  fi
fi

# ---------------------------------------------------------------------------
# Banner
# ---------------------------------------------------------------------------
echo -e "${BOLD}"
echo "  ╔══════════════════════════════════════════════╗"
echo "  ║     NeoPad — Build, Sign & Install         ║"
echo "  ╚══════════════════════════════════════════════╝"
echo -e "${RESET}"

VERSION="$(awk '/^## Current Version/{getline; print; exit}' version.md | tr -d '[:space:]')"
echo -e "  Version  : ${BOLD}${VERSION}${RESET}"
echo -e "  Identity : ${BOLD}${SIGNING_IDENTITY}${RESET}"
$SKIP_BUILD     && echo -e "  Build    : ${YELLOW}skipped${RESET}" || echo -e "  Build    : ${GREEN}yes${RESET}"
$SKIP_NOTARIZE  && echo -e "  Notarize : ${YELLOW}skipped${RESET}" || echo -e "  Notarize : ${GREEN}yes${RESET}"
$SKIP_INSTALL   && echo -e "  Install  : ${YELLOW}skipped${RESET}" || echo -e "  Install  : ${GREEN}yes${RESET}"
$SKIP_DMG       && echo -e "  DMG      : ${YELLOW}skipped${RESET}" || echo -e "  DMG      : ${GREEN}yes${RESET}"

# ═══════════════════════════════════════════════════════════════════════════
# STEP 1: BUILD
# ═══════════════════════════════════════════════════════════════════════════
divider
if $SKIP_BUILD; then
  info "Skipping build (--skip-build)"
  if [ ! -d "$APP_PATH" ]; then
    fail "App bundle not found at: $APP_PATH\n       Cannot skip build — no existing bundle found."
  fi
else
  info "Step 1/5 — Building NeoPad v${VERSION}..."

  # Sync version from version.md into package.json, Cargo.toml, tauri.conf.json
  sed -i '' "s/\"version\": \".*\"/\"version\": \"${VERSION}\"/" package.json
  sed -i '' "s/^version = \".*\"/version = \"${VERSION}\"/" src-tauri/Cargo.toml
  sed -i '' "s/\"version\": \".*\"/\"version\": \"${VERSION}\"/" src-tauri/tauri.conf.json
  echo "    Version synced to ${VERSION}"

  # Build frontend
  info "Building frontend..."
  bun run build:vite

  # Build Tauri app
  info "Building Tauri app..."
  rm -rf src-tauri/target/release/bundle
  cargo tauri build 2>&1

  if [ ! -d "$APP_PATH" ]; then
    fail "Build failed — app bundle not found at: $APP_PATH"
  fi
  success "Build complete: $APP_PATH"
fi

# ═══════════════════════════════════════════════════════════════════════════
# STEP 2: SIGN
# ═══════════════════════════════════════════════════════════════════════════
divider
info "Step 2/5 — Signing..."

# Strip quarantine flags
xattr -cr "$APP_PATH"

# Sign nested components
info "Signing nested components..."
find "$APP_PATH/Contents" \
  \( -name "*.dylib" -o -name "*.so" \) \
  -print0 2>/dev/null | while IFS= read -r -d '' f; do
    codesign --force --sign "$SIGNING_IDENTITY" \
      --options runtime \
      --entitlements "$ENTITLEMENTS" \
      "$f" 2>/dev/null || true
done

find "$APP_PATH/Contents" -name "*.framework" -print0 2>/dev/null | \
  while IFS= read -r -d '' f; do
    codesign --force --sign "$SIGNING_IDENTITY" \
      --options runtime \
      "$f" 2>/dev/null || true
done

find "$APP_PATH/Contents/MacOS" -type f -print0 2>/dev/null | \
  while IFS= read -r -d '' f; do
    codesign --force --sign "$SIGNING_IDENTITY" \
      --options runtime \
      --entitlements "$ENTITLEMENTS" \
      "$f" 2>/dev/null || true
done

# Sign the main bundle
info "Signing app bundle..."
codesign \
  --force \
  --sign "$SIGNING_IDENTITY" \
  --options runtime \
  --entitlements "$ENTITLEMENTS" \
  --timestamp \
  --verbose \
  "$APP_PATH"

# Verify signature
codesign --verify --deep --strict --verbose=2 "$APP_PATH"
success "Signed and verified."

# ═══════════════════════════════════════════════════════════════════════════
# STEP 3: NOTARIZE
# ═══════════════════════════════════════════════════════════════════════════
divider
if $SKIP_NOTARIZE; then
  info "Step 3/5 — Skipping notarization (--skip-notarize)"
else
  info "Step 3/5 — Notarizing..."

  ZIP_PATH="/tmp/NeoPad-notarize.zip"

  info "Creating zip for upload..."
  ditto -c -k --keepParent "$APP_PATH" "$ZIP_PATH"

  info "Submitting to Apple Notary Service (may take a few minutes)..."
  xcrun notarytool submit "$ZIP_PATH" \
    --apple-id "$APPLE_ID" \
    --team-id "$APPLE_TEAM_ID" \
    --password "$APPLE_APP_PASSWORD" \
    --wait \
    --progress

  info "Stapling notarization ticket..."
  xcrun stapler staple "$APP_PATH"

  info "Verifying notarization..."
  spctl --assess --type execute --verbose "$APP_PATH"

  rm -f "$ZIP_PATH"
  success "Notarized and stapled."
fi

# ═══════════════════════════════════════════════════════════════════════════
# STEP 4: INSTALL
# ═══════════════════════════════════════════════════════════════════════════
divider
if $SKIP_INSTALL; then
  info "Step 4/5 — Skipping install (--skip-install)"
else
  info "Step 4/5 — Installing to /Applications..."

  # Remove existing installation
  if [ -d "$INSTALL_PATH" ]; then
    "$LSREGISTER" -u "$INSTALL_PATH" 2>/dev/null || true
    rm -rf "$INSTALL_PATH"
  fi

  # Copy
  cp -R "$APP_PATH" /Applications/
  success "Copied to $INSTALL_PATH"

  # Register with Launch Services
  info "Registering file associations..."
  "$LSREGISTER" -f "$INSTALL_PATH" 2>/dev/null
  success "Registered with Launch Services."

  # Restart Finder
  info "Restarting Finder..."
  killall Finder 2>/dev/null || true
  success "Finder restarted."

  # Verify
  FINAL_CHECK=$(spctl --assess --type execute --verbose "$INSTALL_PATH" 2>&1 || true)
  echo -e "    $FINAL_CHECK"
fi

# ═══════════════════════════════════════════════════════════════════════════
# STEP 5: DMG
# ═══════════════════════════════════════════════════════════════════════════
divider
if $SKIP_DMG; then
  info "Step 5/5 — Skipping DMG (--skip-dmg)"
else
  info "Step 5/5 — Creating DMG..."

  mkdir -p "$DMG_DIR"
  DMG_PATH="$DMG_DIR/NeoPad-${VERSION}-signed.dmg"

  # Remove old DMG
  rm -f "$DMG_PATH"

  # Create DMG
  hdiutil create -volname "$APP_NAME" \
    -srcfolder "$APP_PATH" \
    -ov -format UDZO \
    "$DMG_PATH"

  # Sign DMG
  info "Signing DMG..."
  codesign --sign "$SIGNING_IDENTITY" --timestamp "$DMG_PATH"

  if ! $SKIP_NOTARIZE; then
    info "Notarizing DMG..."
    xcrun notarytool submit "$DMG_PATH" \
      --apple-id "$APPLE_ID" \
      --team-id "$APPLE_TEAM_ID" \
      --password "$APPLE_APP_PASSWORD" \
      --wait \
      --progress

    xcrun stapler staple "$DMG_PATH"
    success "DMG notarized and stapled."
  fi

  success "DMG: $DMG_PATH"
fi

# ═══════════════════════════════════════════════════════════════════════════
# DONE
# ═══════════════════════════════════════════════════════════════════════════
divider
echo -e "${GREEN}${BOLD}All done!${RESET}"
echo ""
echo -e "  Version : ${BOLD}v${VERSION}${RESET}"
! $SKIP_INSTALL && echo -e "  App     : ${BOLD}${INSTALL_PATH}${RESET}"
! $SKIP_DMG     && echo -e "  DMG     : ${BOLD}${DMG_DIR}/NeoPad-${VERSION}-signed.dmg${RESET}"
echo ""
! $SKIP_INSTALL && echo -e "  Launch: ${BOLD}open -a \"NeoPad\"${RESET}"
echo ""
