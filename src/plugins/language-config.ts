// Converts a VS Code language-configuration.json (comment markers, brackets,
// auto-closing pairs, folding and indentation rules) into Monaco's format.
// The two are nearly identical; the differences are that VS Code stores
// regular expressions as strings and pairs as two-element arrays.

import * as monaco from 'monaco-editor';

type Json = Record<string, unknown>;

function regExp(value: unknown): RegExp | undefined {
  let pattern = value;
  let flags: string | undefined;
  if (value && typeof value === 'object' && 'pattern' in value) {
    pattern = (value as Json).pattern;
    flags = typeof (value as Json).flags === 'string' ? ((value as Json).flags as string) : undefined;
  }
  if (typeof pattern !== 'string') return undefined;
  try {
    return new RegExp(pattern, flags);
  } catch {
    return undefined; // e.g. Oniguruma-only syntax
  }
}

const isStr = (v: unknown): v is string => typeof v === 'string';

function pairs(value: unknown): monaco.languages.IAutoClosingPairConditional[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.flatMap((p): monaco.languages.IAutoClosingPairConditional[] => {
    if (Array.isArray(p) && isStr(p[0]) && isStr(p[1])) return [{ open: p[0], close: p[1] }];
    if (p && typeof p === 'object' && isStr((p as Json).open) && isStr((p as Json).close)) {
      const notIn = (p as Json).notIn;
      return [{
        open: (p as Json).open as string,
        close: (p as Json).close as string,
        ...(Array.isArray(notIn) ? { notIn: notIn.filter(isStr) } : isStr(notIn) ? { notIn: [notIn] } : {}),
      }];
    }
    return [];
  });
}

function bracketPairs(value: unknown): monaco.languages.CharacterPair[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((p): p is [string, string] => Array.isArray(p) && isStr(p[0]) && isStr(p[1]));
}

const INDENT_ACTIONS: Record<string, monaco.languages.IndentAction> = {
  none: monaco.languages.IndentAction.None,
  indent: monaco.languages.IndentAction.Indent,
  indentOutdent: monaco.languages.IndentAction.IndentOutdent,
  outdent: monaco.languages.IndentAction.Outdent,
};

export function toMonacoLanguageConfiguration(raw: Json): monaco.languages.LanguageConfiguration {
  const config: monaco.languages.LanguageConfiguration = {};

  const comments = raw.comments as Json | undefined;
  if (comments && typeof comments === 'object') {
    const line = isStr(comments.lineComment) ? comments.lineComment
      : isStr((comments.lineComment as Json | undefined)?.comment) ? (comments.lineComment as Json).comment as string
      : undefined;
    const block = Array.isArray(comments.blockComment) && isStr(comments.blockComment[0]) && isStr(comments.blockComment[1])
      ? [comments.blockComment[0], comments.blockComment[1]] as monaco.languages.CharacterPair
      : undefined;
    config.comments = { ...(line ? { lineComment: line } : {}), ...(block ? { blockComment: block } : {}) };
  }

  config.brackets = bracketPairs(raw.brackets);
  config.colorizedBracketPairs = bracketPairs(raw.colorizedBracketPairs);
  config.autoClosingPairs = pairs(raw.autoClosingPairs);
  config.surroundingPairs = pairs(raw.surroundingPairs);
  if (isStr(raw.autoCloseBefore)) config.autoCloseBefore = raw.autoCloseBefore;
  config.wordPattern = regExp(raw.wordPattern);

  const folding = raw.folding as Json | undefined;
  if (folding && typeof folding === 'object') {
    const markers = folding.markers as Json | undefined;
    const start = regExp(markers?.start);
    const end = regExp(markers?.end);
    config.folding = {
      ...(typeof folding.offSide === 'boolean' ? { offSide: folding.offSide } : {}),
      ...(start && end ? { markers: { start, end } } : {}),
    };
  }

  const indent = raw.indentationRules as Json | undefined;
  const increase = regExp(indent?.increaseIndentPattern);
  const decrease = regExp(indent?.decreaseIndentPattern);
  if (increase && decrease) {
    config.indentationRules = {
      increaseIndentPattern: increase,
      decreaseIndentPattern: decrease,
      indentNextLinePattern: regExp(indent?.indentNextLinePattern),
      unIndentedLinePattern: regExp(indent?.unIndentedLinePattern),
    };
  }

  if (Array.isArray(raw.onEnterRules)) {
    config.onEnterRules = raw.onEnterRules.flatMap((r: Json): monaco.languages.OnEnterRule[] => {
      const beforeText = regExp(r?.beforeText);
      const action = r?.action as Json | undefined;
      const indentAction = isStr(action?.indent) ? INDENT_ACTIONS[action.indent] : undefined;
      if (!beforeText || indentAction === undefined) return [];
      return [{
        beforeText,
        afterText: regExp(r.afterText),
        previousLineText: regExp(r.previousLineText),
        action: {
          indentAction,
          ...(isStr(action?.appendText) ? { appendText: action.appendText } : {}),
          ...(typeof action?.removeText === 'number' ? { removeText: action.removeText } : {}),
        },
      }];
    });
  }

  // Drop unset keys so they don't override Monaco's defaults with undefined.
  for (const key of Object.keys(config) as (keyof typeof config)[]) {
    if (config[key] === undefined) delete config[key];
  }
  return config;
}
