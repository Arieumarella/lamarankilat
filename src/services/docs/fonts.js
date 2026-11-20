import fs from 'node:fs';

const CANDIDATES = {
  regular: [
    '/usr/share/fonts/noto/NotoSans-Regular.ttf',
    '/usr/share/fonts/noto/NotoSans[wdth,wght].ttf',
    '/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf',
  ],
  bold: [
    '/usr/share/fonts/noto/NotoSans-Bold.ttf',
    '/usr/share/fonts/truetype/noto/NotoSans-Bold.ttf',
  ],
};

function firstExisting(list) {
  return list.find((p) => { try { return fs.existsSync(p); } catch { return false; } }) || null;
}

let cached = null;

export function resolveFonts() {
  if (cached) return cached;
  cached = {
    regular: firstExisting(CANDIDATES.regular),
    bold: firstExisting(CANDIDATES.bold),
  };
  return cached;
}

export const FONT_FAMILY = 'Noto Sans';
export const COLOR = {
  ink: '#111827',
  body: '#1f2937',
  muted: '#4b5563',
  line: '#d1d5db',
  brand: '#4338ca',
  accent: '#059669',
};
