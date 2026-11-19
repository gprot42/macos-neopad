import { invoke } from '@tauri-apps/api/core';
import { writeTextFile } from '@tauri-apps/plugin-fs';

/**
 * Text encodings. Each tab remembers the encoding its file was read in (see
 * `Tab.encoding` / `Tab.bom`) so it is saved back the same way; detection and
 * conversion happen in Rust (src-tauri/src/encoding.rs).
 */

export interface EncodingChoice {
  label: string;
  /** WHATWG encoding name, as the Rust side reports and accepts it. */
  encoding: string;
  bom: boolean;
}

export interface DecodedText {
  text: string;
  encoding: string;
  bom: boolean;
  /** Some bytes were invalid in this encoding and became U+FFFD. */
  lossy: boolean;
}

export const DEFAULT_ENCODING = 'UTF-8';

export const ENCODINGS: EncodingChoice[] = [
  { label: 'UTF-8', encoding: 'UTF-8', bom: false },
  { label: 'UTF-8 with BOM', encoding: 'UTF-8', bom: true },
  { label: 'UTF-16 LE', encoding: 'UTF-16LE', bom: true },
  { label: 'UTF-16 BE', encoding: 'UTF-16BE', bom: true },
  { label: 'Western (Windows-1252)', encoding: 'windows-1252', bom: false },
  { label: 'Western (ISO-8859-15)', encoding: 'ISO-8859-15', bom: false },
  { label: 'Western (Mac Roman)', encoding: 'macintosh', bom: false },
  { label: 'Central European (Windows-1250)', encoding: 'windows-1250', bom: false },
  { label: 'Central European (ISO-8859-2)', encoding: 'ISO-8859-2', bom: false },
  { label: 'Cyrillic (Windows-1251)', encoding: 'windows-1251', bom: false },
  { label: 'Cyrillic (KOI8-R)', encoding: 'KOI8-R', bom: false },
  { label: 'Greek (Windows-1253)', encoding: 'windows-1253', bom: false },
  { label: 'Turkish (Windows-1254)', encoding: 'windows-1254', bom: false },
  { label: 'Hebrew (Windows-1255)', encoding: 'windows-1255', bom: false },
  { label: 'Arabic (Windows-1256)', encoding: 'windows-1256', bom: false },
  { label: 'Japanese (Shift JIS)', encoding: 'Shift_JIS', bom: false },
  { label: 'Japanese (EUC-JP)', encoding: 'EUC-JP', bom: false },
  { label: 'Chinese Simplified (GBK)', encoding: 'GBK', bom: false },
  { label: 'Chinese Simplified (GB18030)', encoding: 'gb18030', bom: false },
  { label: 'Chinese Traditional (Big5)', encoding: 'Big5', bom: false },
  { label: 'Korean (EUC-KR)', encoding: 'EUC-KR', bom: false },
];

/** Short name for the status bar, e.g. `UTF-8`, `UTF-16 LE`, `windows-1252`. */
export function encodingLabel(encoding: string, bom: boolean): string {
  if (encoding === 'UTF-8') return bom ? 'UTF-8 with BOM' : 'UTF-8';
  if (encoding === 'UTF-16LE') return 'UTF-16 LE';
  if (encoding === 'UTF-16BE') return 'UTF-16 BE';
  return encoding;
}

/** Read a text file, detecting its encoding unless one is given. */
export function readText(path: string, encoding?: string): Promise<DecodedText> {
  return invoke<DecodedText>('read_text_file', { path, encoding: encoding ?? null });
}

/** Write a text file. Rejects if `text` cannot be represented in `encoding`. */
export async function writeText(path: string, text: string, encoding: string, bom: boolean): Promise<void> {
  if (encoding === DEFAULT_ENCODING && !bom) {
    await writeTextFile(path, text);
  } else {
    await invoke('write_text_file', { path, text, encoding, bom });
  }
}
