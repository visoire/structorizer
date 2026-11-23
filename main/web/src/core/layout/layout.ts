// SPDX-License-Identifier: GPL-3.0-or-later
// Nassi-Shneiderman layout (docs/layout-spec.md). Pure: diagram in, drawing scene out.
// Shapes and proportions follow lu.fisch.structorizer.elements.*.prepareDraw()/draw().
import type { Diagram, Element, Hex, SeqRef } from '../model/types';
import { sameRef, slotsOf } from '../model/tree';
import { FONT_FAMILY, FONT_SIZE, HALF, LINE_H, P, ROOT_CORNER, baseline, type MeasureFn } from './measure';
import { displaySpans, displayText, type Span } from './display';
import { diagramVariables } from '../lang/analyze';

// ---------------------------------------------------------------- scene types

export interface Rect { x: number; y: number; w: number; h: number }

export type Item =
  | ({ t: 'rect'; fill?: string; stroke?: boolean; rx?: number; /** comment mark: stays visible when zoomed out */ mark?: boolean } & Rect)
  | { t: 'line'; x1: number; y1: number; x2: number; y2: number; dashed?: boolean }
  | { t: 'poly'; points: [number, number][]; fill?: string; closed?: boolean; stroke?: boolean }
  | { t: 'text'; x: number; y: number; s: string; anchor?: 'start' | 'middle' | 'end'; bold?: boolean; muted?: boolean; spans?: Span[] }
  | ({ t: 'hatch' } & Rect);

export type Hit =
  | ({
    t: 'el'; id: string; kind: Element['kind']; head: Rect; comment: string[]; branchHeads?: [number, number][][];
    /** sequence and index the element sits at (drag and drop targets) */
    seq?: SeqRef; index?: number;
  } & Rect)
  | ({ t: 'seq'; ref: SeqRef } & Rect)
  | ({ t: 'root' } & Rect);

/** Insertion gap: inserting at `index` of `ref`, drawn as a horizontal line at y. */
export interface Gap { ref: SeqRef; index: number; x: number; y: number; w: number }

export interface Scene {
  width: number;
  height: number;
  items: Item[];
  hits: Hit[];
  gaps: Gap[];
  /** Font the scene was measured with (screen and exports use the same). */
  font: { family: string; size: number };
}

export interface LayoutOptions {
  /** Desktop "Show operators in C style?" */
  cOperators?: boolean;
  /** Desktop "Highlight variables?" */
  highlight?: boolean;
  /** Desktop "Show comments?" (comment marks). Default true. */
  showComments?: boolean;
  /** Desktop "Switch text/comments?" (comments) and "Comments plus texts?" (both). */
  textMode?: 'text' | 'comments' | 'both';
  /** Labels of the IF branches (desktop preAltT / preAltF). */
  trueLabel?: string;
  falseLabel?: string;
  tryLabel?: string;
  catchLabel?: string;
  finallyLabel?: string;
  includeLabel?: string;
}

interface Size { w: number; h: number }

const COLLAPSED_FILL = 'd3d3d3';
/** Horizontal distance of CASE selector labels from their column border. */
const LABEL_INSET = HALF / 2;
const EMPTY_SIGN = '∅';

const fillOf = (c: Hex) => '#' + (/^[0-9a-f]{6}$/i.test(c) ? c : 'ffffff');

// ---------------------------------------------------------------- engine

