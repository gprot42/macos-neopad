import {
  getTabs,
  getActiveId,
  setActive,
  removeTab,
  addTab,
  reorderTab,
} from './tab-store';
import { setEditorModel, getEditor } from '../editor/editor-manager';
import { openSettings } from '../settings/settings-panel';

let dragState: {
  tabId: string;
  el: HTMLElement;
  startX: number;
  offsetX: number;
  placeholder: HTMLElement | null;
} | null = null;

export function renderTabBar(): void {
  const container = document.getElementById('tab-bar')!;
  container.innerHTML = '';

  const tabs = getTabs();
  const activeId = getActiveId();

  for (const tab of tabs) {
    const el = document.createElement('div');
    el.className = `tab${tab.id === activeId ? ' active' : ''}${tab.isDirty ? ' dirty' : ''}`;
    el.dataset.id = tab.id;

    const titleSpan = document.createElement('span');
    titleSpan.textContent = tab.title;

    const dirtyDot = document.createElement('span');
    dirtyDot.className = 'dirty-dot';

    const closeBtn = document.createElement('span');
    closeBtn.className = 'close-btn';
    closeBtn.textContent = '\u00d7';
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      removeTab(tab.id);
      const active = getTabs().length > 0 ? getTabs().find((t) => t.id === getActiveId()) : null;
      setEditorModel(active?.model ?? null);
    });

    el.appendChild(dirtyDot);
    el.appendChild(titleSpan);
    el.appendChild(closeBtn);

    el.addEventListener('click', () => {
      if (dragState) return;
      setActive(tab.id);
      const t = getTabs().find((t) => t.id === tab.id);
      if (t) setEditorModel(t.model);
    });

    el.addEventListener('auxclick', (e) => {
      if (e.button === 1) {
        removeTab(tab.id);
        const active = getTabs().length > 0 ? getTabs().find((t) => t.id === getActiveId()) : null;
        setEditorModel(active?.model ?? null);
      }
    });

    // Pointer-based drag reordering
    el.addEventListener('pointerdown', (e) => {
      if ((e.target as HTMLElement).classList.contains('close-btn')) return;
      if (e.button !== 0) return;

      const rect = el.getBoundingClientRect();
      dragState = {
        tabId: tab.id,
        el,
        startX: e.clientX,
        offsetX: e.clientX - rect.left,
        placeholder: null,
      };
      el.setPointerCapture(e.pointerId);
    });

    el.addEventListener('pointermove', (e) => {
      if (!dragState || dragState.tabId !== tab.id) return;
      const dx = Math.abs(e.clientX - dragState.startX);
      if (dx < 5 && !dragState.placeholder) return;

      if (!dragState.placeholder) {
        // Start dragging — create placeholder and float the tab
        dragState.placeholder = document.createElement('div');
        dragState.placeholder.className = 'tab-placeholder';
        dragState.placeholder.style.width = `${el.offsetWidth}px`;
        dragState.placeholder.style.height = `${el.offsetHeight}px`;
        el.parentElement!.insertBefore(dragState.placeholder, el);
        el.classList.add('dragging');
        el.style.position = 'fixed';
        el.style.zIndex = '9999';
        el.style.width = `${el.offsetWidth}px`;
        el.style.top = `${el.getBoundingClientRect().top}px`;
        el.style.pointerEvents = 'none';
      }

      el.style.left = `${e.clientX - dragState.offsetX}px`;

      // Find which tab we're hovering over
      const tabEls = container.querySelectorAll('.tab:not(.dragging)');
      for (const other of tabEls) {
        const rect = other.getBoundingClientRect();
        const mid = rect.left + rect.width / 2;
        if (e.clientX > rect.left && e.clientX < rect.right) {
          const otherId = (other as HTMLElement).dataset.id!;
          if (otherId !== dragState.tabId) {
            // Move placeholder to indicate drop position
            if (e.clientX < mid) {
              container.insertBefore(dragState.placeholder!, other);
            } else {
              container.insertBefore(dragState.placeholder!, other.nextSibling);
            }
          }
          break;
        }
      }
    });

    el.addEventListener('pointerup', () => {
      if (!dragState || dragState.tabId !== tab.id) return;

      if (dragState.placeholder) {
        // Find the target position based on placeholder location
        const allEls = Array.from(container.querySelectorAll('.tab:not(.dragging), .tab-placeholder'));
        const placeholderIdx = allEls.indexOf(dragState.placeholder);
        const tabIds = getTabs().map(t => t.id);
        const fromIdx = tabIds.indexOf(dragState.tabId);

        // Count actual tabs before the placeholder
        let toIdx = 0;
        for (let i = 0; i < placeholderIdx; i++) {
          if (allEls[i].classList.contains('tab')) toIdx++;
        }
        if (toIdx > fromIdx) toIdx--; // adjust since dragged tab is removed first

        // Clean up DOM
        dragState.placeholder.remove();
        el.classList.remove('dragging');
        el.style.position = '';
        el.style.zIndex = '';
        el.style.width = '';
        el.style.top = '';
        el.style.left = '';
        el.style.pointerEvents = '';

        // Apply reorder
        if (toIdx !== fromIdx && toIdx >= 0) {
          const targetId = getTabs()[toIdx >= getTabs().length ? getTabs().length - 1 : toIdx]?.id;
          if (targetId && targetId !== dragState.tabId) {
            reorderTab(dragState.tabId, targetId);
          }
        }
      }

      dragState = null;
    });

    container.appendChild(el);
  }

  // New tab button
  const newBtn = document.createElement('div');
  newBtn.className = 'tab-new-btn';
  newBtn.textContent = '+';
  newBtn.title = 'New Tab';
  newBtn.addEventListener('click', () => {
    const tab = addTab();
    setEditorModel(tab.model);
    getEditor()?.focus();
  });
  container.appendChild(newBtn);

  // Settings button
  const settingsBtn = document.createElement('div');
  settingsBtn.className = 'tab-settings-btn';
  settingsBtn.innerHTML = '&#9881;';
  settingsBtn.title = 'Settings';
  settingsBtn.addEventListener('click', () => {
    openSettings();
  });
  container.appendChild(settingsBtn);
}
