/**
 * Password prompt dialogs for NeoPad encrypted files.
 *
 * Provides two modal dialogs:
 *   - promptPassword: single password entry (for unlocking/opening)
 *   - promptNewPassword: password + confirm (for creating an encrypted file)
 */

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Build and inject a modal overlay that resolves with a string on submit
 * or null on cancel/escape.
 */
function createPasswordModal(options: {
  title: string;
  message: string;
  confirmLabel?: string;
  withConfirm?: boolean;
  errorMessage?: string;
}): Promise<string | null> {
  return new Promise((resolve) => {
    const { title, message, confirmLabel = 'Unlock', withConfirm = false, errorMessage } = options;

    const overlay = document.createElement('div');
    overlay.id = 'password-dialog-overlay';
    overlay.innerHTML = `
      <div class="password-dialog-box">
        <div class="password-dialog-icon">🔒</div>
        <h3 class="password-dialog-title">${title}</h3>
        <p class="password-dialog-message">${message}</p>
        ${errorMessage ? `<p class="password-dialog-error">${errorMessage}</p>` : ''}
        <div class="password-dialog-fields">
          <input
            type="password"
            id="pwd-input-main"
            class="password-dialog-input"
            placeholder="Password"
            autocomplete="current-password"
          />
          ${
            withConfirm
              ? `<input
                  type="password"
                  id="pwd-input-confirm"
                  class="password-dialog-input"
                  placeholder="Confirm password"
                  autocomplete="new-password"
                />`
              : ''
          }
        </div>
        <div class="password-dialog-actions">
          <button class="password-dialog-cancel">Cancel</button>
          <button class="password-dialog-submit">${confirmLabel}</button>
        </div>
      </div>
    `;

    const mainInput = overlay.querySelector<HTMLInputElement>('#pwd-input-main')!;
    const confirmInput = overlay.querySelector<HTMLInputElement>('#pwd-input-confirm');
    const submitBtn = overlay.querySelector<HTMLButtonElement>('.password-dialog-submit')!;
    const cancelBtn = overlay.querySelector<HTMLButtonElement>('.password-dialog-cancel')!;

    function cleanup() {
      overlay.remove();
      document.removeEventListener('keydown', keyHandler);
    }

    function submit() {
      const password = mainInput.value;
      if (!password) {
        mainInput.focus();
        mainInput.classList.add('shake');
        setTimeout(() => mainInput.classList.remove('shake'), 400);
        return;
      }
      if (withConfirm && confirmInput) {
        if (password !== confirmInput.value) {
          confirmInput.value = '';
          confirmInput.focus();
          confirmInput.classList.add('shake');
          setTimeout(() => confirmInput.classList.remove('shake'), 400);
          return;
        }
      }
      cleanup();
      resolve(password);
    }

    submitBtn.addEventListener('click', submit);
    cancelBtn.addEventListener('click', () => { cleanup(); resolve(null); });

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) { cleanup(); resolve(null); }
    });

    function keyHandler(e: KeyboardEvent) {
      if (e.key === 'Escape') { cleanup(); resolve(null); }
      if (e.key === 'Enter') { submit(); }
    }
    document.addEventListener('keydown', keyHandler);

    document.body.appendChild(overlay);

    // Focus after DOM insertion
    requestAnimationFrame(() => mainInput.focus());
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Show a single-field password prompt (for opening / unlocking encrypted files).
 *
 * @param message  Short context message shown below the title
 * @param options  Optional overrides
 * @returns The entered password, or null if the user cancelled
 */
export async function promptPassword(
  message: string,
  options: { title?: string; errorMessage?: string } = {},
): Promise<string | null> {
  return createPasswordModal({
    title: options.title ?? 'Enter Password',
    message,
    confirmLabel: 'Unlock',
    withConfirm: false,
    errorMessage: options.errorMessage,
  });
}

/**
 * Show a password + confirm dialog (for creating a new encrypted file or
 * changing the password).
 *
 * @param title  Optional dialog title
 * @returns The new password, or null if the user cancelled
 */
export async function promptNewPassword(title = 'Set Encryption Password'): Promise<string | null> {
  return createPasswordModal({
    title,
    message: 'Choose a strong password. If lost, the file cannot be recovered.',
    confirmLabel: 'Encrypt & Save',
    withConfirm: true,
  });
}
