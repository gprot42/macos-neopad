export interface Settings {
  fontSize: number;
  /** A built-in theme, or a plugin theme id (`publisher.name/Label`). */
  theme: BuiltinTheme | (string & {});
  wordWrap: 'off' | 'on' | 'wordWrapColumn' | 'bounded';
  wordWrapColumn: number;
  /** Number of spaces (or columns) per indentation level */
  tabSize: number;
  /** Insert spaces instead of a tab character when indenting */
  insertSpaces: boolean;
  restoreWindowPosition: boolean;
  /** Keep the window above other apps' windows (View → Stay on Top) */
  stayOnTop: boolean;
  /** Whether encrypted (.neo) files auto-lock after a period of inactivity */
  autoLockEnabled: boolean;
  /** Inactivity timeout in minutes before encrypted files are locked */
  autoLockTimeoutMins: number;
  /** Whether the integrated terminal feature is available */
  terminalEnabled: boolean;
  /** Whether the terminal panel is currently open (restored on launch) */
  terminalOpen: boolean;
  /** Persisted height of the terminal panel in pixels */
  terminalHeight: number;
  /** Persisted terminal font size in pixels */
  terminalFontSize: number;
  /** Extension ids (`publisher.name`) of installed plugins the user switched off. */
  disabledPlugins: string[];
}

export type BuiltinTheme = 'light' | 'dark' | 'tokyo-night' | 'mariana';
export const DEFAULT_THEME: BuiltinTheme = 'tokyo-night';

const STORAGE_KEY = 'neopad-settings';

const defaults: Settings = {
  fontSize: 14,
  theme: DEFAULT_THEME,
  wordWrap: 'wordWrapColumn',
  wordWrapColumn: 80,
  tabSize: 2,
  insertSpaces: true,
  restoreWindowPosition: true,
  stayOnTop: false,
  autoLockEnabled: false,
  autoLockTimeoutMins: 60,
  terminalEnabled: true,
  terminalOpen: false,
  terminalHeight: 220,
  terminalFontSize: 13,
  disabledPlugins: [],
};

type SettingsListener = (settings: Settings) => void;
const listeners: SettingsListener[] = [];

function load(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      return { ...defaults, ...JSON.parse(raw) };
    }
  } catch {
    // ignore
  }
  return { ...defaults };
}

function save(settings: Settings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

let current = load();

export const settingsStore = {
  get(): Settings {
    return { ...current };
  },

  update(partial: Partial<Settings>): void {
    current = { ...current, ...partial };
    save(current);
    listeners.forEach((fn) => fn(current));
  },

  onChange(fn: SettingsListener): void {
    listeners.push(fn);
  },
};
