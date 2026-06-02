#!/bin/bash
# =============================================================================
# setup-apple-signing.sh — Interactive guide to set up macOS code signing
#
# This script walks you through:
#   1. Generating a private key and CSR
#   2. Uploading the CSR to Apple (opens the browser)
#   3. Importing the downloaded certificate + private key into your Keychain
#   4. Verifying the signing identity is ready
#
# Usage:
#   ./scripts/setup-apple-signing.sh
# =============================================================================
set -euo pipefail

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
error()   { echo -e "${RED}ERROR:${RESET} $*"; }
prompt()  { echo -e "${BOLD}$*${RESET}"; }
divider() { echo -e "\n${CYAN}────────────────────────────────────────────────────────${RESET}\n"; }

ask() {
  local var="$1"
  local message="$2"
  local default="${3:-}"
  if [ -n "$default" ]; then
    prompt "$message [$default]: "
  else
    prompt "$message: "
  fi
  read -r input
  if [ -z "$input" ] && [ -n "$default" ]; then
    eval "$var=\"$default\""
  else
    eval "$var=\"$input\""
  fi
}

ask_yn() {
  local message="$1"
  local default="${2:-y}"
  prompt "$message [${default}]: "
  read -r input
  input="${input:-$default}"
  [[ "$input" =~ ^[Yy] ]]
}

pause() {
  prompt "Press Enter to continue..."
  read -r
}

# Move an existing file to a redundant folder instead of overwriting/deleting
safe_move() {
  local src="$1"
  local redundant_dir="$HOME/.neopad-signing-backup"
  mkdir -p "$redundant_dir"
  local timestamp
  timestamp="$(date +%Y%m%d_%H%M%S)"
  local dest="$redundant_dir/$(basename "$src").$timestamp"
  mv "$src" "$dest"
  warn "Existing file moved to: $dest (delete manually when no longer needed)"
}

# ---------------------------------------------------------------------------
# Banner
# ---------------------------------------------------------------------------
clear
echo -e "${BOLD}"
echo "  ╔══════════════════════════════════════════════╗"
echo "  ║        NeoPad — Code Signing Setup         ║"
echo "  ╚══════════════════════════════════════════════╝"
echo -e "${RESET}"
echo "  This script guides you through setting up a Developer ID certificate."
echo ""
echo "  Requirements:"
echo "    • Apple Developer Program membership (\$99/year)"
echo "    • Your Apple ID and Team ID"
echo ""

if ! ask_yn "Ready to begin?"; then
  echo "Aborted."; exit 0
fi

# ---------------------------------------------------------------------------
# Step 0 — Check for existing valid identity
# ---------------------------------------------------------------------------
divider
info "Step 0 of 4 — Checking for existing signing identity..."
echo ""

EXISTING=$(security find-identity -v -p codesigning 2>/dev/null | grep "Developer ID Application" || true)

if [ -n "$EXISTING" ]; then
  echo -e "${GREEN}A Developer ID certificate is already installed:${RESET}"
  echo ""
  echo "$EXISTING"
  echo ""
  if ask_yn "Use the existing identity and skip certificate creation?"; then
    IDENTITY=$(echo "$EXISTING" | head -1 | sed 's/.*"\(.*\)"/\1/')
    success "Using: $IDENTITY"
    divider
    echo -e "${GREEN}${BOLD}All done — your machine is ready to sign NeoPad!${RESET}"
    echo ""
    echo "  Run the sign script:"
    echo ""
    echo "    ./scripts/sign.sh --identity \"$IDENTITY\""
    echo ""
    echo "  Or to sign + notarize:"
    echo ""
    echo "    ./scripts/sign.sh \\"
    echo "      --identity \"$IDENTITY\" \\"
    echo "      --notarize \\"
    echo "      --apple-id \"you@email.com\" \\"
    echo "      --team-id \"YOUR_TEAM_ID\" \\"
    echo "      --password \"xxxx-xxxx-xxxx-xxxx\""
    exit 0
  fi
fi

success "No existing identity — proceeding with setup."

# ---------------------------------------------------------------------------
# Step 1 — Collect user info
# ---------------------------------------------------------------------------
divider
info "Step 1 of 4 — Your details"
echo ""
echo "  These are used to generate the Certificate Signing Request (CSR)."
echo ""

ask EMAIL     "Apple ID email address"
ask FULL_NAME "Your full name (as registered with Apple)"
ask COUNTRY   "Two-letter country code" "US"

KEY_PATH="$HOME/developer_id.key"
CSR_PATH="$HOME/developer_id.csr"

# ---------------------------------------------------------------------------
# Step 2 — Generate private key and CSR
# ---------------------------------------------------------------------------
divider
info "Step 2 of 4 — Generating private key and CSR..."
echo ""