export function createLayoutEngine(measure: MeasureFn, opts: LayoutOptions = {}) {
  const T = opts.trueLabel ?? 'T';
  const F = opts.falseLabel ?? 'F';
  const TRY = opts.tryLabel ?? 'try';
  const CATCH = opts.catchLabel ?? 'catch';
  const FINALLY = opts.finallyLabel ?? 'finally';
  const INCLUDE = opts.includeLabel ?? 'Included diagrams:';

  const elCache = new WeakMap<Element, Size>();
  const seqCache = new WeakMap<Element[], Size>();

  const dopt = { cOperators: !!opts.cOperators };
  const disp = (l: string) => displayText(l, dopt);
  const mode = opts.textMode ?? 'text';
  /** Comment lines shown in "comments plus texts" mode, per element (muted when drawn). */
  const commentLines = (el: Element) => cleanComment(el.comment);
  /** The lines an instruction-like box or loop header shows in the current text mode. */
  const shown = (el: Element): string[] => {
    const c = commentLines(el);
    if (mode === 'comments' && c.length > 0) return c;
    if (mode === 'both' && c.length > 0 && el.kind !== 'alternative') return [...c, ...el.text];
    return el.text;
  };
  const mutedCount = (el: Element) => (mode === 'both' && el.kind !== 'alternative' ? commentLines(el).length : 0);
  /**
   * Leading lines of shown(el) that are comment: drawn and measured as they are, without C operator
   * replacement and variable highlighting (those are for code, not for comments).
   */
  const plainCount = (el: Element) => (mode === 'comments' ? (commentLines(el).length > 0 ? Infinity : 0) : mutedCount(el));
  let curVars: ReadonlySet<string> = new Set();
  let curKeywords: Diagram['keywords'] | undefined;

  const textW = (lines: string[], bold = false, plain = 0) =>
    lines.reduce((m, l, i) => Math.max(m, measure(i < plain ? l : disp(l), bold)), 0);

  const isCollapsed = (el: Element) => !!el.collapsed && slotsOf(el).length > 0;

  const collapsedText = (el: Element) => {
    const first = el.kind === 'parallel' ? 'parallel' : (el.text[0] ?? '');
    return [first, '...'];
  };

  /** Lines shown for an instruction-like box (at least one line). */
  const boxLines = (lines: string[]) => (lines.length === 0 ? [''] : lines);

  const instrSize = (lines: string[], extraW = 0, plain = 0): Size => {
    const ls = boxLines(lines);
    return { w: textW(ls, false, plain) + P + extraW, h: ls.length * LINE_H + P };
  };
  const shownSize = (el: Element, extraW = 0) => instrSize(shown(el), extraW, plainCount(el));

  // ---- measuring (bottom-up, memoised by object identity)

  function measureSeq(seq: Element[]): Size {
    const hit = seqCache.get(seq);
    if (hit) return hit;
    let s: Size;
    if (seq.length === 0) s = { w: 2 * P, h: LINE_H + P };
    else {
      s = { w: 0, h: 0 };
      for (const el of seq) {
        const c = measureEl(el);
        s.w = Math.max(s.w, c.w);
        s.h += c.h;
      }
    }
    seqCache.set(seq, s);
    return s;
  }

  function altMetrics(el: Extract<Element, { kind: 'alternative' }>) {
    const lines = boxLines(shown(el));
    const n = lines.length;
    const t = { ...measureSeq(el.thenBranch) };
    const f = { ...measureSeq(el.elseBranch) };
    const lT = measure(T) * 1.5 + P;
    const lF = measure(F) * 1.5 + P;
    t.w = Math.max(t.w, lT);
    f.w = Math.max(f.w, lF);
    const plain = plainCount(el) > 0;
    const headerW = altHeaderWidth(lines.map((l) => measure(plain ? l : disp(l))), t.w);
    const H = n * LINE_H + 2 * P - 1;
    return { lines, plain, t, f, H, w: Math.ceil(Math.max(headerW, t.w + f.w)), h: H + Math.max(t.h, f.h) };
  }

  function caseMetrics(el: Extract<Element, { kind: 'case' }>) {
    const last = el.text[el.text.length - 1] ?? '';
    const hideDefault = last.trim() === '%';
    const visible = hideDefault ? el.branches.length - 1 : el.branches.length;
    const discr = boxLines([el.text[0] ?? '']);
    const selectors = el.text.slice(1, 1 + visible);
    const labelW = selectors.map((s) => measure(disp(s)));
    const cols = el.branches.slice(0, visible).map((b, i) => {
      const s = measureSeq(b);
      return { w: Math.max(s.w, labelW[i] + P), h: s.h };
    });
    const H = (discr.length + 1) * LINE_H + P;
    const k = cols.length;
    // The diagonal runs from the top-left corner down to the start of the last column and
    // rises again to the top-right corner. Selector labels sit in the bottom row and must
    // stay below it: labels left of the tip are left-aligned, the last one right-aligned.
    const r = (LINE_H + 2) / H;
    if (k > 1) {
      for (let j = 0; j < k - 1; j++) {
        const colStart = cols.slice(0, j).reduce((a, c) => a + c.w, 0);
        const tipOff = cols.slice(0, k - 1).reduce((a, c) => a + c.w, 0);
        const endOff = colStart + LABEL_INSET + labelW[j];
        const need = endOff / (1 - r) - tipOff;
        if (need > 0) cols[j].w += Math.ceil(need);
      }
      cols[k - 1].w = Math.max(cols[k - 1].w, Math.ceil((labelW[k - 1] + LABEL_INSET) / (1 - r)));
    }
    const sum = cols.reduce((a, c) => a + c.w, 0);
    const w = Math.ceil(Math.max(sum, textW(discr) + 2 * P, 2 * P));
    const h = H + cols.reduce((m, c) => Math.max(m, c.h), 0);
    return { discr, selectors, cols, H, w, h };
  }

  function tryMetrics(el: Extract<Element, { kind: 'try' }>) {
    const showFinally = el.finallyBody.length > 0;
    const rTry = measureSeq(el.tryBody);
    const rCatch = measureSeq(el.catchBody);
    const rFin = measureSeq(el.finallyBody);
    const topH = LINE_H + P;
    const catchLine = `${CATCH} ${el.text[0] ?? ''}`.trim();
    const widths = [
      measure(TRY) + P,
      rTry.w + 2 * P,
      HALF + measure(disp(catchLine)) + P,
      rCatch.w + 3 * P,
    ];
    if (showFinally) widths.push(HALF + measure(FINALLY) + P, rFin.w + 2 * P);
    const w = Math.max(...widths);
    const catchLabelH = P + LINE_H;
    let h = topH + rTry.h + catchLabelH + rCatch.h + P;
    if (showFinally) h += LINE_H + rFin.h + P;
    return { showFinally, rTry, rCatch, rFin, topH, catchLabelH, catchLine, w, h };
  }

  function measureEl(el: Element): Size {
    const hit = elCache.get(el);
    if (hit) return hit;
    let s: Size;
    if (isCollapsed(el)) s = instrSize(collapsedText(el));
    else switch (el.kind) {
      case 'instruction': s = shownSize(el); break;
      case 'call': s = shownSize(el, P); break;
      case 'jump': s = shownSize(el, HALF); break;
      case 'while':
      case 'for': {
        const hd = shownSize(el);
        const b = measureSeq(el.body);
        s = { w: Math.max(hd.w, b.w + P), h: hd.h + b.h };
        break;
      }
      case 'repeat': {
        const ft = shownSize(el);
        const b = measureSeq(el.body);
        s = { w: Math.max(ft.w, b.w + P), h: ft.h + b.h };
        break;
      }
      case 'forever': {
        const b = measureSeq(el.body);
        s = { w: Math.max(2 * P, b.w + P), h: LINE_H + P + b.h + P };
        break;
      }
      case 'alternative': { const m = altMetrics(el); s = { w: m.w, h: m.h }; break; }
      case 'case': { const m = caseMetrics(el); s = { w: m.w, h: m.h }; break; }
      case 'parallel': {
        const bs = el.branches.map(measureSeq);
        s = {
          w: Math.max(3 * HALF, bs.reduce((a, b) => a + b.w, 0)) + 1,
          h: 2 * P + bs.reduce((m, b) => Math.max(m, b.h), 0),
        };
        break;
      }
      case 'try': { const m = tryMetrics(el); s = { w: m.w, h: m.h }; break; }
    }
    elCache.set(el, s);
    return s;
  }

  // ---- placing (top-down, emits items)

  function layout(d: Diagram): Scene {
    curVars = opts.highlight ? diagramVariables(d) : new Set();
    curKeywords = d.keywords;
    const items: Item[] = [];
    const hits: Hit[] = [];
    const gaps: Gap[] = [];

    const text = (x: number, top: number, s: string, extra: Partial<Extract<Item, { t: 'text' }>> = {}) =>
      items.push({ t: 'text', x, y: baseline(top), s, ...extra });
    const rect = (r: Rect, fill?: string, stroke = true) => items.push({ t: 'rect', ...r, fill, stroke });
    const line = (x1: number, y1: number, x2: number, y2: number) => items.push({ t: 'line', x1, y1, x2, y2 });

    const spansOf = (l: string) => (opts.highlight ? displaySpans(l, { ...dopt, highlight: true, vars: curVars, keywords: curKeywords }) : undefined);
    const textLines = (lines: string[], x: number, y: number, muted = 0, plain = muted) =>
      boxLines(lines).forEach((l, i) => {
        if (i < muted) text(x, y + HALF + i * LINE_H, l, { muted: true });
        else if (i < plain) text(x, y + HALF + i * LINE_H, l);
        else text(x, y + HALF + i * LINE_H, disp(l), { spans: spansOf(l) });
      });

    function placeSeq(seq: Element[], ref: SeqRef, x: number, y: number, w: number, h: number) {
      if (seq.length === 0) {
        rect({ x, y, w, h }, '#ffffff');
        text(x + w / 2, y + HALF, EMPTY_SIGN, { anchor: 'middle', muted: true });
        hits.push({ t: 'seq', ref, x, y, w, h });
        gaps.push({ ref, index: 0, x, y: y + h / 2, w });
        return;
      }
      let cy = y;
      seq.forEach((el, i) => {
        const s = measureEl(el);
        const eh = i === seq.length - 1 ? y + h - cy : s.h;
        gaps.push({ ref, index: i, x, y: cy, w });
        const hi = hits.length;
        placeEl(el, x, cy, w, eh);
        const own = hits[hi];
        if (own?.t === 'el') { own.seq = ref; own.index = i; }
        cy += eh;
      });
      gaps.push({ ref, index: seq.length, x, y: y + h, w });
    }

    function placeEl(el: Element, x: number, y: number, w: number, h: number) {
      const fill = fillOf(el.color);
      const box = { x, y, w, h };
      const hitIndex = hits.length;
      hits.push({ t: 'el', id: el.id, kind: el.kind, x, y, w, h, head: box, comment: el.comment });
      const setHead = (head: Rect) => {
        const hHit = hits[hitIndex];
        if (hHit.t === 'el') hHit.head = head;
      };

      if (isCollapsed(el)) {
        rect(box, '#' + COLLAPSED_FILL);
        textLines(collapsedText(el), x + HALF, y);
      } else switch (el.kind) {
        case 'instruction':
          rect(box, fill);
          textLines(shown(el), x + HALF, y, mutedCount(el), plainCount(el));
          break;
        case 'call':
          rect(box, fill);
          line(x + HALF, y, x + HALF, y + h);
          line(x + w - HALF, y, x + w - HALF, y + h);
          textLines(shown(el), x + P, y, mutedCount(el), plainCount(el));
          break;
        case 'jump':
          rect(box, fill);
          items.push({ t: 'poly', points: [[x + HALF, y], [x, y + h / 2], [x + HALF, y + h]] });
          textLines(shown(el), x + P, y, mutedCount(el), plainCount(el));
          break;
        case 'while':
        case 'for': {
          const hh = shownSize(el).h;
          rect(box, fill);
          textLines(shown(el), x + HALF, y, mutedCount(el), plainCount(el));
          setHead({ x, y, w, h: hh });
          placeSeq(el.body, { owner: el.id, slot: 'body' }, x + P, y + hh, w - P, h - hh);
          break;
        }
        case 'repeat': {
          const fh = shownSize(el).h;
          rect(box, fill);
          textLines(shown(el), x + HALF, y + h - fh, mutedCount(el), plainCount(el));
          setHead({ x, y: y + h - fh, w, h: fh });
          placeSeq(el.body, { owner: el.id, slot: 'body' }, x + P, y, w - P, h - fh);
          break;
        }
        case 'forever': {
          const hh = LINE_H + P;
          rect(box, fill);
          setHead({ x, y, w, h: hh });
          placeSeq(el.body, { owner: el.id, slot: 'body' }, x + P, y + hh, w - P, h - hh - P);
          break;
        }
        case 'alternative': {
          const m = altMetrics(el);
          const tW = m.t.w;
          rect(box, fill);
          setHead({ x, y, w, h: m.H });
          const tri0: [number, number][] = [[x, y], [x + tW, y + m.H], [x, y + m.H]];
          const tri1: [number, number][] = [[x + tW, y + m.H], [x + w, y], [x + w, y + m.H]];
          (hits[hitIndex] as Extract<Hit, { t: 'el' }>).branchHeads = [tri0, tri1];
          const c0 = el.branchHeadColors?.[0];
          const c1 = el.branchHeadColors?.[1];
          if (c0 && /^[0-9a-f]{6}$/i.test(c0)) items.push({ t: 'poly', closed: true, stroke: false, fill: fillOf(c0), points: tri0 });
          if (c1 && /^[0-9a-f]{6}$/i.test(c1)) items.push({ t: 'poly', closed: true, stroke: false, fill: fillOf(c1), points: tri1 });
          line(x, y, x + tW, y + m.H);
          line(x + tW, y + m.H, x + w, y);
          // condition text: each line centred between both diagonals at its height (Alternative.draw)
          const n = m.lines.length;
          const cy = m.H + 1;
          const coeffLeft = cy / (0 - tW);
          const coeffRight = cy / Math.max(1, w - tW);
          m.lines.forEach((l, i) => {
            const s = m.plain ? l : disp(l);
            const tw = measure(s);
            const by = 2 * P - P / 3 + (n - i - 1) * LINE_H;
            const leftSide = by / coeffLeft + tW;
            const bx = by / coeffRight + tW;
            const tx = x + HALF + leftSide + (bx - leftSide - tw) / 2;
            text(Math.min(Math.max(tx, x + HALF), x + w - HALF - tw), y + P / 3 + i * LINE_H, s, m.plain ? {} : { spans: spansOf(l) });
          });
          const labelTop = y + m.H - LINE_H - 2;
          text(x + HALF / 2, labelTop, T);
          text(x + w - HALF / 2, labelTop, F, { anchor: 'end' });
          const bh = h - m.H;
          placeSeq(el.thenBranch, { owner: el.id, slot: 'then' }, x, y + m.H, tW, bh);
          placeSeq(el.elseBranch, { owner: el.id, slot: 'else' }, x + tW, y + m.H, w - tW, bh);
          break;
        }
        case 'case': {
          const m = caseMetrics(el);
          rect(box, fill);
          setHead({ x, y, w, h: m.H });
          const k = m.cols.length;
          const widths = m.cols.map((c) => c.w);
          widths[k - 1] += w - widths.reduce((a, b) => a + b, 0);
          const lastStart = widths.slice(0, k - 1).reduce((a, b) => a + b, 0);
          const tipX = k > 1 ? x + lastStart : x + w / 2;
          const dyAt = (px: number) => k <= 1
            ? 0
            : px <= tipX
              ? (m.H * (px - x)) / Math.max(1, tipX - x)
              : m.H - (m.H * (px - tipX)) / Math.max(1, x + w - tipX);
          const bHeads: [number, number][][] = [];
          let bx = x;
          for (let i = 0; i < k; i++) {
            const rx = bx + widths[i];
            const poly: [number, number][] = [[bx, y + m.H], [bx, y + dyAt(bx)], [rx, y + dyAt(rx)], [rx, y + m.H]];
            bHeads.push(poly);
            const bc = el.branchHeadColors?.[i];
            if (bc && /^[0-9a-f]{6}$/i.test(bc)) items.push({ t: 'poly', closed: true, stroke: false, fill: fillOf(bc), points: poly });
            bx = rx;
          }
          (hits[hitIndex] as Extract<Hit, { t: 'el' }>).branchHeads = bHeads;
          line(x, y, tipX, y + m.H);
          line(tipX, y + m.H, x + w, y);
          // column separators inside the header, from the diagonal down to the selector row bottom
          let cx = x;
          for (let i = 0; i < k; i++) {
            if (i > 0 && k > 1) {
              const dy = dyAt(cx);
              line(cx, y + dy, cx, y + m.H);
            }
            const label = disp(m.selectors[i] ?? '');
            const labelTop = y + m.H - LINE_H - 2;
            if (k === 1) text(cx + widths[i] / 2, labelTop, label, { anchor: 'middle' });
            else if (i < k - 1) text(cx + LABEL_INSET, labelTop, label);
            else text(cx + widths[i] - LABEL_INSET, labelTop, label, { anchor: 'end' });
            cx += widths[i];
          }
          m.discr.forEach((l, i) => {
            const s = disp(l);
            const tw = measure(s);
            const tx = Math.min(Math.max(tipX - tw / 2, x + HALF), x + w - HALF - tw);
            text(tx, y + HALF / 2 + i * LINE_H, s, { spans: spansOf(l) });
          });
          cx = x;
          for (let i = 0; i < k; i++) {
            placeSeq(el.branches[i], { owner: el.id, slot: 'branch', index: i }, cx, y + m.H, widths[i], h - m.H);
            cx += widths[i];
          }
          break;
        }
        case 'parallel': {
          rect(box, fill);
          setHead({ x, y, w, h: P });
          line(x, y + P, x + w, y + P);
          line(x, y + h - P, x + w, y + h - P);
          line(x, y + P, x + P, y);
          line(x + w - P, y, x + w, y + P);
          line(x, y + h - P, x + P, y + h);
          line(x + w - P, y + h, x + w, y + h - P);
          const widths = el.branches.map((b) => measureSeq(b).w);
          const n = widths.length;
          widths[n - 1] += w - widths.reduce((a, b) => a + b, 0);
          let cx = x;
          el.branches.forEach((b, i) => {
            placeSeq(b, { owner: el.id, slot: 'branch', index: i }, cx, y + P, widths[i], h - 2 * P);
            cx += widths[i];
          });
          break;
        }
        case 'try': {
          const m = tryMetrics(el);
          rect(box, fill);
          setHead({ x, y, w, h: m.topH });
          text(x + HALF, y + HALF, TRY, { bold: true });
          let cy = y + m.topH;
          placeSeq(el.tryBody, { owner: el.id, slot: 'try' }, x + P, cy, w - 2 * P, m.rTry.h);
          cy += m.rTry.h;
          text(x + HALF, cy + HALF, disp(m.catchLine), { bold: true });
          cy += m.catchLabelH;
          placeSeq(el.catchBody, { owner: el.id, slot: 'catch' }, x + 2 * P, cy, w - 3 * P, m.rCatch.h);
          cy += m.rCatch.h + P;
          if (m.showFinally) {
            text(x + HALF, cy, FINALLY, { bold: true });
            cy += LINE_H;
            placeSeq(el.finallyBody, { owner: el.id, slot: 'finally' }, x + P, cy, w - 2 * P, m.rFin.h);
          }
          break;
        }
      }
      if (opts.showComments !== false && el.comment.some((c) => c.trim() !== '')) {
        // comment mark: light grey bar at the left edge of the element head (Element.drawCommentMark)
        const hd = (hits[hitIndex] as Extract<Hit, { t: 'el' }>).head;
        const markColor = el.color.toLowerCase() === 'c0c0c0' ? '#ffffff' : '#c0c0c0';
        items.push({ t: 'rect', x: hd.x + 2, y: hd.y + 2, w: 2, h: Math.max(2, hd.h - 4), fill: markColor, stroke: false, mark: true });
      }
      if (el.disabled) items.push({ t: 'hatch', ...box });
    }

    // ---- root frame
    // the root follows the text mode like its elements (desktop Root.prepareDraw/draw, enh. #128):
    // "switch text/comments" shows the comment as title, "comments plus texts" draws it above
    const rootComment = cleanComment(d.comment);
    const titleIsComment = mode === 'comments' && rootComment.length > 0;
    const title = boxLines(titleIsComment ? rootComment : d.text);
    const boxed = d.boxed;
    const pad = boxed ? P : 0;
    const commPad = boxed ? P : HALF;
    const commH = mode === 'both' && rootComment.length > 0 ? rootComment.length * LINE_H + commPad : 0;
    const inclH = d.includeList.length > 0 ? LINE_H + P : 0;
    const inclText = `${INCLUDE} ${d.includeList.join(', ')}`;
    const titleH = title.length * LINE_H + (boxed ? 2 * P : P);
    const body = measureSeq(d.children);
    const minW = Math.max(
      textW(title, true, titleIsComment ? Infinity : 0) + 2 * (boxed ? P : HALF),
      commH ? textW(rootComment, false, Infinity) + 2 * commPad : 0,
      inclH ? measure(inclText) + 2 * P + (boxed ? 2 * P : 0) : 0,
      body.w + 2 * pad,
    );
    const W = Math.ceil(minW);
    const bottomPad = boxed ? P : d.diagramType === 'program' ? 0 : HALF;
    const H = commH + inclH + titleH + body.h + bottomPad;

    const frameFill = fillOf(d.color);
    // bevel of an includable like Root.draw: R_CORNER when boxed, E_PADDING/2 otherwise
    const bevel = boxed ? ROOT_CORNER : HALF;
    if (d.diagramType === 'sub') items.push({ t: 'rect', x: 0, y: 0, w: W, h: H, fill: frameFill, stroke: true, rx: ROOT_CORNER });
    else if (d.diagramType === 'includable') {
      const b = bevel;
      items.push({ t: 'poly', closed: true, fill: frameFill, points: [[b, 0], [W, 0], [W, H - b], [W - b, H], [0, H], [0, b]] });
    } else rect({ x: 0, y: 0, w: W, h: H }, frameFill);
    hits.push({ t: 'root', x: 0, y: 0, w: W, h: H });
    if (opts.showComments !== false && rootComment.length > 0) {
      // comment mark of the frame (Root.draw + Element.drawCommentMark); the elements drawn later cover
      // it below the title, so it shows next to the title like on the desktop
      const top = d.diagramType === 'sub' ? HALF : d.diagramType === 'includable' ? bevel : 0;
      const bottom = d.diagramType === 'sub' ? H - HALF : H;
      const markColor = d.color.toLowerCase() === 'c0c0c0' ? '#ffffff' : '#c0c0c0';
      items.push({ t: 'rect', x: 2, y: top + 2, w: 2, h: Math.max(2, bottom - top - 4), fill: markColor, stroke: false, mark: true });
    }

    if (commH) rootComment.forEach((l, i) => text(commPad, commPad + i * LINE_H, l, { muted: true }));
    if (inclH) {
      const bx = pad, by = commH + (boxed ? HALF : 0), bw = W - 2 * pad, bh = inclH - (boxed ? HALF : 0);
      const b = HALF;
      items.push({ t: 'poly', closed: true, points: [[bx + b, by], [bx + bw, by], [bx + bw, by + bh - b], [bx + bw - b, by + bh], [bx, by + bh], [bx, by + b]] });
      text(bx + HALF, by + (bh - LINE_H) / 2, inclText, { muted: true });
    }
    title.forEach((l, i) => text(boxed ? P : HALF, commH + inclH + (boxed ? P : HALF) + i * LINE_H, titleIsComment ? l : disp(l), { bold: true }));
    placeSeq(d.children, { owner: 'root' }, pad, commH + inclH + titleH, W - 2 * pad, body.h);

    return { width: W + 1, height: H + 1, items, hits, gaps, font: { family: FONT_FAMILY, size: FONT_SIZE } };
  }

  return { layout, measureEl, measureSeq };
}

