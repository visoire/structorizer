// SPDX-License-Identifier: GPL-3.0-or-later
// Tokenizer for the Structorizer element text language (lossless: whitespace is kept).
// Phase 1 uses it for code export and highlighting; the Phase 2 parser builds on it.
import type { Keywords } from '../model/types';

export type TokKind = 'ws' | 'id' | 'kw' | 'num' | 'str' | 'op' | 'punct' | 'other';
export interface Tok { k: TokKind; v: string; kw?: keyof Keywords; pos?: number }

const OPS = ['<-', ':=', '<=', '>=', '<>', '!=', '==', '&&', '||', '^^', '<<', '>>', '+=', '-=', '*=', '/=', '++', '--',
  '+', '-', '*', '/', '%', '<', '>', '=', '!', '&', '|', '^', '~', '?'];
const PUNCT = new Set(['(', ')', '[', ']', '{', '}', ',', ';', '.', ':']);
const UNICODE_OPS: Record<string, string> = { '←': '<-', '≤': '<=', '≥': '>=', '≠': '<>' };

export function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (/\s/.test(c)) {
      let j = i + 1;
      while (j < n && /\s/.test(src[j])) j++;
      out.push({ k: 'ws', v: src.slice(i, j) });
      i = j;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && src[j] !== c) { if (src[j] === '\\') j++; j++; }
      out.push({ k: 'str', v: src.slice(i, Math.min(n, j + 1)) });
      i = j + 1;
      continue;
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      const m = /^(0[xX][0-9a-fA-F]+|0[bB][01]+|[0-9]*\.?[0-9]+(?:[eE][+-]?[0-9]+)?)/.exec(src.slice(i));
      const v = m ? m[0] : c;
      out.push({ k: 'num', v });
      i += v.length;
      continue;
    }
    if (/[\p{L}_]/u.test(c)) {
      let j = i + 1;
      while (j < n && /[\p{L}\p{N}_]/u.test(src[j])) j++;
      out.push({ k: 'id', v: src.slice(i, j) });
      i = j;
      continue;
    }
    if (UNICODE_OPS[c]) { out.push({ k: 'op', v: UNICODE_OPS[c] }); i++; continue; }
    const op = OPS.find((o) => src.startsWith(o, i));
    if (op) { out.push({ k: 'op', v: op }); i += op.length; continue; }
    if (PUNCT.has(c)) { out.push({ k: 'punct', v: c }); i++; continue; }
    out.push({ k: 'other', v: c });
    i++;
  }
  return out;
}

export const join = (toks: Tok[]) => toks.map((t) => t.v).join('');
export const nonWs = (toks: Tok[]) => toks.filter((t) => t.k !== 'ws');
export const trimToks = (toks: Tok[]): Tok[] => {
  let a = 0;
  let b = toks.length;
  while (a < b && toks[a].k === 'ws') a++;
  while (b > a && toks[b - 1].k === 'ws') b--;
  return toks.slice(a, b);
};

/** Split at top-level occurrences of a punctuation/operator value (not inside brackets). */
export function splitTop(toks: Tok[], sep: string): Tok[][] {
  const parts: Tok[][] = [[]];
  let depth = 0;
  for (const t of toks) {
    if (t.k === 'punct' && (t.v === '(' || t.v === '[' || t.v === '{')) depth++;
    if (t.k === 'punct' && (t.v === ')' || t.v === ']' || t.v === '}')) depth--;
    if (depth === 0 && (t.k === 'punct' || t.k === 'op') && t.v === sep) parts.push([]);
    else parts[parts.length - 1].push(t);
  }
  return parts.map(trimToks);
}

/** Index of the first top-level operator `op`, or -1. */
export function indexTop(toks: Tok[], op: string): number {
  let depth = 0;
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.k === 'punct' && '([{'.includes(t.v)) depth++;
    else if (t.k === 'punct' && ')]}'.includes(t.v)) depth--;
    else if (depth === 0 && t.v === op && (t.k === 'op' || t.k === 'punct')) return i;
  }
  return -1;
}

