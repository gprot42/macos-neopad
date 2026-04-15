# Neo Edit — Developer Notes

## Architecture Overview

| Layer | Technology |
|-------|-----------|
| Frontend | TypeScript, Vite, Monaco Editor |
| Backend | Rust, Tauri v2 |
| Build | Bun, `cargo tauri build` |
| Packaging | macOS `.app` bundle + DMG |

---

## Build & Run

```bash
# Development server
./run.sh

# Type-check only (no emit)
npx tsc --noEmit

# Rust compile check
cargo check --manifest-path src-tauri/Cargo.toml
```

Version is the single source of truth in `version.md`. The `scripts/sync-version.sh` script propagates it to `package.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json` before every build.

---

## Production Build — Sign, Notarize & Install

Every production release goes through a single script that handles the full pipeline:

```
build → sign → notarize → install to /Applications → create DMG
```

### Quick start

Create a personal wrapper script (already in `.gitignore` to protect credentials):

```bash
# scripts/run-sign-apple.sh
./scripts/build-sign-install.sh \
  --identity "Developer ID Application: Your Name (TEAMID)" \
  --apple-id "you@email.com" \
  --team-id "ABCD123456" \
  --password "xxxx-xxxx-xxxx-xxxx"
```

Then run:

```bash
./scripts/run-sign-apple.sh
```

### `build-sign-install.sh` — full reference

```
Usage:
  ./scripts/build-sign-install.sh \
    --identity   "Developer ID Application: Your Name (TEAMID)"  # required
    --apple-id   "you@email.com"                                 # required for notarize
    --team-id    "ABCD123456"                                     # required for notarize
    --password   "xxxx-xxxx-xxxx-xxxx"                           # app-specific password
```

**Skip flags** for partial runs:

| Flag | Effect |
|------|--------|
| `--skip-build` | Sign/notarize/install an already-built bundle |
| `--skip-notarize` | Build + sign + install without notarizing |
| `--skip-install` | Build + sign + notarize but skip copying to /Applications |
| `--skip-dmg` | Skip DMG creation |

### What each step does

| Step | Action |
|------|--------|
| 1 — Build | Runs `sync-version.sh`, `bun run build:vite`, `cargo tauri build` |
| 2 — Sign | Signs nested dylibs/frameworks then the main `.app` with Developer ID + `--options runtime` + `--timestamp` |
| 3 — Notarize | Submits a zip to Apple's Notary Service via `notarytool`, waits for approval, staples the ticket |
| 4 — Install | Removes old `/Applications/Neo Edit.app`, copies new bundle, registers with Launch Services, restarts Finder |
| 5 — DMG | Creates a compressed DMG with `hdiutil`, signs it, notarizes it |

### Credentials

