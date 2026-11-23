// SPDX-License-Identifier: GPL-3.0-or-later
// Scene -> standalone SVG markup. Used for the screen and for SVG/PNG/PDF export, so all look identical.
import { DEFAULT_FONT_FAMILY, DEFAULT_FONT_SIZE } from '../layout/measure';
import type { Scene } from '../layout/layout';
import type { SpanClass } from '../layout/display';

export function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const n = (v: number) => (Math.round(v * 2) / 2).toString();

export type DiagramTheme = 'light' | 'dark';

export interface SvgOptions {
  /** Scale factor applied via width/height (viewBox stays in layout units). */
  scale?: number;
  /** Include an XML prolog (for downloads). */
  standalone?: boolean;
  title?: string;
  theme?: DiagramTheme;
}

export interface Palette {
  bg: string; stroke: string; text: string; muted: string; hatch: string;
  span: Record<SpanClass, string>;
}

/** Colours of the desktop highlighting (Element.E_HL_*), and a dark counterpart. */
export const PALETTES: Record<DiagramTheme, Palette> = {
  light: {
    bg: '#ffffff', stroke: '#000000', text: '#000000', muted: '#666666', hatch: '#7a7a7a',
    span: { var: '#000099', op: '#990000', str: '#770077', io: '#007700', jump: '#ff5511', muted: '#666666' },
  },
  dark: {
    bg: '#1d2023', stroke: '#c8ccd0', text: '#e8eaed', muted: '#9aa0a6', hatch: '#8a9096',
    span: { var: '#8ab4ff', op: '#ff8a80', str: '#e2a6ff', io: '#81d987', jump: '#ffab70', muted: '#9aa0a6' },
  },
};

/** Map a fill colour for the dark theme: white becomes the dark surface, colours get a dark tint. */
export function themedFill(fill: string | undefined, theme: DiagramTheme): string | undefined {
  if (!fill || theme === 'light' || fill === 'none' || fill.startsWith('url(')) return fill;
  const m = /^#([0-9a-f]{6})$/i.exec(fill);
  if (!m) return fill;
  const v = m[1].toLowerCase();
  if (v === 'ffffff') return PALETTES.dark.bg;
  const bg = [0x1d, 0x20, 0x23];
  const rgb = [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16));
  const mix = rgb.map((c, i) => Math.round(c * 0.38 + bg[i] * 0.62));
  return '#' + mix.map((c) => c.toString(16).padStart(2, '0')).join('');
}

export function sceneToSvg(scene: Scene, opts: SvgOptions = {}): string {
  const scale = opts.scale && opts.scale > 0 ? opts.scale : 1;
  /** zoomed out: thin things are widened so they keep about one device pixel */
  const minPx = (w: number) => (scale < 1 ? Math.max(w, 1.5 / scale) : w);
  const theme = opts.theme ?? 'light';
  const pal = PALETTES[theme];
  const W = scene.width;
  const H = scene.height;
  const out: string[] = [];
  if (opts.standalone) out.push('<?xml version="1.0" encoding="UTF-8"?>');
  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${n(W * scale)}" height="${n(H * scale)}" viewBox="0 0 ${n(W)} ${n(H)}"${scale < 1 ? ' overflow="visible"' : ''}` +
    ` font-family="${esc(scene.font?.family ?? DEFAULT_FONT_FAMILY)}" font-size="${scene.font?.size ?? DEFAULT_FONT_SIZE}">`,
  );
  if (opts.title) out.push(`<title>${esc(opts.title)}</title>`);
  out.push(
    '<defs><pattern id="sw-hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">' +
    `<line x1="0" y1="0" x2="0" y2="8" stroke="${pal.hatch}" stroke-width="${n(minPx(1.5))}"/></pattern></defs>`,
  );
  // zoomed out (scale < 1) the lines keep at least one device pixel, like the desktop's 1 px
  // lines, instead of shrinking below a pixel and vanishing under crispEdges
  const strokeW = scale < 1 ? (1 / scale).toFixed(2) : '1';
  // crisp edges only for axis-parallel shapes: IF/CASE diagonals, bevels and rounded corners are anti-aliased
  const crisp = ' shape-rendering="crispEdges"';
  out.push(`<g stroke="${pal.stroke}" stroke-width="${strokeW}" fill="none">`);
  for (const it of scene.items) {
    switch (it.t) {
      case 'rect': {
        const fill = it.fill === '#c0c0c0' && it.stroke === false && theme === 'dark' ? '#5f6368' : themedFill(it.fill, theme);
        out.push(
          `<rect x="${n(it.x + 0.5)}" y="${n(it.y + 0.5)}" width="${n(it.mark ? minPx(it.w) : it.w)}" height="${n(it.h)}"` +
          (it.rx ? ` rx="${it.rx}"` : crisp) +
          ` fill="${fill ?? 'none'}"${it.stroke === false ? ' stroke="none"' : ''}/>`,
        );
        break;
      }
      case 'line':
        out.push(`<line x1="${n(it.x1 + 0.5)}" y1="${n(it.y1 + 0.5)}" x2="${n(it.x2 + 0.5)}" y2="${n(it.y2 + 0.5)}"${it.x1 === it.x2 || it.y1 === it.y2 ? crisp : ''}${it.dashed ? ' stroke-dasharray="4 3"' : ''}/>`);
        break;
      case 'poly': {
        const pts = it.points.map(([x, y]) => `${n(x + 0.5)},${n(y + 0.5)}`).join(' ');
        out.push(
          it.closed
            ? `<polygon points="${pts}" fill="${themedFill(it.fill, theme) ?? 'none'}"${it.stroke === false ? ' stroke="none"' : ''}/>`
            : `<polyline points="${pts}"/>`,
        );
        break;
      }
      case 'hatch':
        out.push(`<rect x="${n(it.x)}" y="${n(it.y)}" width="${n(it.w)}" height="${n(it.h)}" fill="url(#sw-hatch)" fill-opacity="0.45" stroke="none"/>`);
        break;
      case 'text': {
        const body = it.spans && it.spans.some((s) => s.c)
          ? it.spans.map((s) => (s.c ? `<tspan fill="${pal.span[s.c]}">${esc(s.s)}</tspan>` : esc(s.s))).join('')
          : esc(it.s);
        out.push(
          `<text x="${n(it.x)}" y="${n(it.y)}" stroke="none" fill="${it.muted ? pal.muted : pal.text}"` +
          (it.anchor && it.anchor !== 'start' ? ` text-anchor="${it.anchor}"` : '') +
          (it.bold ? ' font-weight="bold"' : '') +
          ` xml:space="preserve" style="white-space:pre">${body}</text>`,
        );
        break;
      }
    }
  }
  out.push('</g></svg>');
  return out.join('');
}
