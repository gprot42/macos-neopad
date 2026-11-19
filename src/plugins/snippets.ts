// VS Code snippet files: { "Name": { "prefix": "log", "body": [...], "description": "…" } }.
// Monaco understands the same snippet syntax ($1, ${1:default}, ${1|a,b|}, $TM_FILENAME…).

import * as monaco from 'monaco-editor';

export interface Snippet {
  name: string;
  prefixes: string[];
  body: string;
  description: string;
}

const lines = (v: unknown): string | undefined =>
  typeof v === 'string' ? v : Array.isArray(v) && v.every((s) => typeof s === 'string') ? v.join('\n') : undefined;

export function parseSnippets(json: Record<string, unknown>): Snippet[] {
  const out: Snippet[] = [];
  for (const [name, value] of Object.entries(json)) {
    if (!value || typeof value !== 'object') continue;
    const s = value as Record<string, unknown>;
    const body = lines(s.body);
    const prefixes = (Array.isArray(s.prefix) ? s.prefix : [s.prefix]).filter((p): p is string => typeof p === 'string' && p.length > 0);
    if (body === undefined || !prefixes.length) continue;
    out.push({ name, prefixes, body, description: lines(s.description) ?? '' });
  }
  return out;
}

export function registerSnippets(language: string, snippets: Snippet[], source: string): monaco.IDisposable {
  return monaco.languages.registerCompletionItemProvider(language, {
    provideCompletionItems(model, position) {
      const word = model.getWordUntilPosition(position);
      const range = new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn);
      return {
        suggestions: snippets.flatMap((s) => s.prefixes.map((prefix) => ({
          label: { label: prefix, description: s.name },
          kind: monaco.languages.CompletionItemKind.Snippet,
          detail: `Snippet from ${source}`,
          // Plain text, never rendered as Markdown: plugin content isn't trusted.
          documentation: [s.description, s.body].filter(Boolean).join('\n\n'),
          insertText: s.body,
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          range,
        }))),
      };
    },
  });
}
