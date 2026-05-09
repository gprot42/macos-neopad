/**
 * Lock Manager — tracks the encryption/lock state of open tabs and drives
 * the optional auto-lock-on-inactivity feature.
 *
 * Responsibilities:
 *   - Remember which tabs hold encrypted (.neo) files and their in-memory
 *     decryption password (cleared on lock).
 *   - Store an encrypted snapshot of editor content when a tab is locked so
 *     that unsaved edits survive the lock/unlock cycle.
 *   - Emit a "lock" event that the UI consumes to clear editor content and
 *     show the lock overlay.
 *   - Run an inactivity timer that fires the lock event after a configurable
 *     timeout.
 */

// ---------------------------------------------------------------------------
// Per-tab state
// ---------------------------------------------------------------------------

interface TabLockState {
  /** In-memory password — null when the tab is locked */
  password: string | null;
  /** AES-GCM encrypted snapshot of editor content, stored during lock */
  encryptedSnapshot: string | null;
  /** Whether this tab is currently in the locked (content hidden) state */
  isLocked: boolean;
}

const tabStates = new Map<string, TabLockState>();

// ---------------------------------------------------------------------------
// Lock listeners
// ---------------------------------------------------------------------------

type LockListener = () => void;
const lockListeners: LockListener[] = [];

// ---------------------------------------------------------------------------
// Auto-lock timer
// ---------------------------------------------------------------------------

let autoLockEnabled = false;
let lockTimeoutMs = 60 * 60 * 1000; // default: 1 hour
let lockTimer: ReturnType<typeof setTimeout> | null = null;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const lockManager = {
  // ── Registration ──────────────────────────────────────────────────────────

  /**
   * Register a tab as an open encrypted file with its in-memory password.
   * Called after a .neo file is successfully opened or newly created.
   */
  registerEncryptedTab(tabId: string, password: string): void {
    tabStates.set(tabId, {
      password,
      encryptedSnapshot: null,
      isLocked: false,
    });
  },

  /** Remove all tracking state for a tab (call on tab close). */
  removeTab(tabId: string): void {
    tabStates.delete(tabId);
  },

  // ── Queries ───────────────────────────────────────────────────────────────

  /** True if the tab is an open encrypted .neo file. */
  isEncryptedTab(tabId: string): boolean {
    return tabStates.has(tabId);
  },

  /** True if the tab is currently locked (content hidden). */
  isLocked(tabId: string): boolean {
    return tabStates.get(tabId)?.isLocked ?? false;
  },

  /** Returns the in-memory password, or null if locked / unknown. */
  getPassword(tabId: string): string | null {
    return tabStates.get(tabId)?.password ?? null;
  },

  /** Returns the encrypted snapshot stored at lock time, or null. */
  getSnapshot(tabId: string): string | null {
    return tabStates.get(tabId)?.encryptedSnapshot ?? null;
  },

  /** 
   * Returns all tab IDs that are currently registered as encrypted.
   * Includes both locked and unlocked tabs.
   */
  getEncryptedTabIds(): string[] {
    return Array.from(tabStates.keys());
  },

  /**
   * Returns all tab IDs that are registered as encrypted AND currently unlocked
   * (i.e. have an in-memory password and live content in the editor model).
   */
  getUnlockedTabIds(): string[] {
    return Array.from(tabStates.entries())
      .filter(([, s]) => !s.isLocked && s.password !== null)
      .map(([id]) => id);
  },

  // ── State transitions ─────────────────────────────────────────────────────

  /**
   * Record the encrypted snapshot and mark the tab as locked.
   * The in-memory password is erased.
   * The caller is responsible for clearing the Monaco model content.
   */
  lockTab(tabId: string, encryptedSnapshot: string): void {
    const state = tabStates.get(tabId);
    if (!state) return;
    state.encryptedSnapshot = encryptedSnapshot;
    state.isLocked = true;
    state.password = null; // zero out the password
  },

  /**
   * Store the decrypted password, clear the snapshot, and mark the tab as
   * unlocked.  The caller is responsible for restoring the Monaco model.
   */
  unlockTab(tabId: string, password: string): void {
    const state = tabStates.get(tabId);
    if (!state) return;
    state.password = password;
    state.isLocked = false;
    state.encryptedSnapshot = null;
  },

  /**
   * Update the in-memory password for a tab (used when the user changes the
   * encryption password of an already-open file).
   */
  updatePassword(tabId: string, password: string): void {
    const state = tabStates.get(tabId);
    if (state) state.password = password;
  },

  // ── Lock event ────────────────────────────────────────────────────────────

  /** Subscribe to the lock event (fired when auto-lock timeout expires). */
  onLock(fn: LockListener): void {
    lockListeners.push(fn);
  },

  /** Manually trigger the lock event (also used by the auto-lock timer). */
  triggerLock(): void {
    lockListeners.forEach((fn) => fn());
  },
};

// ---------------------------------------------------------------------------
// Auto-lock timer management
// ---------------------------------------------------------------------------

/**
 * Start the auto-lock inactivity timer with the given timeout.
 * Calling this again with a different timeout replaces the previous timer.
 */
export function startAutoLock(timeoutMs: number): void {
  autoLockEnabled = true;
  lockTimeoutMs = timeoutMs;
  resetActivityTimer();
}

/** Disable auto-lock and cancel any pending timer. */
export function stopAutoLock(): void {
  autoLockEnabled = false;
  if (lockTimer !== null) {
    clearTimeout(lockTimer);
    lockTimer = null;
  }
}

/**
 * Reset the inactivity timer back to the full configured timeout.
 * Called on any user interaction (keyboard, mouse, etc.).
 * No-op when auto-lock is disabled.
 */
export function resetActivityTimer(): void {
  if (!autoLockEnabled) return;
  if (lockTimer !== null) clearTimeout(lockTimer);
  lockTimer = setTimeout(() => {
    lockTimer = null;
    lockManager.triggerLock();
  }, lockTimeoutMs);
}
