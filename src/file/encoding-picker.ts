import type { Tab } from '../tabs/tab-store';
import { ENCODINGS, type EncodingChoice } from './encoding';
import { reopenWithEncoding, saveWithEncoding } from './file-ops';

/**
 * The status bar's encoding menu. Two steps, as in VS Code: pick "Reopen with
 * Encoding" (the file was decoded wrongly) or "Save with Encoding" (convert
 * it), then pick the encoding.
 */

let dropdown: HTMLElement | null = null;

function close(): void {
  dropdown?.remove();
  dropdown = null;
  document.removeEventListener('mousedown', onOutsideClick, true);
}

function onOutsideClick(e: MouseEvent): void {
  if (dropdown && !dropdown.contains(e.target as Node)) close();
}

function addItem(label: string, onClick: () => void, active = false): void {
  const item = document.createElement('div');
  item.className = `lang-item${active ? ' active' : ''}`;
  item.textContent = label;
  item.addEventListener('click', onClick);
  dropdown!.appendChild(item);
}

function showEncodings(tab: Tab, onPick: (choice: EncodingChoice) => void): void {
  dropdown!.replaceChildren();
  for (const choice of ENCODINGS) {
    const current = choice.encoding === tab.encoding && choice.bom === tab.bom;
    addItem(choice.label, () => {
      close();
      onPick(choice);
    }, current);
  }
}

export function toggleEncodingPicker(tab: Tab, anchor: HTMLElement): void {
  if (dropdown) {
    close();
    return;
  }
  dropdown = document.createElement('div');
  dropdown.className = 'lang-dropdown encoding-dropdown';
  dropdown.style.left = `${Math.max(4, anchor.getBoundingClientRect().left - 12)}px`;

  if (tab.filePath) {
    addItem('Reopen with Encoding…', () => {
      showEncodings(tab, (choice) => {
        if (tab.isDirty && !confirm(`Reopening "${tab.title}" discards your unsaved changes. Continue?`)) return;
        void reopenWithEncoding(tab, choice.encoding);
      });
    });
    addItem('Save with Encoding…', () => {
      showEncodings(tab, (choice) => void saveWithEncoding(tab, choice));
    });
  } else {
    // Nothing on disk to reopen: the choice only affects the first save.
    showEncodings(tab, (choice) => void saveWithEncoding(tab, choice));
  }

  document.body.appendChild(dropdown);
  setTimeout(() => document.addEventListener('mousedown', onOutsideClick, true), 0);
}
