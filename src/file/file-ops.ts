import { open, save } from '@tauri-apps/plugin-dialog';
import { readFile, readTextFile, writeTextFile, writeFile, mkdir } from '@tauri-apps/plugin-fs';
import { invoke } from '@tauri-apps/api/core';
import mammoth from 'mammoth';
import { log } from '../utils/logger';
import * as docx from 'docx';
import {
  addTab,
  getActiveTab,
  markClean,
  updateTabInfo,
  closeAll,
  getDirtyTabs,
  removeTab,
  getTabs,
  getActiveId,
} from '../tabs/tab-store';
import { setEditorModel, getEditor } from '../editor/editor-manager';
import { detectLanguage } from '../editor/languages';

// Track which tabs are .docx files so we know to save back as docx
const docxTabs = new Set<string>();

function isDocxFile(path: string): boolean {
  return path.toLowerCase().endsWith('.docx');
}

function isDocFile(path: string): boolean {
  return path.toLowerCase().endsWith('.doc');
}

export function isDocxTab(tabId: string): boolean {
  return docxTabs.has(tabId);
}

export function markDocxTab(tabId: string, isDocx: boolean): void {
  if (isDocx) {
    docxTabs.add(tabId);
  } else {
    docxTabs.delete(tabId);
  }
}

/** Convert .docx binary to Markdown for editing */
async function readDocxAsMarkdown(filePath: string): Promise<string> {
  log.info('readDocxAsMarkdown:', filePath);
  const bytes = await readFile(filePath);
  log.info('readDocxAsMarkdown: read', bytes.length, 'bytes');
  const result = await mammoth.convertToHtml({ arrayBuffer: bytes.buffer });
  log.info('readDocxAsMarkdown: mammoth HTML length:', result.value.length, 'messages:', result.messages.length);
  if (result.messages.length > 0) {
    log.warn('readDocxAsMarkdown mammoth messages:', JSON.stringify(result.messages));
  }
  if (!result.value || result.value.trim().length === 0) {
    log.warn('readDocxAsMarkdown: mammoth returned EMPTY HTML');
  }
  // Extract embedded images to disk, then convert to Markdown
  const cleanHtml = await extractEmbeddedImages(result.value, filePath);
  log.info('readDocxAsMarkdown: after image extraction, HTML length:', cleanHtml.length);
  const md = htmlToMarkdownLike(cleanHtml);
  log.info('readDocxAsMarkdown: final markdown length:', md.length);
  return md;
}

/** Convert .doc (legacy) to Markdown - mammoth can handle this too */
async function readDocAsMarkdown(filePath: string): Promise<string> {
  log.info('readDocAsMarkdown:', filePath);
  // mammoth supports both .docx and .doc
  const bytes = await readFile(filePath);
  log.info('readDocAsMarkdown: read', bytes.length, 'bytes');
  const result = await mammoth.convertToHtml({ arrayBuffer: bytes.buffer });
  log.info('readDocAsMarkdown: mammoth HTML length:', result.value.length);
  if (result.messages.length > 0) {
    log.warn('readDocAsMarkdown mammoth messages:', JSON.stringify(result.messages));
  }
  const cleanHtml = await extractEmbeddedImages(result.value, filePath);
  const md = htmlToMarkdownLike(cleanHtml);
  log.info('readDocAsMarkdown: final markdown length:', md.length);
  return md;
}

/** Save embedded base64 images from HTML to disk, return HTML with file refs.
 *  Images are saved next to the source file in an `images/` subfolder. */
