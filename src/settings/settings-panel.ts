import { settingsStore, type Settings } from './settings-store';
import { disableTerminalFeature } from '../terminal/terminal-panel';

let isOpen = false;

export function openSettings(): void {
  if (isOpen) return;
  isOpen = true;

  const overlay = document.getElementById('settings-overlay')!;
  overlay.classList.remove('hidden');
  overlay.innerHTML = '';

  const settings = settingsStore.get();

  const panel = document.createElement('div');
  panel.className = 'settings-panel';

  panel.innerHTML = `
    <h2>Settings</h2>

    <div class="settings-section">
      <label>Theme</label>
      <select id="setting-theme">
        <option value="light" ${settings.theme === 'light' ? 'selected' : ''}>Light</option>
        <option value="dark" ${settings.theme === 'dark' ? 'selected' : ''}>Dark</option>
        <option value="tokyo-night" ${settings.theme === 'tokyo-night' ? 'selected' : ''}>Tokyo Night</option>
        <option value="mariana" ${settings.theme === 'mariana' ? 'selected' : ''}>Mariana</option>
      </select>
    </div>

    <div class="settings-section">
      <label>Font Size</label>
      <input type="number" id="setting-font-size" min="8" max="48" value="${settings.fontSize}" />
    </div>

    <div class="settings-section">
      <label>Word Wrap Column</label>
      <div class="wrap-options">
        <button class="wrap-btn ${settings.wordWrapColumn === 70 ? 'active' : ''}" data-col="70">70</button>
        <button class="wrap-btn ${settings.wordWrapColumn === 72 ? 'active' : ''}" data-col="72">72</button>
        <button class="wrap-btn ${settings.wordWrapColumn === 80 ? 'active' : ''}" data-col="80">80</button>
        <button class="wrap-btn ${![70, 72, 80].includes(settings.wordWrapColumn) ? 'active' : ''}" data-col="custom">Custom</button>
        <input type="number" class="custom-wrap-input" id="setting-custom-wrap" min="20" max="200" value="${settings.wordWrapColumn}" style="display: ${![70, 72, 80].includes(settings.wordWrapColumn) ? 'block' : 'none'}" />
      </div>
    </div>

    <div class="settings-section">
      <label>Indentation</label>
      <div class="wrap-options">
        <button class="wrap-btn indent-btn ${settings.tabSize === 2 ? 'active' : ''}" data-tab="2">2</button>
        <button class="wrap-btn indent-btn ${settings.tabSize === 4 ? 'active' : ''}" data-tab="4">4</button>
        <button class="wrap-btn indent-btn ${settings.tabSize === 8 ? 'active' : ''}" data-tab="8">8</button>
      </div>
      <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; margin-top: 8px;">
        <input type="checkbox" id="setting-insert-spaces" ${settings.insertSpaces ? 'checked' : ''} style="width: auto; margin: 0;" />
        Insert spaces instead of tabs
      </label>
    </div>

    <div class="settings-section">
      <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
        <input type="checkbox" id="setting-restore-window" ${settings.restoreWindowPosition ? 'checked' : ''} style="width: auto; margin: 0;" />
        Restore window position and size on startup
      </label>
    </div>

    <div class="settings-section">
      <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
        <input type="checkbox" id="setting-terminal-enabled" ${settings.terminalEnabled ? 'checked' : ''} style="width: auto; margin: 0;" />
        Enable integrated terminal (View → Toggle Terminal, Ctrl+\`)
      </label>
    </div>

    <div class="settings-section settings-section-divider">
      <label class="settings-label-heading">Encryption &amp; Security</label>
    </div>

    <div class="settings-section">
      <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
        <input type="checkbox" id="setting-autolock-enabled" ${settings.autoLockEnabled ? 'checked' : ''} style="width: auto; margin: 0;" />
        Auto-lock encrypted files after inactivity
      </label>
    </div>

    <div class="settings-section" id="autolock-timeout-section" style="${settings.autoLockEnabled ? '' : 'opacity: 0.4; pointer-events: none;'}">
      <label>Lock timeout (minutes)</label>
      <div class="wrap-options">
        <button class="wrap-btn ${settings.autoLockTimeoutMins === 15 ? 'active' : ''}" data-mins="15">15</button>
        <button class="wrap-btn ${settings.autoLockTimeoutMins === 30 ? 'active' : ''}" data-mins="30">30</button>
        <button class="wrap-btn ${settings.autoLockTimeoutMins === 60 ? 'active' : ''}" data-mins="60">60</button>
        <button class="wrap-btn ${![15, 30, 60].includes(settings.autoLockTimeoutMins) ? 'active' : ''}" data-mins="custom">Custom</button>
        <input type="number" class="custom-wrap-input" id="setting-custom-timeout" min="1" max="1440" value="${settings.autoLockTimeoutMins}" style="display: ${![15, 30, 60].includes(settings.autoLockTimeoutMins) ? 'block' : 'none'}" />
      </div>
    </div>
  `;

  overlay.appendChild(panel);

  // Theme
  panel.querySelector('#setting-theme')!.addEventListener('change', (e) => {
    const value = (e.target as HTMLSelectElement).value as Settings['theme'];
    settingsStore.update({ theme: value });
  });

  // Font size
  panel.querySelector('#setting-font-size')!.addEventListener('input', (e) => {
    const value = parseInt((e.target as HTMLInputElement).value, 10);
    if (value >= 8 && value <= 48) {
      settingsStore.update({ fontSize: value });
    }
  });

  // Wrap column buttons
  const wrapBtns = panel.querySelectorAll('.wrap-btn[data-col]');
  const customInput = panel.querySelector('#setting-custom-wrap') as HTMLInputElement;

  wrapBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      wrapBtns.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      const col = btn.getAttribute('data-col')!;
      if (col === 'custom') {
        customInput.style.display = 'block';
        customInput.focus();
      } else {
        customInput.style.display = 'none';
        settingsStore.update({ wordWrapColumn: parseInt(col, 10), wordWrap: 'wordWrapColumn' });
      }
    });
  });

  customInput.addEventListener('input', () => {
    const val = parseInt(customInput.value, 10);
    if (val >= 20 && val <= 200) {
      settingsStore.update({ wordWrapColumn: val, wordWrap: 'wordWrapColumn' });
    }
  });

  // Indentation (tab size)
  const indentBtns = panel.querySelectorAll('.indent-btn[data-tab]');
  indentBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      indentBtns.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      settingsStore.update({ tabSize: parseInt(btn.getAttribute('data-tab')!, 10) });
    });
  });

  panel.querySelector('#setting-insert-spaces')!.addEventListener('change', (e) => {
    settingsStore.update({ insertSpaces: (e.target as HTMLInputElement).checked });
  });

  // Restore window position
  panel.querySelector('#setting-restore-window')!.addEventListener('change', (e) => {
    settingsStore.update({ restoreWindowPosition: (e.target as HTMLInputElement).checked });
  });

  // Integrated terminal enable/disable
  panel.querySelector('#setting-terminal-enabled')!.addEventListener('change', (e) => {
    const enabled = (e.target as HTMLInputElement).checked;
    settingsStore.update({ terminalEnabled: enabled });
    if (!enabled) void disableTerminalFeature();
  });

  // Auto-lock enabled toggle
  const autoLockCheckbox = panel.querySelector<HTMLInputElement>('#setting-autolock-enabled')!;
  const timeoutSection = panel.querySelector<HTMLElement>('#autolock-timeout-section')!;

  autoLockCheckbox.addEventListener('change', () => {
    const enabled = autoLockCheckbox.checked;
    settingsStore.update({ autoLockEnabled: enabled });
    timeoutSection.style.opacity = enabled ? '1' : '0.4';
    timeoutSection.style.pointerEvents = enabled ? '' : 'none';
  });

  // Auto-lock timeout buttons
  const timeoutBtns = panel.querySelectorAll('.wrap-btn[data-mins]');
  const customTimeout = panel.querySelector<HTMLInputElement>('#setting-custom-timeout')!;

  timeoutBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      timeoutBtns.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      const mins = btn.getAttribute('data-mins')!;
      if (mins === 'custom') {
        customTimeout.style.display = 'block';
        customTimeout.focus();
      } else {
        customTimeout.style.display = 'none';
        settingsStore.update({ autoLockTimeoutMins: parseInt(mins, 10) });
      }
    });
  });

  customTimeout.addEventListener('input', () => {
    const val = parseInt(customTimeout.value, 10);
    if (val >= 1 && val <= 1440) {
      settingsStore.update({ autoLockTimeoutMins: val });
    }
  });

  // Close on overlay click
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      closeSettings();
    }
  });

  // Close on Escape
  const escHandler = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      closeSettings();
      document.removeEventListener('keydown', escHandler);
    }
  };
  document.addEventListener('keydown', escHandler);
}

export function closeSettings(): void {
  isOpen = false;
  const overlay = document.getElementById('settings-overlay')!;
  overlay.classList.add('hidden');
  overlay.innerHTML = '';
}

export function isSettingsOpen(): boolean {
  return isOpen;
}
