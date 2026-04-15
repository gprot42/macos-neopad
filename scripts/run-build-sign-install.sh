#!/bin/bash
# Wrapper script — builds, signs, notarizes, and installs Neo Edit in one step
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

"$SCRIPT_DIR/02-build-sign-install.sh" \
  --identity "Developer ID Application: Darren Evans (8548LNB384)" \
  --apple-id "darren_dev@dazdaz.org" \
  --team-id "8548LNB384" \
  --password "uflv-pxoa-poha-fhno"
