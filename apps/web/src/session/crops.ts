import type { InkRegion } from '@chalkline/ink';
import type { InkColor } from '@chalkline/ir';

/**
 * Draws a region's strokes into a PNG, so a block that stays an image
 * shows the teacher's actual writing in the handout. Ink is drawn dark on
 * white whatever the board theme, so white chalk-style ink stays visible.
 */

const PAD = 16;
/** Longest side of the image, in pixels. */
const MAX_SIDE = 1600;

const INK: Record<InkColor, string> = {
  black: '#1d1d1d',
  blue: '#1f4fbf',
  red: '#c42b1c',
  green: '#1e7b34',
  orange: '#c45a00',
  purple: '#6b2fb3',
  brown: '#6d4c2f',
  white: '#1d1d1d',
};

export async function renderRegionPng(region: InkRegion): Promise<string | undefined> {
  if (typeof OffscreenCanvas === 'undefined') return undefined;
  const { x, y, w, h } = region.bbox;
  const scale = Math.min(2, MAX_SIDE / Math.max(w + 2 * PAD, h + 2 * PAD, 1));
  const canvas = new OffscreenCanvas(
    Math.max(1, Math.ceil((w + 2 * PAD) * scale)),
    Math.max(1, Math.ceil((h + 2 * PAD) * scale)),
  );
  const ctx = canvas.getContext('2d');
  if (!ctx) return undefined;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const stroke of region.strokes) {
    const [first, ...rest] = stroke.points;
    if (!first) continue;
    ctx.strokeStyle = INK[stroke.color];
    ctx.lineWidth = Math.max(1, stroke.width * scale);
    ctx.beginPath();
    ctx.moveTo((first.x - x + PAD) * scale, (first.y - y + PAD) * scale);
    // A single point still leaves a dot.
    if (rest.length === 0)
      ctx.lineTo((first.x - x + PAD) * scale + 0.1, (first.y - y + PAD) * scale);
    for (const p of rest) ctx.lineTo((p.x - x + PAD) * scale, (p.y - y + PAD) * scale);
    ctx.stroke();
  }
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  return base64(new Uint8Array(await blob.arrayBuffer()));
}

function base64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
