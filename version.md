# NeoPad Version

## Current Version
0.0.5

## Changelog

#### 0.0.5 (2026-11-26)
- **Stay on Top** (View → Stay on Top, ⌃⌘T): keeps the NeoPad window above other apps' windows until switched off; the choice is remembered between launches

#### 0.0.4 (2026-11-19)
- **Split view** (View → Split Editor, ⌘\): a second editor pane beside the main one, showing the same file or a different open tab. Right-click a tab → *Open to the Side*, or click the pane's title to choose its tab. Edits on either side appear in both; Save, Find and the status bar follow the pane you are typing in, and ⌘W in the split pane closes the pane
- **Text encodings**: files that are not UTF-8 now open correctly. The encoding is detected (byte-order mark, then UTF-8, then a best guess for legacy encodings such as Windows-1252 or Shift JIS), shown in the status bar, and used again on save, so a file is written back the way it was found
- Click the encoding in the status bar to *Reopen with Encoding* (when the guess was wrong) or *Save with Encoding* (to convert the file). Saving is refused, and the file left untouched, if the text has characters the chosen encoding cannot represent
- Opening a binary file, or a file that cannot be read, now says so instead of silently doing nothing; a failed save is reported too
- **Folders** (NeoPad → Open Folder…, ⌥⌘O): open a folder to get a file-tree sidebar (View → Toggle Files Sidebar, ⇧⌘B). Click a file to open it, or switch to its tab if it is already open. The tree picks up files created or removed outside NeoPad, and the folder is reopened on the next launch
- **Go to File** (⌘T): type part of a name to jump to any file in the open folder
- **Find in Files** (Edit → Find in Files…, ⇧⌘F): search the open folder, with match-case and regular-expression options; click a result to open the file at that line
- Go to File and Find in Files skip anything ignored by `.gitignore` (`node_modules`, build output, …); Find in Files also skips binary files and files over 2 MB
- A terminal opened while a folder is open starts in that folder
- **External file changes**: NeoPad now notices when an open file is changed by another program (git, another editor, a command in the terminal panel). A tab with no unsaved edits reloads on its own (undoable with ⌘Z); a tab with unsaved edits shows a banner offering *Reload from Disk* or *Keep My Edits*, and saving asks before overwriting the newer file. A file that is deleted or moved marks its tab as modified so it can be saved back
- **Plugins** (NeoPad → Plugins…, ⌘⇧X): install VS Code extensions from a `.vsix` file or by searching Open VSX. NeoPad uses their colour themes, TextMate syntax grammars, snippets and language settings, and never runs extension code
- Plugin themes colour the whole window — tabs, status bar, terminal and Markdown preview as well as the editor — and appear in Settings → Theme
- Preinstalled sample plugin, *Nebula Themes* (a dark and a light theme), as a working example to inspect and edit
- Fixed the built-in Light, Dark and Mariana themes only recolouring the editor: the tab bar and status bar stayed Tokyo Night because `main.css` overrode the theme variables
- Fixed the status bar turning grey in light themes

#### 0.0.3 (2026-09-21)
- Fixed the editor shifting sideways (gutter gone, first characters clipped, no way to scroll back). Root cause: with wrapping on, Monaco sizes its hidden input textarea to the wrap width; in a window narrower than that it overhangs `.overflow-guard`, and WebKit scrolls that box to reveal the caret while typing. Monaco's own `scrollLeft` stays 0 throughout, which is why the two earlier fixes never fired. The boxes around the editor are now `overflow: clip` (unscrollable), with a guard that undoes any stray DOM scroll offset
- Removed the earlier workaround that forced Monaco's `scrollLeft` to 0 whenever wrap was enabled — with "wrap at column" in a window narrower than the wrap column it made the rightmost columns unreachable (cursor off-screen, no horizontal scroll)

#### 0.0.2 (2026-06-10)
- Fixed the horizontal-scroll stuck bug — the editor's scrollLeft gets pushed past 0 and, with word wrap on, there's no horizontal scrollbar to drag back

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