async function extractEmbeddedImages(html: string, docPath: string | null): Promise<string> {
  if (!docPath) {
    // No file path — strip data URI images, replace with placeholder
    return html.replace(/<img[^>]+src="data:[^"]*"[^>]*\/?>/gi, '<!-- embedded image removed -->');
  }

  const dir = docPath.replace(/[/\\][^/\\]+$/, '');
  const imagesDir = `${dir}/images`;
  let counter = 0;

  // Collect all data URI images
  const imgRegex = /<img([^>]+)src="(data:image\/([a-z]+);base64,([^"]+))"([^>]*)\/?>/gi;
  let result = html;
  let match: RegExpExecArray | null;
  const replacements: { original: string; newTag: string }[] = [];

  while ((match = imgRegex.exec(html)) !== null) {
    counter++;
    const ext = match[3] || 'png';
    const b64data = match[4];
    const filename = `image_${counter}.${ext}`;
    const imgPath = `${imagesDir}/${filename}`;

    try {
      // Decode base64 and write to disk
      const binary = atob(b64data);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      try { await mkdir(imagesDir, { recursive: true }); } catch { /* exists */ }
      await writeFile(imgPath, bytes);

      const alt = match[1].match(/alt="([^"]*)"/)?.[1] ?? '';
      replacements.push({
        original: match[0],
        newTag: `<img src="./images/${filename}" alt="${alt}" />`,
      });
    } catch {
      replacements.push({
        original: match[0],
        newTag: '<!-- embedded image (failed to save) -->',
      });
    }
  }

  for (const r of replacements) {
    result = result.replace(r.original, r.newTag);
  }

  return result;
}

/** Simple HTML to Markdown-like conversion for editing */
function htmlToMarkdownLike(html: string): string {
  let md = html;
  
  // Remove HTML comments
  md = md.replace(/<!--[\s\S]*?-->/g, '');
  
  // Convert headers
  md = md.replace(/<h1[^>]*>(.*?)<\/h1>/gi, '# $1\n\n');
  md = md.replace(/<h2[^>]*>(.*?)<\/h2>/gi, '## $1\n\n');
  md = md.replace(/<h3[^>]*>(.*?)<\/h3>/gi, '### $1\n\n');
  md = md.replace(/<h4[^>]*>(.*?)<\/h4>/gi, '#### $1\n\n');
  md = md.replace(/<h5[^>]*>(.*?)<\/h5>/gi, '##### $1\n\n');
  md = md.replace(/<h6[^>]*>(.*?)<\/h6>/gi, '###### $1\n\n');
  
  // Convert bold/strong
  md = md.replace(/<(strong|b)[^>]*>(.*?)<\/(strong|b)>/gi, '**$2**');
  
  // Convert italic/em
  md = md.replace(/<(em|i)[^>]*>(.*?)<\/(em|i)>/gi, '*$2*');
  
  // Convert strikethrough
  md = md.replace(/<s[^>]*>(.*?)<\/s>/gi, '~~$1~~');
  md = md.replace(/<del[^>]*>(.*?)<\/del>/gi, '~~$1~~');
  
  // Convert code
  md = md.replace(/<code[^>]*>(.*?)<\/code>/gi, '`$1`');
  md = md.replace(/<pre[^>]*>(.*?)<\/pre>/gis, '\n```\n$1\n```\n');
  
  // Convert links
  md = md.replace(/<a[^>]+href="([^"]*)"[^>]*>(.*?)<\/a>/gi, '[$2]($1)');
  
  // Convert images
  md = md.replace(/<img[^>]+src="([^"]*)"[^>]*alt="([^"]*)"[^>]*\/?>/gi, '![$2]($1)');
  md = md.replace(/<img[^>]+alt="([^"]*)"[^>]*src="([^"]*)"[^>]*\/?>/gi, '![$1]($2)');
  md = md.replace(/<img[^>]+src="([^"]*)"[^>]*\/?>/gi, '![]($1)');
  
  // Convert unordered lists
  md = md.replace(/<ul[^>]*>([\s\S]*?)<\/ul>/gi, (match, content) => {
    return content.replace(/<li[^>]*>(.*?)<\/li>/gi, '- $1\n') + '\n';
  });
  
  // Convert ordered lists
  let olCounter = 1;
  md = md.replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, (match, content) => {
    olCounter = 1;
    return content.replace(/<li[^>]*>(.*?)<\/li>/gi, () => {
      const item = arguments[1];
      return `${olCounter++}. ${item}\n`;
    }) + '\n';
  });
  
  // Convert blockquotes
  md = md.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (match, content) => {
    return content.split('\n').map((line: string) => '> ' + line).join('\n') + '\n\n';
  });
  
  // Convert horizontal rules
  md = md.replace(/<hr[^>]*\/?>/gi, '\n---\n\n');
  
  // Convert line breaks
  md = md.replace(/<br[^>]*\/?>/gi, '\n');
  
  // Convert paragraphs
  md = md.replace(/<p[^>]*>(.*?)<\/p>/gi, '$1\n\n');
  
  // Remove remaining HTML tags
  md = md.replace(/<[^>]+>/g, '');
  
  // Decode HTML entities
  md = md.replace(/&nbsp;/g, ' ');
  md = md.replace(/&amp;/g, '&');
  md = md.replace(/&lt;/g, '<');
  md = md.replace(/&gt;/g, '>');
  md = md.replace(/&quot;/g, '"');
  md = md.replace(/&#39;/g, "'");
  md = md.replace(/&mdash;/g, '—');
  md = md.replace(/&ndash;/g, '–');
  md = md.replace(/&hellip;/g, '...');
  
  // Clean up excessive whitespace
  md = md.replace(/\n{3,}/g, '\n\n');
  md = md.trim();
  
  return md;
}

