import * as monaco from 'monaco-editor';

// Colour tokens that produce the yellow "occurrence highlight" boxes.
// Setting them all to #00000000 (fully transparent) kills the boxes in every theme.
const NO_HIGHLIGHT: Record<string, string> = {
  'editor.wordHighlightBackground':            '#00000000',
  'editor.wordHighlightBorder':                '#00000000',
  'editor.wordHighlightStrongBackground':      '#00000000',
  'editor.wordHighlightStrongBorder':          '#00000000',
  'editor.wordHighlightTextBackground':        '#00000000',
  'editor.wordHighlightTextBorder':            '#00000000',
  'editor.selectionHighlightBackground':       '#00000000',
  'editor.selectionHighlightBorder':           '#00000000',
};

// Markdown-specific syntax colours.  Every Monaco markdown token carries the
// `.md` postfix, so these rules are scoped to markdown only and never affect
// other languages.  Tokens come from Monaco's markdown Monarch grammar:
//   keyword.md          -> headers (#) and list markers (- * + 1.)
//   strong.md           -> **bold** / __bold__
//   emphasis.md         -> *italic* / _italic_
//   variable.md         -> `inline code`
//   variable.source.md  -> fenced/indented code-block content
//   string.md           -> code fences / indented code lines
//   string.link.md      -> [text](url) links and ![alt](src) images
//   string.target.md    -> {reference} targets
//   comment.md          -> > blockquotes (and HTML comments)
//   meta.separator.md   -> --- / *** horizontal rules
//   keyword.table       -> table pipes / header cells
interface MarkdownPalette {
  header: string;
  strong: string;
  emphasis: string;
  code: string;
  codeBlock: string;
  fence: string;
  link: string;
  linkTarget: string;
  quote: string;
  hr: string;
  table: string;
}

function markdownRules(c: MarkdownPalette): monaco.editor.ITokenThemeRule[] {
  return [
    { token: 'keyword.md',         foreground: c.header,     fontStyle: 'bold' },
    { token: 'strong.md',          foreground: c.strong,     fontStyle: 'bold' },
    { token: 'emphasis.md',        foreground: c.emphasis,   fontStyle: 'italic' },
    { token: 'variable.md',        foreground: c.code },
    { token: 'variable.source.md', foreground: c.codeBlock },
    { token: 'string.md',          foreground: c.fence },
    { token: 'string.link.md',     foreground: c.link,       fontStyle: 'underline' },
    { token: 'string.target.md',   foreground: c.linkTarget },
    { token: 'comment.md',         foreground: c.quote,      fontStyle: 'italic' },
    { token: 'meta.separator.md',  foreground: c.hr,         fontStyle: 'bold' },
    { token: 'keyword.table',      foreground: c.table },
  ];
}