- `--identity` — full certificate name from Keychain (find with `security find-identity -v -p codesigning`)
- `--apple-id` — the Apple ID that owns the Developer Program membership
- `--team-id` — 10-character Team ID (visible in the certificate name in parentheses)
- `--password` — app-specific password generated at [appleid.apple.com](https://appleid.apple.com) → App-Specific Passwords

### First-time certificate setup

If you don't have a Developer ID certificate yet, run the interactive setup guide:

```bash
./scripts/01-setup-apple-signing.sh
```

This generates a private key + CSR, opens the Apple Developer Portal, imports the downloaded certificate, and installs the required Apple intermediate CA certificates.

---

## Key Source Files

```
src/
  main.ts                    # App entry point, menu action handler
  editor/
    themes.ts                # Monaco theme definitions (light, dark, tokyo-night, mariana)
  file/
    file-ops.ts              # Open/save/close, .docx conversion via mammoth
    session-recovery.ts      # Auto-save unsaved content to temp files
    window-state.ts          # Save/restore window position on quit/launch
  markdown/
    preview.ts               # Live Markdown preview pane
    formatting.ts            # Bold/italic/heading shortcuts
    lists.ts                 # Auto-continue lists, checkbox toggle
    tables.ts                # Table insertion, tab navigation
    outline.ts               # Heading outline sidebar
    export.ts                # Export to HTML / PDF
    stats.ts                 # Word count, reading time
    lint.ts                  # Markdown linting (duplicate headings, broken refs)
    content-assist.ts        # Emoji shortcodes, paste-URL-as-link
  settings/
    settings-store.ts        # Persist settings to localStorage
    settings-panel.ts        # Settings UI
  styles/
    main.css                 # App chrome styles
    markdown.css             # Preview pane + toolbar styles
    themes.css               # CSS variable definitions per theme

src-tauri/
  src/lib.rs                 # Rust entry point, Tauri commands, native menu
  Info.plist                 # Custom plist keys (CFBundleDocumentTypes, UTImportedTypeDeclarations)
  tauri.conf.json            # Tauri config (bundle ID, fileAssociations, window defaults)
  Cargo.toml                 # Rust dependencies
```

---

## .docx / .doc Support

Files are converted to Markdown for editing using [mammoth](https://github.com/mwilliamson/mammoth.js).

### Reading pipeline

1. Rust command `read_file_bytes` returns the file as a base64 string (bypasses Tauri FS scope restrictions for files opened outside the dialog).
2. Frontend decodes base64 with `atob()` → `Uint8Array`.
3. `mammoth.convertToHtml()` produces HTML.
4. `extractEmbeddedImages()` saves any base64-embedded images to `{docDir}/images/image_N.ext` and replaces data-URI `<img>` tags with relative file references.
5. `htmlToMarkdownLike()` converts HTML to Markdown for display in Monaco.

### Why `read_file_bytes` instead of the FS plugin

Tauri's `@tauri-apps/plugin-fs` `readFile()` / `readTextFile()` only works on paths that were opened through the Tauri file-dialog picker (FS scope restriction). Files received via "Open With" / deep-link land outside that scope and silently fail. The Rust command bypasses scope entirely.

### Saving

Saving back to `.docx` uses the `docx` npm package to reconstruct a Word document from the edited Markdown content.

---

## File Association & "Open With" (macOS)

### How it is configured

- `src-tauri/tauri.conf.json` → `bundle.fileAssociations` declares extensions (`.docx`, `.doc`, `.md`, `.txt`, etc.) using the native Tauri v2 mechanism, which generates `CFBundleDocumentTypes` entries in the app's `Info.plist`.
- `src-tauri/Info.plist` (custom template merged by Tauri bundler) adds `UTImportedTypeDeclarations` for `.docx` and `.doc` UTIs, which are required by modern macOS for the "Open With" menu.

### "Open With" not appearing in Finder — known limitation

**Root cause:** macOS Gatekeeper blocks ad-hoc signed apps (signed with `codesign --sign -`) from appearing in Finder's "Open With" submenu. `spctl --assess` returns `rejected` for ad-hoc signatures.

**What works:**
- `open -a "Neo Edit" /path/to/file.docx` (terminal)  
- Finder → right-click file → "Open With" → "Other…" → select `/Applications/Neo Edit.app`  
- Finder right-click → **Quick Actions** → **"Open with Neo Edit"** (Automator service installed at `~/Library/Services/Open with Neo Edit.workflow`)
- The deep-link plugin receives the file path correctly once the app is launched via any of the above methods

**Permanent fix:** Sign the app with a valid Apple Developer ID certificate:

```bash
# In scripts/build-dmg.sh, set SIGNING_IDENTITY to your cert name, e.g.:
SIGNING_IDENTITY="Developer ID Application: Your Name (TEAMID)"

# Then build:
bun run build
```

After proper signing, the app will pass `spctl --assess` and appear in Finder's "Open With" submenu automatically.

### File-open routing (single-instance)

1. `tauri-plugin-single-instance` prevents a second process from launching.
2. `tauri-plugin-deep-link` registers `application:openURLs:` and `application:openFile:` Apple Event handlers.
3. `on_open_url` converts file URLs to paths, adds them to the Tauri FS scope, and emits an `open-files` event to the frontend.
4. The frontend `main.ts` listener calls `openFileByPath()` for each path.
5. `RunEvent::Opened` arm is intentionally empty (would cause double-open if active).

---

## Code Signing

The app is signed with a **Developer ID Application** certificate and notarized via Apple's Notary Service. This is handled automatically by `scripts/build-sign-install.sh` — see the **Production Build** section above.

A notarized app:
- Passes `spctl --assess` with `source=Notarized Developer ID`
- Appears in Finder's "Open With" submenu
- Launches without Gatekeeper prompts

---

## Bundle Identifier

The bundle identifier is `com.neoedit.editor`.

> **Note:** An earlier version used `com.neoedit.app`. This caused Tauri build warnings because `.app` is reserved as a macOS bundle extension, and also confused Launch Services. If you see stale entries for `com.neoedit.app` in the LS database, unregister them:
>
> ```bash
> /System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister \
>   -u "/path/to/old/Neo Edit.app"
> ```

---

## Session Recovery

Unsaved tabs are auto-saved every 30 seconds to:

```
~/Library/Application Support/com.neoedit.editor/recovery/
```

On next launch, any recovery files are offered for restoration. This prevents data loss if the app crashes or is force-quit.

## Window State

Window position and size are saved to `localStorage` on every move/resize and on close (with a 1-second timeout to prevent blocking quit). Restored on next launch. The feature can be disabled in Settings → General → "Restore window position on launch".

---

## Printing

Printing uses `window.print()` targeting a hidden iframe containing the rendered preview HTML. Requires the `core:webview:allow-print` capability, which is declared in `src-tauri/capabilities/default.json`.

Print CSS (`@media print`) strips tab headers, forces black text, and shows only the editor content.

---

## Themes

| Theme | Description |
|-------|-------------|
| Light | Clean light theme with good contrast |
| Dark | VS Code-style dark theme |
| Tokyo Night | Official Tokyo Night palette |
| Mariana | Sublime Text Mariana palette |

Themes are defined as CSS variables in `src/styles/themes.css` and as Monaco token rules in `src/editor/themes.ts`.

---

## Known Issues

| Issue | Status | Notes |
|-------|--------|-------|
| "Open With" not in Finder menu | Open | Requires Developer ID signing — see above |
| App quit may hang briefly | Mitigated | `onCloseRequested` has 1s timeout on `captureState()` |
| Large .docx files slow to open | Open | mammoth conversion is synchronous; large files block UI briefly |
| Embedded images in .docx shown as paths | By design | Images extracted to `{docDir}/images/` folder; preview pane renders them |
| Print output may show grey text | Partial | `@media print` forces black but WKWebView quirks may persist |
