import './styles/themes.css';
import './styles/main.css';
import './styles/markdown.css';
import { initEditor, setEditorTheme, updateEditorOptions, setEditorModel, getEditor, initTabLookup } from './editor/editor-manager';
import { renderTabBar } from './tabs/tab-bar';
import { onTabsChange, addTab, getActiveTab, setTabLanguage, getTabs } from './tabs/tab-store';
import { settingsStore } from './settings/settings-store';
import { openSettings } from './settings/settings-panel';
import { newFile, openFile, openFileByPath, saveFile, saveFileAs, closeTab, closeAllFiles, reopenLastClosed } from './file/file-ops';
import { triggerFind, triggerReplace } from './search/search-bar';
import { availableLanguages } from './editor/languages';
import { initPreview, togglePreview, showPreviewIfMarkdown, isPreviewVisible, getPreviewHTMLForExport } from './markdown/preview';
import { registerFormattingActions, renderFormattingToolbar, showToolbarIfMarkdown } from './markdown/formatting';
import { registerListActions } from './markdown/lists';
import { registerTableActions } from './markdown/tables';
import { initOutline, toggleOutline, showOutlineIfMarkdown, isOutlineVisible, getBreadcrumb } from './markdown/outline';
import { exportToHTML, exportToPDF } from './markdown/export';
import { getWordCount, getReadingTime } from './markdown/stats';
import { scheduleLint, clearLint } from './markdown/lint';
import { registerContentAssist } from './markdown/content-assist';
import { registerPasteWithFormatting } from './editor/paste-formatting';
import { restoreSession, startSessionAutoSave } from './file/session-recovery';
import { restoreWindowPosition, startWindowPositionTracking } from './file/window-state';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { log } from './utils/logger';
import { lockManager, startAutoLock, stopAutoLock, resetActivityTimer } from './crypto/lock-manager';
import { encryptText, decryptText } from './crypto/crypto-manager';
import { promptPassword } from './crypto/password-dialog';
import { readTextFile } from '@tauri-apps/plugin-fs';

