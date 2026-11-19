// Syntax highlighting from TextMate grammars (.tmLanguage / .tmLanguage.json),
// the format VS Code, Sublime Text and TextMate all use. vscode-textmate does
// the tokenizing; vscode-oniguruma provides the regex engine those grammars
// are written for, as WebAssembly.

import * as monaco from 'monaco-editor';
import { INITIAL, Registry, parseRawGrammar, type IGrammar, type IOnigLib, type StateStack } from 'vscode-textmate';
import { createOnigScanner, createOnigString, loadWASM } from 'vscode-oniguruma';
import onigWasmUrl from 'vscode-oniguruma/release/onig.wasm?url';

// Same limits as VS Code: very long lines aren't tokenized, and a grammar
// gets a bounded amount of time per line so a pathological one can't hang
// the editor.
const MAX_LINE_LENGTH = 20_000;
const LINE_TIME_LIMIT_MS = 500;

export interface GrammarSource {
  scopeName: string;
  /** Language id this grammar highlights; unset for grammars that are only included or injected. */
  language?: string;
  injectTo?: string[];
  /** Path, used to tell JSON grammars from plist ones. */
  path: string;
  load(): Promise<string>;
}

let onigLib: Promise<IOnigLib> | null = null;

function getOnigLib(): Promise<IOnigLib> {
  onigLib ??= fetch(onigWasmUrl)
    .then((r) => r.arrayBuffer())
    .then((wasm) => loadWASM(wasm))
    .then(() => ({ createOnigScanner, createOnigString }));
  return onigLib;
}

// ── Which scope to report ───────────────────────────────────────────────────
// TextMate gives each token a stack of scopes (outermost first); Monaco wants
// one. Report the innermost scope the current theme actually colours, so the
// quote marks of a string (scoped `punctuation.definition.string…` inside
// `string.quoted…`) take the string colour when the theme has no punctuation
// rule — what VS Code's full selector matching would do.

// Monaco's built-in (inherited) rules, minus "meta", which would otherwise
// capture structural scopes like meta.function.
const BASE_RULE_TOKENS = [
  'comment', 'string', 'keyword', 'constant', 'variable', 'number', 'regexp', 'type',
  'delimiter', 'tag', 'invalid', 'emphasis', 'strong', 'annotation', 'attribute', 'key', 'metatag',
];
let ruleTokens = new Set(BASE_RULE_TOKENS);
const coloured = new Map<string, boolean>();

/** Call before switching Monaco's theme; Monaco then re-tokenizes everything. */
export function setThemeRuleTokens(tokens: Iterable<string>): void {
  ruleTokens = new Set([...BASE_RULE_TOKENS, ...tokens]);
  coloured.clear();
}

function isColoured(scope: string): boolean {
  let hit = coloured.get(scope);
  if (hit === undefined) {
    hit = false;
    for (let s = scope; s; s = s.slice(0, Math.max(0, s.lastIndexOf('.')))) {
      if (ruleTokens.has(s)) {
        hit = true;
        break;
      }
    }
    coloured.set(scope, hit);
  }
  return hit;
}

function pickScope(scopes: string[]): string {
  for (let i = scopes.length - 1; i > 0; i--) {
    if (isColoured(scopes[i])) return scopes[i];
  }
  return scopes[0];
}

function tokensProvider(grammar: IGrammar, rootScope: string): monaco.languages.TokensProvider {
  return {
    // vscode-textmate's StateStack already implements clone() and equals().
    getInitialState: () => INITIAL as unknown as monaco.languages.IState,
    tokenize(line, state) {
      if (line.length > MAX_LINE_LENGTH) {
        return { tokens: [{ startIndex: 0, scopes: rootScope }], endState: state };
      }
      const result = grammar.tokenizeLine(line, state as unknown as StateStack, LINE_TIME_LIMIT_MS);
      return {
        endState: result.ruleStack as unknown as monaco.languages.IState,
        tokens: result.tokens.map((t) => ({ startIndex: t.startIndex, scopes: pickScope(t.scopes) })),
      };
    },
  };
}

// Monaco creates a built-in language's tokenizer once, lazily; removing a
// replacement doesn't bring it back. Its `loader` stays on the registered
// language, though, so the original can be re-installed from it.
async function restoreBuiltinTokenizer(languageId: string): Promise<void> {
  const lang = monaco.languages.getLanguages().find((l) => l.id === languageId) as
    | { loader?: () => Promise<{ language?: monaco.languages.IMonarchLanguage }> }
    | undefined;
  try {
    const mod = await lang?.loader?.();
    if (mod?.language) monaco.languages.setMonarchTokensProvider(languageId, mod.language);
  } catch {
    // Not a built-in language; it simply has no highlighting now.
  }
}

export interface GrammarRegistration {
  /** Removes the grammars, restoring any built-in highlighting they replaced. */
  dispose(): Promise<void>;
}

/**
 * Loads every grammar that is attached to a language and installs it as that
 * language's tokenizer. Other grammars are loaded on demand when included or
 * injected.
 */
export async function registerGrammars(
  sources: GrammarSource[],
  onError: (source: GrammarSource, error: unknown) => void,
): Promise<GrammarRegistration> {
  const installed: { language: string; registration: monaco.IDisposable }[] = [];
  const registration: GrammarRegistration = {
    async dispose() {
      for (const { registration } of installed) registration.dispose();
      await Promise.all([...new Set(installed.map((i) => i.language))].map(restoreBuiltinTokenizer));
    },
  };
  if (!sources.length) return registration;
  const byScope = new Map(sources.map((s) => [s.scopeName, s]));
  const injections = new Map<string, string[]>();
  for (const s of sources) {
    for (const target of s.injectTo ?? []) injections.set(target, [...(injections.get(target) ?? []), s.scopeName]);
  }

  const registry = new Registry({
    onigLib: getOnigLib(),
    async loadGrammar(scopeName) {
      const source = byScope.get(scopeName);
      if (!source) return null;
      try {
        return parseRawGrammar(await source.load(), source.path);
      } catch (e) {
        onError(source, e);
        return null;
      }
    },
    getInjections: (scopeName) => injections.get(scopeName),
  });

  for (const source of sources) {
    if (!source.language) continue;
    try {
      const grammar = await registry.loadGrammar(source.scopeName);
      if (grammar) {
        installed.push({
          language: source.language,
          registration: monaco.languages.setTokensProvider(source.language, tokensProvider(grammar, source.scopeName)),
        });
      }
    } catch (e) {
      onError(source, e);
    }
  }
  return registration;
}