/**
 * Comment lines worth showing: nothing when every line is blank (a comment of ['', ''] must not
 * replace a title or reserve space), otherwise without leading and trailing blank lines.
 */
export function cleanComment(lines: string[]): string[] {
  let a = 0;
  let b = lines.length;
  while (a < b && lines[a].trim() === '') a++;
  while (b > a && lines[b - 1].trim() === '') b--;
  return lines.slice(a, b);
}

/** Port of Alternative.prepareDraw header width computation (docs/layout-spec.md). */
export function altHeaderWidth(lineWidths: number[], tW: number): number {
  const n = lineWidths.length;
  const cy = n * LINE_H + 2 * P;
  const ax = tW;
  const coeffLeft = cy / (0 - ax);
  let lowest = Infinity;
  for (let i = 0; i < n; i++) {
    const by = 2 * P - P / 3 + (n - i - 1) * LINE_H;
    const leftSide = by / coeffLeft + ax;
    const bx = lineWidths[i] + P + leftSide;
    const coeff = by / (bx - ax);
    if (coeff > 0 && coeff < lowest) lowest = coeff;
  }
  if (lowest === Infinity) return 2 * P;
  return Math.round(cy / lowest + ax);
}

// ---------------------------------------------------------------- hit testing

/** Deepest hit at a point (hits are emitted parent first). */
export function hitTest(scene: Scene, px: number, py: number): Hit | null {
  for (let i = scene.hits.length - 1; i >= 0; i--) {
    const h = scene.hits[i];
    if (px >= h.x && px <= h.x + h.w && py >= h.y && py <= h.y + h.h) return h;
  }
  return null;
}