// Print current file
function printCurrentFile(): void {
  const tab = getActiveTab();
  if (!tab) return;

  let bodyContent: string;

  if (tab.language === 'markdown') {
    const rawHtml = getPreviewHTMLForExport();
    const bodyMatch = rawHtml.match(/<body>([\s\S]*)<\/body>/);
    bodyContent = bodyMatch ? bodyMatch[1] : rawHtml;
  } else {
    const content = tab.model.getValue()
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    bodyContent = `<pre>${content}</pre>`;
  }

  // Save state for restoration
  const savedBody = document.body.innerHTML;
  const savedTitle = document.title;
  const savedDataTheme = document.documentElement.getAttribute('data-theme');

  // 1. Disable ALL stylesheets — prevents CSS variables (--fg: grey) from cascading
  const sheets = Array.from(document.styleSheets);
  sheets.forEach(s => { try { s.disabled = true; } catch (_) { /* cross-origin */ } });

  // 2. Remove theme attribute
  document.documentElement.removeAttribute('data-theme');

  // 3. Set title to just the filename (macOS prints document.title as header)
  document.title = tab.filePath ? tab.filePath.split('/').pop()! : 'Document';

  // 4. Inject a clean print stylesheet with !important to override everything
  const printStyle = document.createElement('style');
  printStyle.id = 'neo-print-style';
  printStyle.textContent = `
    *, *::before, *::after { color: #000 !important; background: transparent !important; }
    html, body {
      background: #fff !important;
      color: #000 !important;
      font-family: -apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif !important;
      font-size: 14px !important;
      line-height: 1.7 !important;
      height: auto !important;
      overflow: visible !important;
      margin: 0 !important;
      padding: 0 !important;
    }
    #print-content { padding: 20px; color: #000 !important; }
    #print-content pre {
      font-family: 'SF Mono', Menlo, Monaco, 'Courier New', monospace !important;
      font-size: 12px !important;
      line-height: 1.5 !important;
      white-space: pre-wrap !important;
      word-wrap: break-word !important;
      color: #000 !important;
    }
    #print-content code { background: #f5f5f5 !important; padding: 2px 4px !important; border-radius: 3px !important; }
    #print-content pre code { display: block !important; padding: 12px !important; }
    #print-content h1, #print-content h2, #print-content h3,
    #print-content h4, #print-content h5, #print-content h6 {
      color: #000 !important; margin-top: 1em !important; margin-bottom: 0.5em !important;
    }
    #print-content p { margin-bottom: 0.8em !important; }
    #print-content a { color: #000 !important; text-decoration: underline !important; }
    #print-content blockquote {
      border-left: 3px solid #999 !important; padding-left: 12px !important;
      color: #333 !important; margin: 0.8em 0 !important;
    }
    #print-content table { border-collapse: collapse !important; }
    #print-content th, #print-content td {
      border: 1px solid #999 !important; padding: 6px 12px !important; color: #000 !important;
    }
  `;
  document.head.appendChild(printStyle);

  // 5. Replace body with ONLY the print content
  document.body.innerHTML = `<div id="print-content">${bodyContent}</div>`;

  // 6. Restore ONLY after the print dialog closes (afterprint event).
  //    window.print() is async in WKWebView — restoring immediately would
  //    destroy the print content before the dialog captures it.
  const restore = () => {
    window.removeEventListener('afterprint', restore);
    printStyle.remove();
    document.body.innerHTML = savedBody;
    document.title = savedTitle;
    if (savedDataTheme) {
      document.documentElement.setAttribute('data-theme', savedDataTheme);
    }
    sheets.forEach(s => { try { s.disabled = false; } catch (_) { /* cross-origin */ } });
    // Reload to reinitialize Monaco (can't survive innerHTML replacement)
    setTimeout(() => window.location.reload(), 200);
  };
  window.addEventListener('afterprint', restore);

  // 7. Wait for WKWebView to fully render the clean content, then print
  requestAnimationFrame(() => {
    setTimeout(() => {
      window.print();
    }, 500);
  });
}

// Apply initial theme
const initialSettings = settingsStore.get();
document.documentElement.setAttribute('data-theme', initialSettings.theme);

// Initialize Monaco editor
log.info('Neo Edit starting up, version:', typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'unknown');
const editorContainer = document.getElementById('editor-container')!;
const editor = initEditor(editorContainer);

// Wire tab lookups so setEditorModel can save/restore per-tab view state
initTabLookup(
  () => getActiveTab(),
  (model) => getTabs().find((t) => t.model === model) ?? null,
);

// Initialize Markdown modules
initPreview();
initOutline();
registerFormattingActions();
registerListActions();
registerTableActions();
registerContentAssist();
registerPasteWithFormatting(editor);
renderFormattingToolbar();

// Restore previous session or create an initial tab
const restored = restoreSession();
if (!restored) {
  const initialTab = addTab();
  setEditorModel(initialTab.model);
}
editor.focus();

// Start auto-saving session state
startSessionAutoSave();

// Restore window position first (await so tracking doesn't race with restore),
// then start tracking movements/resizes.
(async () => {
  await restoreWindowPosition();
  await startWindowPositionTracking();
})();

// Re-render tabs on change
onTabsChange(() => {
  renderTabBar();
  updateMarkdownUI();
  updateStatusBar();
});

// Initial render
renderTabBar();

// Settings change handler
settingsStore.onChange((settings) => {
  document.documentElement.setAttribute('data-theme', settings.theme);
  setEditorTheme(settings.theme);
  updateEditorOptions({
    fontSize: settings.fontSize,
    wordWrap: settings.wordWrap as 'off' | 'on' | 'wordWrapColumn' | 'bounded',
    wordWrapColumn: settings.wordWrapColumn,
  });
  applyAutoLockSettings(settings.autoLockEnabled, settings.autoLockTimeoutMins);
});