/** Save Markdown content as .docx file */
async function saveMarkdownAsDocx(filePath: string, markdown: string): Promise<void> {
  // Simple Markdown to docx conversion
  // Parse basic markdown structure
  const lines = markdown.split('\n');
  const children: docx.Paragraph[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      children.push(new docx.Paragraph({ spacing: { after: 200 } }));
      continue;
    }

    // Headers
    const h1Match = trimmed.match(/^#\s+(.+)$/);
    const h2Match = trimmed.match(/^##\s+(.+)$/);
    const h3Match = trimmed.match(/^###\s+(.+)$/);
    const h4Match = trimmed.match(/^####\s+(.+)$/);

    if (h1Match) {
      children.push(new docx.Paragraph({
        text: h1Match[1],
        heading: docx.HeadingLevel.HEADING_1,
        spacing: { after: 200 },
      }));
    } else if (h2Match) {
      children.push(new docx.Paragraph({
        text: h2Match[1],
        heading: docx.HeadingLevel.HEADING_2,
        spacing: { after: 200 },
      }));
    } else if (h3Match) {
      children.push(new docx.Paragraph({
        text: h3Match[1],
        heading: docx.HeadingLevel.HEADING_3,
        spacing: { after: 200 },
      }));
    } else if (h4Match) {
      children.push(new docx.Paragraph({
        text: h4Match[1],
        heading: docx.HeadingLevel.HEADING_4,
        spacing: { after: 200 },
      }));
    } else if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      // Bullet list
      children.push(new docx.Paragraph({
        text: trimmed.slice(2),
        bullet: { level: 0 },
        spacing: { after: 100 },
      }));
    } else if (/^\d+\.\s/.test(trimmed)) {
      // Numbered list
      const text = trimmed.replace(/^\d+\.\s/, '');
      children.push(new docx.Paragraph({
        text,
        numbering: { reference: 'my-numbering', level: 0 },
        spacing: { after: 100 },
      }));
    } else {
      // Regular paragraph with basic inline formatting
      const parts = parseInlineFormatting(trimmed);
      children.push(new docx.Paragraph({
        children: parts,
        spacing: { after: 200 },
      }));
    }
  }

  const doc = new docx.Document({
    sections: [{
      properties: {},
      children,
    }],
  });

  const buffer = await docx.Packer.toBuffer(doc);
  const uint8Array = new Uint8Array(buffer);
  await writeFile(filePath, uint8Array);
}

/** Parse inline markdown formatting (bold, italic, code, links) */
function parseInlineFormatting(text: string): docx.TextRun[] {
  const runs: docx.TextRun[] = [];
  let remaining = text;

  // Pattern for bold, italic, code, links
  const patterns = [
    { regex: /\*\*([^*]+)\*\*/, type: 'bold' },
    { regex: /__([^_]+)__/, type: 'bold' },
    { regex: /\*([^*]+)\*/, type: 'italic' },
    { regex: /_([^_]+)_/, type: 'italic' },
    { regex: /`([^`]+)`/, type: 'code' },
    { regex: /\[([^\]]+)\]\(([^)]+)\)/, type: 'link' },
  ];

  while (remaining.length > 0) {
    let earliestMatch: { index: number; match: RegExpMatchArray; type: string } | null = null;

    for (const { regex, type } of patterns) {
      const match = remaining.match(regex);
      if (match && match.index !== undefined) {
        if (!earliestMatch || match.index < earliestMatch.index) {
          earliestMatch = { index: match.index, match, type };
        }
      }
    }

    if (earliestMatch) {
      // Add text before the match
      if (earliestMatch.index > 0) {
        runs.push(new docx.TextRun(remaining.slice(0, earliestMatch.index)));
      }

      // Add the formatted text
      const { match, type } = earliestMatch;
      if (type === 'bold') {
        runs.push(new docx.TextRun({ text: match[1], bold: true }));
      } else if (type === 'italic') {
        runs.push(new docx.TextRun({ text: match[1], italics: true }));
      } else if (type === 'code') {
        runs.push(new docx.TextRun({ text: match[1], font: 'Courier New' }));
      } else if (type === 'link') {
        runs.push(new docx.TextRun({ text: match[1], underline: { type: docx.UnderlineType.SINGLE } }));
      }

      remaining = remaining.slice(earliestMatch.index + match[0].length);
    } else {
      // No more formatting, add rest as plain text
      runs.push(new docx.TextRun(remaining));
      break;
    }
  }

  return runs.length > 0 ? runs : [new docx.TextRun(text)];
}

export async function newFile(): Promise<void> {
  const tab = addTab();
  setEditorModel(tab.model);
  getEditor()?.focus();
}

/** Open a file directly by path (used by macOS file association / Send To).
 *  Uses Rust-side file reading to bypass FS scope restrictions. */
export async function openFileByPath(filePath: string): Promise<void> {
  log.info('openFileByPath called:', filePath);
  try {
    let content: string;
    let lang = detectLanguage(filePath);
    log.info('detected language:', lang, 'isDocx:', isDocxFile(filePath), 'isDoc:', isDocFile(filePath));

    if (isDocxFile(filePath) || isDocFile(filePath)) {
      // Read binary via Rust command as base64 (bypasses FS scope)
      log.info('invoking read_file_bytes for:', filePath);
      let b64: string;
      try {
        b64 = await invoke<string>('read_file_bytes', { path: filePath });
        log.info('read_file_bytes returned', b64.length, 'base64 chars');
      } catch (readErr) {
        log.error('read_file_bytes FAILED:', readErr);
        throw readErr;
      }

      const binary = atob(b64);
      const uint8 = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        uint8[i] = binary.charCodeAt(i);
      }
      log.info('decoded to', uint8.length, 'bytes, running mammoth...');
      let result;
      try {
        result = await mammoth.convertToHtml({ arrayBuffer: uint8.buffer });
        log.info('mammoth OK, HTML length:', result.value.length, 'messages:', result.messages.length);
        if (result.messages.length > 0) {
          log.warn('mammoth messages:', JSON.stringify(result.messages));
        }
      } catch (mammothErr) {
        log.error('mammoth FAILED:', mammothErr);
        throw mammothErr;
      }
      const cleanedHtml = await extractEmbeddedImages(result.value, filePath);
      content = htmlToMarkdownLike(cleanedHtml);
      log.info('converted to markdown, length:', content.length);
      lang = 'markdown';
    } else {
      // Read text via Rust command (bypasses FS scope)
      log.info('invoking read_file_text for:', filePath);
      content = await invoke<string>('read_file_text', { path: filePath });
      log.info('read_file_text returned', content.length, 'chars');
    }

    const tab = addTab(filePath, content, lang);
    log.info('tab created:', tab.id, 'title:', tab.title);
    if (isDocxFile(filePath)) {
      markDocxTab(tab.id, true);
    }
    setEditorModel(tab.model);
    markClean(tab.id);
    log.info('openFileByPath complete for:', filePath);
  } catch (err) {
    log.error('openFileByPath FAILED for:', filePath, err instanceof Error ? err.message : String(err));
    console.error('[Neo Edit] Failed to open file:', filePath, err);
  }

  getEditor()?.focus();
}

export async function openFile(): Promise<void> {
  const result = await open({
    multiple: true,
    filters: [
      { name: 'All Files', extensions: ['*'] },
      { name: 'Text Files', extensions: ['txt', 'md', 'json', 'yaml', 'yml', 'toml', 'xml', 'html', 'css', 'js', 'ts', 'py', 'rs', 'go', 'java', 'c', 'cpp', 'h', 'hpp', 'cs', 'php', 'rb', 'swift', 'sql', 'sh'] },
      { name: 'Word Documents', extensions: ['docx', 'doc'] },
    ],
  });

  if (!result) return;

  const paths = Array.isArray(result) ? result : [result];

  for (const filePath of paths) {
    if (typeof filePath !== 'string') continue;
    try {
      let content: string;
      let lang = detectLanguage(filePath);
      log.info('openFile dialog: opening', filePath, 'lang:', lang);

      if (isDocxFile(filePath)) {
        content = await readDocxAsMarkdown(filePath);
        lang = 'markdown'; // Force markdown mode for editing
      } else if (isDocFile(filePath)) {
        content = await readDocAsMarkdown(filePath);
        lang = 'markdown';
      } else {
        content = await readTextFile(filePath);
      }

      log.info('openFile dialog: content length:', content.length, 'for', filePath);
      const tab = addTab(filePath, content, lang);
      if (isDocxFile(filePath)) {
        markDocxTab(tab.id, true);
      }
      setEditorModel(tab.model);
      markClean(tab.id);
    } catch (err) {
      log.error('openFile dialog FAILED for:', filePath, err instanceof Error ? err.message : String(err));
      console.error('Failed to open file:', err);
    }
  }

  getEditor()?.focus();
}

export async function saveFile(): Promise<void> {
  const tab = getActiveTab();
  if (!tab) return;

  if (tab.filePath) {
    try {
      if (isDocxTab(tab.id) || isDocxFile(tab.filePath)) {
        await saveMarkdownAsDocx(tab.filePath, tab.model.getValue());
      } else {
        await writeTextFile(tab.filePath, tab.model.getValue());
      }
      markClean(tab.id);
    } catch (err) {
      console.error('Failed to save file:', err);
    }
  } else {
    await saveFileAs();
  }
}

export async function saveFileAs(): Promise<void> {
  const tab = getActiveTab();
  if (!tab) return;

  const isDocx = isDocxTab(tab.id);

  const filePath = await save({
    filters: isDocx
      ? [
          { name: 'Word Document', extensions: ['docx'] },
          { name: 'All Files', extensions: ['*'] },
        ]
      : [
          { name: 'All Files', extensions: ['*'] },
          { name: 'Text Files', extensions: ['txt', 'md'] },
          { name: 'Word Document', extensions: ['docx'] },
        ],
  });

  if (!filePath) return;

  try {
    if (isDocxFile(filePath) || isDocx) {
      await saveMarkdownAsDocx(filePath, tab.model.getValue());
      if (isDocxFile(filePath)) {
        markDocxTab(tab.id, true);
      }
    } else {
      await writeTextFile(filePath, tab.model.getValue());
    }

    const lang = isDocxFile(filePath) ? 'markdown' : detectLanguage(filePath);
    updateTabInfo(tab.id, filePath, lang);
    markClean(tab.id);
  } catch (err) {
    console.error('Failed to save file:', err);
  }
}

export async function closeTab(): Promise<void> {
  const tab = getActiveTab();
  if (!tab) return;

  if (tab.isDirty) {
    const shouldSave = confirm(`Save changes to "${tab.title}" before closing?`);
    if (shouldSave) {
      await saveFile();
    }
  }

  docxTabs.delete(tab.id);
  removeTab(tab.id);
  const tabs = getTabs();
  const activeId = getActiveId();
  const active = tabs.find((t) => t.id === activeId) ?? null;
  setEditorModel(active?.model ?? null);
}

export async function closeAllFiles(): Promise<void> {
  const dirty = getDirtyTabs();
  if (dirty.length > 0) {
    const shouldSave = confirm(`Save changes to ${dirty.length} file(s) before closing?`);
    if (shouldSave) {
      for (const tab of dirty) {
        if (tab.filePath) {
          if (isDocxTab(tab.id)) {
            await saveMarkdownAsDocx(tab.filePath, tab.model.getValue());
          } else {
            await writeTextFile(tab.filePath, tab.model.getValue());
          }
        }
      }
    }
  }
  docxTabs.clear();
  closeAll();
  setEditorModel(null);
}