export function registerThemes(): void {
  monaco.editor.defineTheme('neo-light', {
    base: 'vs',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '6a737d', fontStyle: 'italic' },
      { token: 'keyword', foreground: 'cf222e' },
      { token: 'keyword.control', foreground: 'cf222e' },
      { token: 'storage', foreground: 'cf222e' },
      { token: 'storage.type', foreground: 'cf222e' },
      { token: 'string', foreground: '0a3069' },
      { token: 'string.escape', foreground: '0550ae' },
      { token: 'number', foreground: '0550ae' },
      { token: 'constant', foreground: '0550ae' },
      { token: 'constant.language', foreground: '0550ae' },
      { token: 'variable', foreground: '24292f' },
      { token: 'variable.predefined', foreground: '953800' },
      { token: 'type', foreground: '953800' },
      { token: 'type.identifier', foreground: '953800' },
      { token: 'tag', foreground: '116329' },
      { token: 'attribute.name', foreground: '0550ae' },
      { token: 'attribute.value', foreground: '0a3069' },
      { token: 'delimiter', foreground: '24292f' },
      { token: 'operator', foreground: 'cf222e' },
      { token: 'function', foreground: '8250df' },
      { token: 'identifier', foreground: '24292f' },
      { token: 'regexp', foreground: '116329' },
      { token: 'annotation', foreground: '953800' },
      { token: 'key', foreground: '0550ae' },
      { token: 'metatag', foreground: '116329' },
      { token: 'metatag.content', foreground: '0a3069' },
      ...markdownRules({
        header: '0550ae', strong: '953800', emphasis: '8250df', code: '0a3069',
        codeBlock: '0a3069', fence: '6a737d', link: '0969da', linkTarget: '116329',
        quote: '6a737d', hr: '8250df', table: '0550ae',
      }),
    ],
    colors: {
      'editor.background': '#ffffff',
      'editor.foreground': '#24292f',
      'editorLineNumber.foreground': '#8c959f',
      'editorLineNumber.activeForeground': '#24292f',
      'editorCursor.foreground': '#0969da',
      'editor.selectionBackground': '#add6ff80',
      'editor.lineHighlightBackground': '#f6f8fa',
      'editor.findMatchBackground': '#bf870040',
      'editor.findMatchHighlightBackground': '#bf870020',
      'editorBracketMatch.background': '#add6ff40',
      'editorBracketMatch.border': '#0969da50',
      'editorIndentGuide.background': '#d1d9e0',
      'editorIndentGuide.activeBackground': '#8c959f',
      'editorWidget.background': '#f6f8fa',
      'editorWidget.border': '#d1d9e0',
      'input.background': '#ffffff',
      'input.border': '#d1d9e0',
      'input.foreground': '#24292f',
      'focusBorder': '#0969da',
      'list.activeSelectionBackground': '#ddf4ff',
      'list.hoverBackground': '#eaeef2',
      ...NO_HIGHLIGHT,
    },
  });

  monaco.editor.defineTheme('neo-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      ...markdownRules({
        header: '569cd6', strong: 'd7ba7d', emphasis: 'dcdcaa', code: 'ce9178',
        codeBlock: 'b5cea8', fence: '808080', link: '4ec9b0', linkTarget: '9cdcfe',
        quote: '6a9955', hr: 'c586c0', table: '4ec9b0',
      }),
    ],
    colors: {
      'editor.background': '#1e1e1e',
      'editor.foreground': '#d4d4d4',
      'editorLineNumber.foreground': '#858585',
      'editorCursor.foreground': '#0078d4',
      'editor.selectionBackground': '#264f78',
      'editor.lineHighlightBackground': '#2a2a2a',
      ...NO_HIGHLIGHT,
    },
  });

  monaco.editor.defineTheme('neo-tokyo-night', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '565f89', fontStyle: 'italic' },
      { token: 'keyword', foreground: 'bb9af7' },
      { token: 'keyword.control', foreground: 'bb9af7' },
      { token: 'storage', foreground: 'bb9af7' },
      { token: 'storage.type', foreground: 'bb9af7' },
      { token: 'string', foreground: '9ece6a' },
      { token: 'string.escape', foreground: '9ece6a' },
      { token: 'number', foreground: 'ff9e64' },
      { token: 'number.hex', foreground: 'ff9e64' },
      { token: 'constant', foreground: 'ff9e64' },
      { token: 'constant.language', foreground: 'ff9e64' },
      { token: 'variable', foreground: 'c0caf5' },
      { token: 'variable.predefined', foreground: 'c0caf5' },
      { token: 'type', foreground: '2ac3de' },
      { token: 'type.identifier', foreground: '2ac3de' },
      { token: 'tag', foreground: 'f7768e' },
      { token: 'attribute.name', foreground: 'bb9af7' },
      { token: 'attribute.value', foreground: '9ece6a' },
      { token: 'delimiter', foreground: '89ddff' },
      { token: 'delimiter.bracket', foreground: 'a9b1d6' },
      { token: 'operator', foreground: '89ddff' },
      { token: 'function', foreground: '7aa2f7' },
      { token: 'identifier', foreground: 'c0caf5' },
      { token: 'regexp', foreground: 'b4f9f8' },
      { token: 'annotation', foreground: 'e0af68' },
      { token: 'key', foreground: '73daca' },
      { token: 'metatag', foreground: 'f7768e' },
      { token: 'metatag.content', foreground: '9ece6a' },
      ...markdownRules({
        header: '7aa2f7', strong: 'ff9e64', emphasis: 'e0af68', code: 'bb9af7',
        codeBlock: '9ece6a', fence: '565f89', link: '73daca', linkTarget: '7dcfff',
        quote: '9aa5ce', hr: 'bb9af7', table: '7dcfff',
      }),
    ],
    colors: {
      'editor.background': '#1a1b26',
      'editor.foreground': '#a9b1d6',
      'editorLineNumber.foreground': '#3b4261',
      'editorLineNumber.activeForeground': '#737aa2',
      'editorCursor.foreground': '#c0caf5',
      'editor.selectionBackground': '#2e3c64',
      'editor.lineHighlightBackground': '#1e2030',
      'editor.findMatchBackground': '#3d59a166',
      'editor.findMatchHighlightBackground': '#3d59a133',
      'editorBracketMatch.background': '#1a1b2600',
      'editorBracketMatch.border': '#545c7e',
      'editorIndentGuide.background': '#292e42',
      'editorIndentGuide.activeBackground': '#3b4261',
      'editorWidget.background': '#16161e',
      'editorWidget.border': '#292e42',
      'input.background': '#1a1b26',
      'input.border': '#292e42',
      'input.foreground': '#a9b1d6',
      'focusBorder': '#7aa2f7',
      'list.activeSelectionBackground': '#2e3c64',
      'list.hoverBackground': '#1f2335',
      ...NO_HIGHLIGHT,
    },
  });

  monaco.editor.defineTheme('neo-mariana', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '8d9eb3', fontStyle: 'italic' },
      { token: 'keyword', foreground: 'c594c5' },
      { token: 'keyword.control', foreground: 'c594c5' },
      { token: 'storage', foreground: 'c594c5' },
      { token: 'storage.type', foreground: 'c594c5' },
      { token: 'string', foreground: '99c794' },
      { token: 'string.escape', foreground: '5fb4b4' },
      { token: 'number', foreground: 'f99157' },
      { token: 'number.hex', foreground: 'f99157' },
      { token: 'constant', foreground: 'f99157' },
      { token: 'constant.language', foreground: 'ec5f67' },
      { token: 'variable', foreground: 'd8dee9' },
      { token: 'variable.predefined', foreground: 'ec5f67' },
      { token: 'type', foreground: 'fac761' },
      { token: 'type.identifier', foreground: 'fac761' },
      { token: 'tag', foreground: 'ec5f67' },
      { token: 'attribute.name', foreground: 'c594c5' },
      { token: 'attribute.value', foreground: '99c794' },
      { token: 'delimiter', foreground: 'd8dee9' },
      { token: 'delimiter.bracket', foreground: 'd8dee9' },
      { token: 'operator', foreground: '5fb4b4' },
      { token: 'function', foreground: '6699cc' },
      { token: 'identifier', foreground: 'd8dee9' },
      { token: 'regexp', foreground: '5fb4b4' },
      { token: 'annotation', foreground: 'f99157' },
      { token: 'key', foreground: '5fb4b4' },
      { token: 'metatag', foreground: 'ec5f67' },
      { token: 'metatag.content', foreground: '99c794' },
      ...markdownRules({
        header: '6699cc', strong: 'f99157', emphasis: 'fac761', code: 'c594c5',
        codeBlock: '99c794', fence: '8d9eb3', link: '5fb4b4', linkTarget: '5fb4b4',
        quote: '8d9eb3', hr: 'c594c5', table: '5fb4b4',
      }),
    ],
    colors: {
      'editor.background': '#303841',
      'editor.foreground': '#d8dee9',
      'editorLineNumber.foreground': '#576480',
      'editorLineNumber.activeForeground': '#a6acb9',
      'editorCursor.foreground': '#c0ac53',
      'editor.selectionBackground': '#4c566a60',
      'editor.lineHighlightBackground': '#3a4150',
      'editor.findMatchBackground': '#5fb4b440',
      'editor.findMatchHighlightBackground': '#5fb4b420',
      'editorBracketMatch.background': '#5fb4b420',
      'editorBracketMatch.border': '#5fb4b4',
      'editorIndentGuide.background': '#2e3540',
      'editorIndentGuide.activeBackground': '#576480',
      'editorWidget.background': '#262d38',
      'editorWidget.border': '#1e2229',
      'input.background': '#303841',
      'input.border': '#1e2229',
      'input.foreground': '#d8dee9',
      'focusBorder': '#5fb4b4',
      'list.activeSelectionBackground': '#4c566a60',
      'list.hoverBackground': '#2d3440',
      ...NO_HIGHLIGHT,
    },
  });
}

export const themeMap: Record<string, string> = {
  light: 'neo-light',
  dark: 'neo-dark',
  'tokyo-night': 'neo-tokyo-night',
  'mariana': 'neo-mariana',
};
