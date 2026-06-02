/**
 * File-based logger for production builds.
 * Logs are written to ~/Library/Logs/NeoPad/neopad.log
 * View with: tail -f ~/Library/Logs/NeoPad/neopad.log
 * Or open Console.app and search for "NeoPad"
 */
import { invoke } from '@tauri-apps/api/core';

let logBuffer: string[] = [];
let flushing = false;

function ts(): string {
  return new Date().toISOString();
}

function format(level: string, ...args: unknown[]): string {
  const msg = args.map(a =>
    typeof a === 'object' ? JSON.stringify(a) : String(a)
  ).join(' ');
  return `[${ts()}] [${level}] ${msg}`;
}

async function flush() {
  if (flushing || logBuffer.length === 0) return;
  flushing = true;
  const lines = logBuffer.splice(0);
  try {
    await invoke('append_log', { lines: lines.join('\n') + '\n' });
  } catch {
    // Fallback: console only
    lines.forEach(l => console.log(l));
  }
  flushing = false;
}

function enqueue(line: string) {
  console.log(line); // Always log to console too
  logBuffer.push(line);
  setTimeout(flush, 100);
}

export const log = {
  info:  (...args: unknown[]) => enqueue(format('INFO ', ...args)),
  warn:  (...args: unknown[]) => enqueue(format('WARN ', ...args)),
  error: (...args: unknown[]) => enqueue(format('ERROR', ...args)),
  debug: (...args: unknown[]) => enqueue(format('DEBUG', ...args)),
};
