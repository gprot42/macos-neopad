#!/bin/bash
# =============================================================================
# install.sh — Install Neo Edit.app into /Applications
#
# Usage:
#   ./scripts/install.sh
#
# This script:
#   1. Verifies the app bundle has been built
#   2. Checks the app is signed (warns if not notarized)
#   3. Removes any existing installation
#   4. Copies the app to /Applications
#   5. Registers with Launch Services
#   6. Restarts Finder
#   7. Verifies Gatekeeper acceptance
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
error()   { echo -e "${RED}ERROR:${RESET} $*"; exit 1; }
divider() { echo -e "\n${CYAN}────────────────────────────────────────────────────────${RESET}\n"; }

APP_NAME="Neo Edit"
APP_BUNDLE="src-tauri/target/release/bundle/macos/Neo Edit.app"
INSTALL_PATH="/Applications/Neo Edit.app"
LSREGISTER="/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"

# ---------------------------------------------------------------------------
# Banner
# ---------------------------------------------------------------------------
echo -e "${BOLD}"
echo "  ╔══════════════════════════════════════════════╗"
echo "  ║          Neo Edit — Install                  ║"
echo "  ╚══════════════════════════════════════════════╝"
echo -e "${RESET}"

# ---------------------------------------------------------------------------
# Step 1: Verify app bundle exists
# ---------------------------------------------------------------------------
info "Checking build output..."

if [ ! -d "$APP_BUNDLE" ]; then
  error "App bundle not found at: $APP_BUNDLE\n       Run 'bun run build' or 'cargo tauri build' first."
fi

success "Found: $APP_BUNDLE"

# ---------------------------------------------------------------------------
# Step 2: Check signature status
# ---------------------------------------------------------------------------
info "Checking code signature..."

if ! codesign --verify --deep --strict "$APP_BUNDLE" 2>/dev/null; then
  warn "App bundle is not signed. It may be blocked by Gatekeeper."
  warn "Run ./scripts/run-sign-apple.sh to sign and notarize before installing."
  echo ""
fi

GATEKEEPER=$(spctl --assess --type execute "$APP_BUNDLE" 2>&1 || true)
if echo "$GATEKEEPER" | grep -q "accepted"; then
  success "Gatekeeper: accepted (notarized)"
elif echo "$GATEKEEPER" | grep -q "Unnotarized"; then
  warn "Gatekeeper: signed but not notarized — 'Open With' may not appear in Finder."
  warn "Run ./scripts/run-sign-apple.sh --notarize to fix this."
else
  warn "Gatekeeper: not signed — app will require manual approval on first launch."
fi

# ---------------------------------------------------------------------------
# Step 3: Remove existing installation
# ---------------------------------------------------------------------------
divider
info "Installing $APP_NAME to /Applications..."

if [ -d "$INSTALL_PATH" ]; then
  info "Removing existing installation..."
  # Unregister from Launch Services first
  "$LSREGISTER" -u "$INSTALL_PATH" 2>/dev/null || true
  rm -rf "$INSTALL_PATH"
  success "Removed old installation."
fi

# ---------------------------------------------------------------------------
# Step 4: Copy app bundle
# ---------------------------------------------------------------------------
info "Copying app bundle..."
cp -R "$APP_BUNDLE" /Applications/
success "Copied to $INSTALL_PATH"

# ---------------------------------------------------------------------------
# Step 5: Register with Launch Services
# ---------------------------------------------------------------------------
info "Registering with Launch Services..."
"$LSREGISTER" -f "$INSTALL_PATH" 2>/dev/null
success "Registered file associations."

# ---------------------------------------------------------------------------
# Step 6: Restart Finder
# ---------------------------------------------------------------------------
info "Restarting Finder to refresh Open With menu..."
killall Finder 2>/dev/null || true
success "Finder restarted."

# ---------------------------------------------------------------------------
# Step 7: Final verification
# ---------------------------------------------------------------------------
divider
info "Verifying installation..."

if [ ! -d "$INSTALL_PATH" ]; then
  error "Installation failed — app not found at $INSTALL_PATH"
fi

FINAL_CHECK=$(spctl --assess --type execute --verbose "$INSTALL_PATH" 2>&1 || true)
echo "    $FINAL_CHECK"

# ---------------------------------------------------------------------------
# Done
# ---------------------------------------------------------------------------
divider
echo -e "${GREEN}${BOLD}Neo Edit installed successfully!${RESET}"
echo ""
echo "  Location : $INSTALL_PATH"
echo "  Version  : $(defaults read "$INSTALL_PATH/Contents/Info.plist" CFBundleShortVersionString 2>/dev/null || echo "unknown")"
echo ""

if echo "$FINAL_CHECK" | grep -q "accepted"; then
  success "Notarized — Neo Edit will appear in Finder's 'Open With' menu."
else
  warn "Not notarized — run ./scripts/run-sign-apple.sh --notarize for full Gatekeeper trust."
fi

echo ""
echo "  Launch Neo Edit:"
echo "    open -a \"Neo Edit\""
echo ""