// Markdown UI visibility — show/hide toolbar, preview, outline on tab switch
function updateMarkdownUI(): void {
  showToolbarIfMarkdown();
  showPreviewIfMarkdown();
  showOutlineIfMarkdown();

  const tab = getActiveTab();
  if (tab?.language === 'markdown') {
    scheduleLint();
  } else {
    clearLint();
  }
}

// Lint on content change
editor.onDidChangeModelContent(() => {
  const tab = getActiveTab();
  if (tab?.language === 'markdown') {
    scheduleLint();
  }
});

// Status bar
function updateStatusBar(): void {
  const statusBar = document.getElementById('status-bar')!;
  const tab = getActiveTab();

  if (!tab) {
    statusBar.innerHTML = '<span class="status-item">No file open</span>';
    return;
  }

  const pos = editor.getPosition();
  const line = pos?.lineNumber ?? 1;
  const col = pos?.column ?? 1;
  const isMd = tab.language === 'markdown';

  let mdParts = '';
  if (isMd) {
    const words = getWordCount();
    const readTime = getReadingTime();
    const breadcrumb = getBreadcrumb();

    mdParts += `<span class="status-item status-words">${words} words, ${readTime}</span>`;
    if (breadcrumb) {
      mdParts += `<span class="status-item status-breadcrumb" title="${breadcrumb}">${breadcrumb}</span>`;
    }
    mdParts += `<span class="status-item status-preview-btn" id="status-preview-toggle">${isPreviewVisible() ? 'Hide Preview' : 'Show Preview'}</span>`;
    mdParts += `<span class="status-item status-preview-btn" id="status-outline-toggle">${isOutlineVisible() ? 'Hide Outline' : 'Show Outline'}</span>`;
  }

  statusBar.innerHTML = `
    <span class="status-item">Ln ${line}, Col ${col}</span>
    <span class="status-item">UTF-8</span>
    ${mdParts}
    <div class="status-right">
      <span class="status-item language-picker" id="lang-picker">${tab.language}</span>
    </div>
  `;

  // Event listeners
  document.getElementById('lang-picker')?.addEventListener('click', () => {
    toggleLanguageDropdown();
  });

  document.getElementById('status-preview-toggle')?.addEventListener('click', () => {
    togglePreview();
    updateStatusBar();
  });

  document.getElementById('status-outline-toggle')?.addEventListener('click', () => {
    toggleOutline();
    updateStatusBar();
  });
}

editor.onDidChangeCursorPosition(() => {
  updateStatusBar();
});

updateStatusBar();

// Language dropdown
let langDropdownVisible = false;

function toggleLanguageDropdown(): void {
  let dropdown = document.querySelector('.lang-dropdown');
  if (langDropdownVisible && dropdown) {
    dropdown.remove();
    langDropdownVisible = false;
    return;
  }

  const tab = getActiveTab();
  if (!tab) return;

  dropdown = document.createElement('div');
  dropdown.className = 'lang-dropdown';

  for (const lang of availableLanguages) {
    const item = document.createElement('div');
    item.className = `lang-item${tab.language === lang ? ' active' : ''}`;
    item.textContent = lang;
    item.addEventListener('click', () => {
      setTabLanguage(tab.id, lang);
      dropdown!.remove();
      langDropdownVisible = false;
      updateMarkdownUI();
      updateStatusBar();
    });
    dropdown.appendChild(item);
  }

  document.body.appendChild(dropdown);
  langDropdownVisible = true;

  const closeDropdown = (e: MouseEvent) => {
    if (!dropdown!.contains(e.target as Node)) {
      dropdown!.remove();
      langDropdownVisible = false;
      document.removeEventListener('click', closeDropdown);
    }
  };
  setTimeout(() => document.addEventListener('click', closeDropdown), 0);
}