/** Point-in-polygon check for branch header triangles/trapezoids (P1-29). */
export function pointInPoly(px: number, py: number, pts: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/** Index of the IF/CASE branch header triangle/trapezoid under `(px, py)`, or -1. */
export function hitBranchHead(hit: Hit | null, px: number, py: number): number {
  if (!hit || hit.t !== 'el' || !hit.branchHeads) return -1;
  for (let i = 0; i < hit.branchHeads.length; i++) {
    if (pointInPoly(px, py, hit.branchHeads[i])) return i;
  }
  return -1;
}

/**
 * Drop target for drag and drop, based on the element under the pointer (not only on the thin
 * gap lines): the upper half of an element inserts before it, the lower half after it. For
 * structured elements the header decides (upper half of the header: before, lower half: after),
 * so the big body of a loop or IF is not a dead zone. Empty branches take the element itself;
 * the diagram title inserts at the top, below the diagram at the end.
 */
export function dropGap(scene: Scene, px: number, py: number): Gap | null {
  const gapAt = (ref: SeqRef, index: number) =>
    scene.gaps.find((g) => g.index === index && sameRef(g.ref, ref)) ?? null;
  const rootGaps = scene.gaps.filter((g) => g.ref.owner === 'root');
  const first = rootGaps[0] ?? null;
  const last = rootGaps[rootGaps.length - 1] ?? null;
  const hit = hitTest(scene, px, py);
  if (!hit) {
    if (py >= scene.height - 1) return last;
    if (py <= 0) return first;
    return nearestGap(scene, px, py) ?? last;
  }
  if (hit.t === 'seq') return gapAt(hit.ref, 0);
  if (hit.t === 'root') {
    if (!first || !last) return null;
    if (py <= first.y) return first;
    if (py >= last.y) return last;
    return nearestGap(scene, px, py) ?? last;
  }
  if (!hit.seq || hit.index === undefined) return nearestGap(scene, px, py);
  const head = hit.head;
  // header at the top (IF, CASE, FOR, WHILE ...); REPEAT has its condition at the bottom
  const inHead = head.h < hit.h && head.y <= hit.y + 1 && py >= head.y && py <= head.y + head.h;
  const mid = inHead ? head.y + head.h / 2 : hit.y + hit.h / 2;
  return gapAt(hit.seq, py < mid ? hit.index : hit.index + 1);
}

/** Nearest insertion gap to a point (for drag and drop). */
export function nearestGap(scene: Scene, px: number, py: number): Gap | null {
  let best: Gap | null = null;
  let bestD = Infinity;
  for (const g of scene.gaps) {
    if (px < g.x - 4 || px > g.x + g.w + 4) continue;
    const dist = Math.abs(py - g.y);
    // prefer the innermost (narrowest) gap on ties
    if (dist < bestD - 0.5 || (Math.abs(dist - bestD) <= 0.5 && best && g.w < best.w)) {
      best = g;
      bestD = dist;
    }
  }
  return bestD <= 24 ? best : null;
}
