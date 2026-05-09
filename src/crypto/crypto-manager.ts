/**
 * Encryption utilities for Neo Edit encrypted files (.neo)
 *
 * Uses PBKDF2 for key derivation and AES-256-GCM for symmetric encryption,
 * all via the browser-native Web Crypto API (SubtleCrypto).
 */

export interface EncryptedPayload {
  /** Format version — always 1 */
  v: number;
  /** Base64-encoded 16-byte random salt for PBKDF2 */
  salt: string;
  /** Base64-encoded 12-byte random IV for AES-GCM */
  iv: string;
  /** Base64-encoded AES-GCM ciphertext */
  data: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toBase64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/** Creates a Uint8Array with a guaranteed plain ArrayBuffer (required by SubtleCrypto). */
function fromBase64(b64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(b64);
  const buf = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes as Uint8Array<ArrayBuffer>;
}

/** Fill a new ArrayBuffer-backed Uint8Array with cryptographically random bytes. */
function randomBytes(length: number): Uint8Array<ArrayBuffer> {
  const buf = new ArrayBuffer(length);
  const arr = new Uint8Array(buf) as Uint8Array<ArrayBuffer>;
  crypto.getRandomValues(arr);
  return arr;
}

/** Derive an AES-256-GCM CryptoKey from a password using PBKDF2-SHA256. */
async function deriveKey(password: string, salt: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations: 100_000,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Encrypt a UTF-8 plaintext string with the given password.
 * Returns a JSON string that can be written directly to a .neo file.
 */
export async function encryptText(text: string, password: string): Promise<string> {
  const enc = new TextEncoder();
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = await deriveKey(password, salt);

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    enc.encode(text),
  );

  const payload: EncryptedPayload = {
    v: 1,
    salt: toBase64(salt),
    iv: toBase64(iv),
    data: toBase64(ciphertext),
  };

  return JSON.stringify(payload);
}

/**
 * Decrypt a .neo JSON string with the given password.
 * Throws if the password is wrong or the payload is corrupt/invalid.
 */
export async function decryptText(encryptedJson: string, password: string): Promise<string> {
  let payload: EncryptedPayload;
  try {
    payload = JSON.parse(encryptedJson) as EncryptedPayload;
  } catch {
    throw new Error('Invalid encrypted file format');
  }

  if (payload.v !== 1) {
    throw new Error(`Unsupported encrypted format version: ${payload.v}`);
  }

  const salt = fromBase64(payload.salt);
  const iv = fromBase64(payload.iv);
  const data = fromBase64(payload.data);
  const key = await deriveKey(password, salt);

  let plaintext: ArrayBuffer;
  try {
    plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data);
  } catch {
    // AES-GCM authentication tag failure = wrong password or tampered data
    throw new Error('Wrong password or corrupted file');
  }

  return new TextDecoder().decode(plaintext);
}

/**
 * Returns true if the string looks like a valid Neo Edit encrypted payload.
 * Used to detect .neo files that are actually encrypted vs plain text.
 */
export function isEncryptedPayload(str: string): boolean {
  try {
    const obj = JSON.parse(str) as Record<string, unknown>;
    return (
      obj !== null &&
      typeof obj === 'object' &&
      obj.v === 1 &&
      typeof obj.salt === 'string' &&
      typeof obj.iv === 'string' &&
      typeof obj.data === 'string'
    );
  } catch {
    return false;
  }
}

/** Return true if the file extension is .neo */
export function isNeoFile(path: string): boolean {
  return path.toLowerCase().endsWith('.neo');
}