if [ -f "$KEY_PATH" ]; then
  warn "A private key already exists at $KEY_PATH"
  if ask_yn "Move it to a backup folder and generate a new one?"; then
    safe_move "$KEY_PATH"
    [ -f "$CSR_PATH" ] && safe_move "$CSR_PATH"
  else
    info "Using existing key: $KEY_PATH"
  fi
fi

if [ ! -f "$KEY_PATH" ]; then
  info "Generating 2048-bit RSA private key..."
  openssl genrsa -out "$KEY_PATH" 2048
  chmod 600 "$KEY_PATH"
  success "Private key saved to: $KEY_PATH"
fi

if [ ! -f "$CSR_PATH" ]; then
  info "Generating Certificate Signing Request..."
  openssl req -new \
    -key "$KEY_PATH" \
    -out "$CSR_PATH" \
    -subj "/emailAddress=${EMAIL}/CN=${FULL_NAME}/C=${COUNTRY}"
  success "CSR saved to: $CSR_PATH"
fi

echo ""
echo "  The CSR file is at:"
echo -e "  ${BOLD}$CSR_PATH${RESET}"

# ---------------------------------------------------------------------------
# Step 3 — Upload CSR to Apple
# ---------------------------------------------------------------------------
divider
info "Step 3 of 4 — Create certificate on Apple Developer Portal"
echo ""
echo "  We will open the Apple certificate creation page in your browser."
echo "  Follow these steps carefully:"
echo ""
echo -e "  ${BOLD}3a. Select certificate type:${RESET}"
echo -e "      You will see a list of certificate types."
echo -e "      Select → ${BOLD}Developer ID Application${RESET}"
echo -e "      Click  → ${BOLD}Continue${RESET}"
echo ""
echo -e "  ${BOLD}3b. Select intermediary (Sub-CA):${RESET}"
echo -e "      Apple will ask you to choose a certificate intermediary."
echo -e "      Select → ${BOLD}G2 Sub-CA (Xcode 11.4.1 or later)${RESET}  <- recommended"
echo -e "      (Only choose 'Previous Sub-CA' if you need to support macOS"
echo -e "       releases older than mid-2020 — almost certainly not needed.)"
echo -e "      Click  → ${BOLD}Continue${RESET}"
echo ""
echo -e "  ${BOLD}3c. Upload your CSR:${RESET}"
echo -e "      Click  → ${BOLD}Choose File${RESET}"
echo -e "      Select → ${BOLD}$CSR_PATH${RESET}"
echo -e "      Click  → ${BOLD}Continue${RESET}"
echo ""
echo -e "  ${BOLD}3d. Download the certificate:${RESET}"
echo -e "      Click  → ${BOLD}Download${RESET}"
echo -e "      The file will be saved to your Downloads folder."
echo ""

pause

open "https://developer.apple.com/account/resources/certificates/add" 2>/dev/null || \
  warn "Could not open browser — visit: https://developer.apple.com/account/resources/certificates/add"

echo ""
warn "Complete the steps in the browser, download the .cer file, then return here."
echo ""
pause

# ---------------------------------------------------------------------------
# Locate the downloaded .cer file
# ---------------------------------------------------------------------------
CER_PATH=""
SEARCH_PATHS=(
  "$HOME/Downloads/developer_id_application.cer"
  "$HOME/Downloads/developerID_application.cer"
  "$HOME/Downloads/DeveloperIDApplication.cer"
  "$HOME/Desktop/developer_id_application.cer"
)

for p in "${SEARCH_PATHS[@]}"; do
  if [ -f "$p" ]; then
    CER_PATH="$p"
    success "Found certificate at: $CER_PATH"
    break
  fi
done

if [ -z "$CER_PATH" ]; then
  # Try finding any recently downloaded .cer file
  RECENT_CER=$(find "$HOME/Downloads" -name "*.cer" -newer "$CSR_PATH" 2>/dev/null | head -1 || true)
  if [ -n "$RECENT_CER" ]; then
    CER_PATH="$RECENT_CER"
    success "Found certificate at: $CER_PATH"
  fi
fi

if [ -z "$CER_PATH" ]; then
  warn "Could not auto-detect the downloaded .cer file."
  ask CER_PATH "Enter the full path to the downloaded .cer file"
fi

if [ ! -f "$CER_PATH" ]; then
  error "File not found: $CER_PATH"
  exit 1
fi

# ---------------------------------------------------------------------------
# Step 4 — Import certificate and private key into Keychain
# ---------------------------------------------------------------------------
divider
info "Step 4 of 4 — Installing certificate into your Login Keychain..."
echo ""