/** Is the token list wrapped in one pair of matching parentheses? */
export function stripParens(toks: Tok[]): Tok[] {
  let t = trimToks(toks);
  while (t.length >= 2 && t[0].v === '(' && t[t.length - 1].v === ')') {
    let depth = 0;
    let wraps = true;
    for (let i = 0; i < t.length; i++) {
      if (t[i].v === '(') depth++;
      else if (t[i].v === ')') depth--;
      if (depth === 0 && i < t.length - 1) { wraps = false; break; }
    }
    if (!wraps) break;
    t = trimToks(t.slice(1, -1));
  }
  return t;
}

/** Remove a leading and a trailing keyword (keywords may consist of several words). */
export function stripKeywords(line: string, pre: string, post: string, ignoreCase: boolean): string {
  let s = line.trim();
  const eq = (a: string, b: string) => (ignoreCase ? a.toLowerCase() === b.toLowerCase() : a === b);
  const p = pre.trim();
  if (p && s.length >= p.length && eq(s.slice(0, p.length), p) && !/[\p{L}\p{N}_]/u.test(s[p.length] ?? ' ') ) {
    s = s.slice(p.length).trim();
  }
  const q = post.trim();
  if (q && s.length >= q.length && eq(s.slice(s.length - q.length), q) && !/[\p{L}\p{N}_]/u.test(s[s.length - q.length - 1] ?? ' ')) {
    s = s.slice(0, s.length - q.length).trim();
  }
  return s;
}

/** Join element text lines that end with a line-continuation backslash `\`. */
export function joinContinuedLines(lines: string[]): string[] {
  const out: string[] = [];
  let buf = '';
  // a record/struct type definition may spread over several lines until its '}' (one statement)
  let openType = 0;
  const braces = (s: string) => (s.match(/\{/g)?.length ?? 0) - (s.match(/\}/g)?.length ?? 0);
  for (const l of lines) {
    if (openType > 0) {
      buf += l + '\n';
      openType += braces(l);
      if (openType <= 0) { out.push(buf.trimEnd()); buf = ''; openType = 0; }
      continue;
    }
    if (l.trimEnd().endsWith('\\')) { buf += l.trimEnd().slice(0, -1) + ' '; continue; }
    const line = buf + l;
    if (/^\s*type\s+\w+\s*=\s*(record|struct)\b/i.test(line) && braces(line) > 0) {
      buf = line + '\n';
      openType = braces(line);
      continue;
    }
    out.push(line);
    buf = '';
  }
  if (buf) out.push(buf.trimEnd());
  return out;
}

const KW_FIELDS: ( Exclude<keyof Keywords, 'ignoreCase'> )[] = [
  'preAlt', 'postAlt', 'preCase', 'postCase', 'preForIn', 'postForIn', 'preFor', 'postFor', 'stepFor',
  'preWhile', 'postWhile', 'preRepeat', 'postRepeat', 'preLeave', 'preReturn', 'preExit', 'preThrow',
  'input', 'output',
];

/**
 * Keyword-aware tokenizer (P2-01): recognizes configured diagram keywords (including multi-word
 * keywords such as "for each") and annotates matched tokens with `k: 'kw'` and `kw: key`.
 */
export function tokenizeWithKeywords(src: string, keywords: Keywords): Tok[] {
  const base = tokenize(src);
  const entries = KW_FIELDS
    .map((key) => ({ key, words: tokenize(keywords[key].trim()).filter((t) => t.k !== 'ws').map((t) => t.v) }))
    .filter((e) => e.words.length > 0)
    .sort((a, b) => b.words.length - a.words.length);

  const eq = (a: string, b: string) => (keywords.ignoreCase ? a.toLowerCase() === b.toLowerCase() : a === b);
  const out: Tok[] = [];
  let i = 0;
  while (i < base.length) {
    if (base[i].k === 'id') {
      let matched = false;
      for (const entry of entries) {
        let j = i;
        let wIdx = 0;
        const span: Tok[] = [];
        while (j < base.length && wIdx < entry.words.length) {
          if (base[j].k === 'ws') {
            span.push(base[j]);
            j++;
            continue;
          }
          if (base[j].k === 'id' && eq(base[j].v, entry.words[wIdx])) {
            span.push(base[j]);
            wIdx++;
            j++;
          } else {
            break;
          }
        }
        if (wIdx === entry.words.length) {
          out.push({ k: 'kw', v: span.map((t) => t.v).join(''), kw: entry.key });
          i = j;
          matched = true;
          break;
        }
      }
      if (matched) continue;
    }
    out.push(base[i]);
    i++;
  }
  return out;
}