// Menu actions from Tauri native menu
function showAboutDialog(version: string) {
  const existing = document.getElementById('about-dialog');
  if (existing) { existing.remove(); return; }

  const overlay = document.createElement('div');
  overlay.id = 'about-dialog';
  overlay.innerHTML = `
    <div class="about-box">
      <div class="about-icon">✦</div>
      <h2>Neo Edit</h2>
      <p class="about-version">Version ${version}</p>
      <p class="about-desc">A fast, tabbed text editor for macOS.<br>Built with Tauri, Monaco &amp; TypeScript.</p>
      <button class="about-close" onclick="document.getElementById('about-dialog').remove()">Close</button>
    </div>
  `;
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });
  document.body.appendChild(overlay);
}
(window as any).__menuAction = (action: string, arg?: string) => {
  switch (action) {
    case 'about':
      showAboutDialog(arg || '');
      break;
    case 'new_file':
    case 'new_tab':
      newFile();
      break;
    case 'open_file':
      openFile();
      break;
    case 'reopen_closed':
      reopenLastClosed();
      break;
    case 'save':
      saveFile();
      break;
    case 'save_as':
      saveFileAs();
      break;
    case 'close_tab':
      closeTab();
      break;
    case 'close_all':
      closeAllFiles();
      break;
    case 'print':
      printCurrentFile();
      break;
    case 'settings':
      openSettings();
      break;
    case 'find':
      triggerFind();
      break;
    case 'replace':
      triggerReplace();
      break;
    case 'toggle_preview':
      togglePreview();
      updateStatusBar();
      break;
    case 'toggle_outline':
      toggleOutline();
      updateStatusBar();
      break;
    case 'insert_table':
      editor.getAction('md.insert-table')?.run();
      break;
    case 'export_html':
      exportToHTML();
      break;
    case 'export_pdf':
      exportToPDF();
      break;
  }
};

// Window title update
onTabsChange(() => {
  const tab = getActiveTab();
  const title = tab
    ? `${tab.title}${tab.isDirty ? ' - Modified' : ''} - Neo Edit v${__APP_VERSION__}`
    : `Neo Edit v${__APP_VERSION__}`;
  document.title = title;
});

// Listen for macOS file-open events (Open With, Send To, drag to dock)
// Rust always stores files as pending and emits this signal
listen('check-pending-files', () => {
  log.info('check-pending-files signal received, polling pending files...');
  pollPendingFiles();
});

// Track files we've already opened to avoid duplicates
const openedPendingFiles = new Set<string>();

// Fetch and open any pending files from the Rust side
async function pollPendingFiles() {
  try {
    const paths = await invoke<string[]>('get_pending_files');
    if (paths.length === 0) return;

    log.info('got pending files:', JSON.stringify(paths));

    // Check which files are already open (from session recovery or previous poll)
    const existingPaths = new Set(getTabs().map(t => t.filePath).filter(Boolean));

    for (const filePath of paths) {
      if (openedPendingFiles.has(filePath)) {
        log.info('skipping already-opened pending file:', filePath);
        continue;
      }
      if (existingPaths.has(filePath)) {
        log.info('skipping file already in a tab:', filePath);
        openedPendingFiles.add(filePath);
        continue;
      }
      openedPendingFiles.add(filePath);
      openFileByPath(filePath).catch((err) => {
        log.error('Failed to open pending file:', filePath, err instanceof Error ? err.message : String(err));
      });
    }
  } catch (err) {
    log.error('Failed to get pending files:', err instanceof Error ? err.message : String(err));
  }
}

// Poll pending files at startup, then retry to catch late-arriving files
log.info('polling pending files at startup...');
pollPendingFiles();
setTimeout(() => pollPendingFiles(), 1000);
setTimeout(() => pollPendingFiles(), 2500);
setTimeout(() => pollPendingFiles(), 5000);

// ---------------------------------------------------------------------------
// Lock overlay management
// ---------------------------------------------------------------------------

const lockOverlay = document.getElementById('lock-overlay')!;
const lockUnlockBtn = document.getElementById('lock-unlock-btn')!;

/** Show or hide the lock overlay based on the active tab's lock state. */
function syncLockOverlay(): void {
  const tab = getActiveTab();
  if (tab && lockManager.isLocked(tab.id)) {
    lockOverlay.classList.remove('hidden');
  } else {
    lockOverlay.classList.add('hidden');
  }
}

