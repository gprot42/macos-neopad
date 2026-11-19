// Colour helpers for plugin themes. Every colour a plugin supplies goes
// through parseColor() and comes back out of toHex(), so only validated hex
// ever reaches CSS custom properties, Monaco or xterm — a theme can't smuggle
// `url(...)` or other CSS into the app.

export interface Rgba {
  r: number; // 0–255
  g: number;
  b: number;
  a: number; // 0–1
}

/** Accepts #RGB, #RGBA, #RRGGBB and #RRGGBBAA, as VS Code themes do. */
export function parseColor(value: unknown): Rgba | null {
  if (typeof value !== 'string') return null;
  const m = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(value.trim());
  if (!m) return null;
  let hex = m[1];
  if (hex.length <= 4) hex = [...hex].map((c) => c + c).join('');
  const byte = (i: number) => parseInt(hex.slice(i, i + 2), 16);
  return { r: byte(0), g: byte(2), b: byte(4), a: hex.length === 8 ? byte(6) / 255 : 1 };
}

const hex2 = (n: number) => Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, '0');

/** #rrggbb, or #rrggbbaa when translucent. */
export function toHex(c: Rgba): string {
  const rgb = `#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}`;
  return c.a >= 1 ? rgb : rgb + hex2(c.a * 255);
}

/** Linear blend: t = 0 gives a, t = 1 gives b. */
export function mix(a: Rgba, b: Rgba, t: number): Rgba {
  return {
    r: a.r + (b.r - a.r) * t,
    g: a.g + (b.g - a.g) * t,
    b: a.b + (b.b - a.b) * t,
    a: a.a + (b.a - a.a) * t,
  };
}

/** Composites a translucent colour over an opaque background. */
export function flatten(c: Rgba, background: Rgba): Rgba {
  return { ...mix(background, { ...c, a: 1 }, c.a), a: 1 };
}

export function withAlpha(c: Rgba, a: number): Rgba {
  return { ...c, a };
}

/** Relative luminance (WCAG), 0 = black … 1 = white. */
export function luminance(c: Rgba): number {
  const ch = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch(c.r) + 0.7152 * ch(c.g) + 0.0722 * ch(c.b);
}