info "Importing certificate..."
security import "$CER_PATH" \
  -k ~/Library/Keychains/login.keychain-db \
  2>/dev/null && success "Certificate imported." || \
  warn "Certificate may already be in Keychain — continuing."

info "Importing private key..."
security import "$KEY_PATH" \
  -k ~/Library/Keychains/login.keychain-db \
  -T /usr/bin/codesign \
  2>/dev/null && success "Private key imported." || \
  warn "Private key may already be in Keychain — continuing."

# ---------------------------------------------------------------------------
# Install Apple intermediate CA certificates (required for chain of trust)
# Xcode normally installs these automatically — we do it manually here.
# ---------------------------------------------------------------------------
info "Installing Apple intermediate CA certificates (required for trust chain)..."

APPLE_ROOT_G3="/tmp/AppleRootCA-G3.cer"
DEVELOPER_ID_G2="/tmp/DeveloperIDG2CA.cer"

echo "    Downloading Apple Root CA G3..."
curl -sf -o "$APPLE_ROOT_G3" \
  "https://www.apple.com/appleca/AppleRootCA-G3.cer" && \
  success "Downloaded Apple Root CA G3." || \
  warn "Could not download Apple Root CA G3 — skipping."

echo "    Downloading Developer ID Certification Authority G2..."
curl -sf -o "$DEVELOPER_ID_G2" \
  "https://www.apple.com/certificateauthority/DeveloperIDG2CA.cer" && \
  success "Downloaded Developer ID G2 CA." || \
  warn "Could not download Developer ID G2 CA — skipping."

[ -f "$APPLE_ROOT_G3" ] && \
  security import "$APPLE_ROOT_G3" \
    -k ~/Library/Keychains/login.keychain-db 2>/dev/null || true

[ -f "$DEVELOPER_ID_G2" ] && \
  security import "$DEVELOPER_ID_G2" \
    -k ~/Library/Keychains/login.keychain-db 2>/dev/null || true

success "CA certificates installed."

# Allow codesign to access the key without password prompts
info "Setting key partition list (you may be prompted for your login password)..."
security set-key-partition-list \
  -S apple-tool:,apple: \
  -s \
  -k "" \
  ~/Library/Keychains/login.keychain-db 2>/dev/null || \
  warn "Could not set partition list automatically — you may see password prompts when signing."

# ---------------------------------------------------------------------------
# Verify
# ---------------------------------------------------------------------------
divider
info "Verifying signing identity..."
echo ""

FOUND=$(security find-identity -v -p codesigning 2>/dev/null | grep "Developer ID Application" || true)

if [ -z "$FOUND" ]; then
  error "No valid Developer ID found after import."
  echo ""
  echo "  Possible causes:"
  echo "    • The .cer file didn't match the private key"
  echo "    • The certificate wasn't downloaded correctly from Apple"
  echo "    • Try opening Keychain Access.app and checking for errors"
  echo ""
  echo "  Run this to inspect your keychains:"
  echo "    security find-identity -v"
  exit 1
fi

success "Signing identity ready:"
echo ""
echo "$FOUND" | while read -r line; do
  echo "    $line"
done

IDENTITY=$(echo "$FOUND" | head -1 | sed 's/.*"\(.*\)"/\1/')

# ---------------------------------------------------------------------------
# Done
# ---------------------------------------------------------------------------
divider
echo -e "${GREEN}${BOLD}Setup complete!${RESET}"
echo ""
echo "  Your signing identity:"
echo -e "  ${BOLD}$IDENTITY${RESET}"
echo ""
echo "  Sign NeoPad:"
echo ""
echo "    ./scripts/sign.sh \\"
echo "      --identity \"$IDENTITY\""
echo ""
echo "  Sign + notarize:"
echo ""
echo "    ./scripts/sign.sh \\"
echo "      --identity \"$IDENTITY\" \\"
echo "      --notarize \\"
echo "      --apple-id \"$EMAIL\" \\"
echo "      --team-id \"YOUR_TEAM_ID\" \\"
echo "      --password \"xxxx-xxxx-xxxx-xxxx\""
echo ""
echo "  Get an app-specific password at:"
echo "    https://appleid.apple.com → Sign-In and Security → App-Specific Passwords"
echo ""

# Offer to move (not delete) the CSR
if ask_yn "Move the CSR file to the backup folder (no longer needed)?"; then
  safe_move "$CSR_PATH"
fi

echo ""
warn "Keep your private key safe: $KEY_PATH"
warn "Back it up securely — if lost, you must revoke and recreate the certificate."
warn "Backup folder for old files: $HOME/.neopad-signing-backup"