/** Lock all currently unlocked encrypted tabs (called by auto-lock timer). */
async function lockAllEncryptedTabs(): Promise<void> {
  const unlockedIds = lockManager.getUnlockedTabIds();
  if (unlockedIds.length === 0) return;

  log.info('auto-lock: locking', unlockedIds.length, 'encrypted tab(s)');

  for (const tabId of unlockedIds) {
    const password = lockManager.getPassword(tabId);
    if (!password) continue;

    const matchedTab = getTabs().find((t) => t.id === tabId);
    if (!matchedTab) continue;

    const plaintext = matchedTab.model.getValue();
    try {
      const snapshot = await encryptText(plaintext, password);
      lockManager.lockTab(tabId, snapshot);
      matchedTab.model.setValue(''); // clear plaintext from memory
    } catch (err) {
      log.error('Failed to lock tab', tabId, err instanceof Error ? err.message : String(err));
    }
  }

  syncLockOverlay();
  log.info('auto-lock: all encrypted tabs locked');
}

/** Unlock the active locked tab by prompting for a password. */
async function unlockActiveTab(): Promise<void> {
  const tab = getActiveTab();
  if (!tab || !lockManager.isLocked(tab.id)) return;

  const snapshot = lockManager.getSnapshot(tab.id);

  // If no snapshot (e.g. restored from session — file needs re-reading), fall
  // back to reading the file from disk and decrypting it.
  if (!snapshot || snapshot === '') {
    // Re-open from file on disk
    if (!tab.filePath) {
      alert('Cannot unlock: file path is unknown.');
      return;
    }

    let errorMessage: string | undefined;
    while (true) {
      const password = await promptPassword(
        `Enter the password for "${tab.title}"`,
        { errorMessage },
      );
      if (password === null) return; // user cancelled

      try {
        const raw = await readTextFile(tab.filePath);
        const content = await decryptText(raw, password);
        lockManager.unlockTab(tab.id, password);
        tab.model.setValue(content);
        break;
      } catch {
        errorMessage = 'Wrong password — please try again.';
      }
    }
  } else {
    // Decrypt the in-memory snapshot
    let errorMessage: string | undefined;
    while (true) {
      const password = await promptPassword(
        `Enter the password for "${tab.title}"`,
        { errorMessage },
      );
      if (password === null) return;

      try {
        const content = await decryptText(snapshot, password);
        lockManager.unlockTab(tab.id, password);
        tab.model.setValue(content);
        break;
      } catch {
        errorMessage = 'Wrong password — please try again.';
      }
    }
  }

  syncLockOverlay();
  editor.focus();
}

// Unlock button click
lockUnlockBtn.addEventListener('click', () => unlockActiveTab());

// Sync overlay on tab change
onTabsChange(() => syncLockOverlay());

// Handle auto-lock trigger from the lock manager
lockManager.onLock(() => {
  lockAllEncryptedTabs().catch((err) =>
    log.error('lockAllEncryptedTabs error:', err instanceof Error ? err.message : String(err)),
  );
});

// Activity tracking — reset the inactivity timer on any user interaction
const activityEvents: (keyof WindowEventMap)[] = ['keydown', 'mousemove', 'mousedown', 'touchstart', 'wheel'];
activityEvents.forEach((event) => {
  window.addEventListener(event, () => resetActivityTimer(), { passive: true });
});

// Apply auto-lock settings from the store
function applyAutoLockSettings(enabled: boolean, timeoutMins: number): void {
  if (enabled) {
    startAutoLock(timeoutMins * 60 * 1000);
    log.info('auto-lock enabled, timeout:', timeoutMins, 'min');
  } else {
    stopAutoLock();
    log.info('auto-lock disabled');
  }
}

// Apply initial auto-lock settings
const { autoLockEnabled, autoLockTimeoutMins } = settingsStore.get();
applyAutoLockSettings(autoLockEnabled, autoLockTimeoutMins);
