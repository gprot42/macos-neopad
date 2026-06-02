# NeoPad Version

## Current Version
0.0.1

## Changelog

### 0.0.1 (2026-05-31)

#### Editor Core
- Monaco Editor (VS Code engine) with full IntelliSense and multi-cursor support
- Syntax highlighting for 50+ languages (JavaScript, TypeScript, Python, Rust, Go, Java, C/C++, SQL, YAML, JSON, HTML, CSS, and more)
- Plain text mode
- Word wrap with preset column widths (70, 75, 80) or custom value
- Configurable font size (32pt)8
- Find & replace with regex support (Cmd+F / Cmd+H)
- Cmd+Up / Cmd+Down to jump to top / bottom of document
- Cmd+G to go to a specific line number
- Unicode highlight suppression (no false-positive yellow boxes on non-ASCII text)

#### Tabs
- Unlimited tabbed editing
- Drag-and-drop tab reordering
- Close individual tab (Cmd+W), close all tabs
- Tab dirty ) for unsaved changesindicator (
- Tab title shows filename; unsaved tabs show Untitled-N
- Cursor position per  position restored when switching tabstab 
- Recently closed file list with reload option
- Right-click tab context menu (close, lock, duplicate, rel- Ri

#### File Handling
- New file (Cmd+N), new tab (Cmd+T)
- Open file via dialog (Cmd+O)
- Save (Cmd+S), Save As (Cmd+Shift+S)
- Save As supports multiple formats: `.txt`, `.md`, `.docx`, `.html`, `.pdf`
- Close all tabs
- Drag-and-drop files onto the editor window to open - Drag-and-drop en With" and "Send To" integration
- Single-instance: files opened from Finder load into the running app's tab bar
- Auto-detect file language from extension on open
- Session recovery: unsaved content auto-saved every 2 s to localStorage; restored on next launch

#### .docx / .doc Support
- Open `.docx` and `.doc`  converted to Markdown via mammoth.jsfiles 
- Embedded images extracted from `.docx` and saved alongside the file; rendered in preview
- Save / export back to `.docx` (reconstructed via the `docx` npm package)
- Handles files opened via Finder "Open With" outside Tauri's normal FS scope

#### Themes
- ** clean, high-contrast light themeLight** 
- ** VS Code-inspired dark themeDark** 
- **Tokyo  exact official Tokyo Night paletteNight** 
- ** Sublime Text Mariana paletteMariana** 
- All themes apply to editor tokens, UI chrome, status bar, and Markdown preview
- Theme persisted across restarts

#### Markdown Editing
- **Live preview pane** (Cmd+Shift+P to  debounced 150 ms re-rendertoggle) 
- **Scroll  editor scroll position mapped to preview scroll positionsync** 
- **Mermaid diagram  ` ```mermaid ` fences rendered as inline SVG; lazy-loaded code-split chunkrendering** 
  - Scroll to zoom (0.63, zoom toward cursor)
  - Drag to pan
  - Double-click to reset
- **Formatting toolbar** (visible for Markdown files only):
  - Bold (Cmd+B), Italic (Cmd+I), Strikethrough (Cmd+Shift+X)
  - Insert link (Cmd+K), insert image (Cmd+Shift+K)
  - Headings H6 (Cmd+6)1H1
  - Inline code / fenced code block (Cmd+`)
  - Blockquote (Cmd+Shift+.), horizontal rule (Cmd+Shift+-)
- **List  Enter continues bullet/numbered lists; empty bullet exits list; Tab/Shift+Tab indents/outdents; Cmd+Shift+C toggles checkbox `- [ ]`/`- [x]`editing** 
- **Table  Cmd+Shift+T inserts a table (dialog picks rows Support cols); Tab/Shift+Tab navigates cells; auto-align columns** 
- **Document outline sidebar** (Cmd+Shift+ live heading tree, click to jump to line, breadcrumb in status barO) 
- **Export to HTML** (Cmd+Shift+ full standalone HTML with inline CSSE) 
- **Export to  native system print dialog targets rendered preview iframePDF** 
- **Word count & reading  shown in status bar for Markdown files; strips Markdown syntax before countingtime** 
- **Improved syntax  bold, italic, headings, code fences, links all coloured per active theme palettehighlighting**  

#### Markdown Preview Styling
- Theme-aware preview (light/dark/Tokyo Night/Mariana)
- Rendered code blocks with syntax colouring
- Mermaid diagrams rendered as SVG with zoom/pan controls

#### Save As Formats
- Plain text (`.txt`)
- Markdown (`.md`)
- Word document (`.docx`)
- HTML (full standalone document)
- PDF (via system print dialog)

#### Print
- Cmd+ native macOS print dialogP 
- Print CSS strips UI chrome, forces black text, shows only editor content

#### Paste
- Standard paste (Cmd+ plain textV) 
- Paste with formatting (Cmd+Shift+ preserves rich text / HTML structureV) 

#### Password Lock
 Lock Tab)
- Content hidden and editor set read-only while locked
- Unlock by clicking the locked tab and entering the password
- Encrypted tabs saved as `.neo` files
- Locked tabs never shown automatically on startup (lock screen suppressed at launch)

#### Window & Session
- Window position and size saved on every move/resize, restored on next launch
- "Restore window position on lau- "Restore window position on lau- "Restore window po every 2  all open tabs (content, language, dirty state, cursor position) stored to localStorages 
- Dark startup  no white flash before the editor initialisesbackground 

#### Settings Panel
- Font size (32 pt)8
- Theme selector (Light / Dark / Tokyo Night / Mariana)
- Word wrap column (70 / 75 / 80 / Off / Custom)
- Restore window position on launch toggle

#### macOS Integration
- Native macOS menu bar with full keyboard shortcuts
- Application menu: About NeoPad, Settings, Quit (Cmd+Q)
- File menu: New, Open, Save, Save As, Close, Print, Recent Files
- Edit menu: Undo, Redo,- Edit menu: Undo, Redo,- Edit menu: Undo, Redo,- Edi Find, Replace
- View menu: Toggle Preview, Toggle Outline, Zoom- View menu: Toggle Preview, Toggle Oad (shows version)
- Dock icon with custom NeoPad logo
- "Open With" file association for `.txt`, `.md`, `.docx`, `.doc`, `.csv`, `.neo`, and common source code extensions
- Single-instance enforcement via `tauri-plugin-single-instance`

#### Build & Distribution
- Signed with Apple Developer ID Application certificate
- Notarized via Apple Notary Service (` passes Gatekeepernotarytool`) 
- Build + sign + notarize + install + DMG via a single script (`scripts/02-build-sign-install.sh`)
- DMG filename includes `-signed` suffix after notarization
- Bundle identifier: `com.neopad.editor`

#### Logging
- File-based logger at `~/Library/Logs/NeoPad/neopad.log`
- Startup log includes session restore decision, window state, pending files
- All errors and warnings captured at runtime

#### Developer Experience
- Bun as package manager and dev runtime
- Vite v8 for frontend bundling — code-split Monaco workers, lazy Mermaid chunk 
- TypeScript strict mode — `bunx tsc --noEmit` clean 
- `./start.sh` launches the full dev stack (Vite + Tauri hot-reload)
