// SPDX-License-Identifier: GPL-3.0-or-later
// Statement and header analysis on top of the tokenizer (used by code export and highlighting).
import type { Diagram, Element, For, Keywords } from '../model/types';
import { walk } from '../model/tree';
import { indexTop, join, nonWs, splitTop, stripKeywords, stripParens, tokenize, trimToks, type Tok } from './lexer';

export type BaseType = 'int' | 'double' | 'string' | 'char' | 'bool' | 'unknown';
/** `name`: the declared name of a type that is no built-in one, e.g. a record type `Date`. */
export interface TypeInfo { base: BaseType; array: boolean; name?: string }

const TYPE_ALIASES: Record<string, BaseType> = {
  int: 'int', integer: 'int', long: 'int', short: 'int', byte: 'int', cardinal: 'int', word: 'int', longint: 'int', unsigned: 'int',
  real: 'double', double: 'double', float: 'double', single: 'double', extended: 'double', number: 'double',
  string: 'string', str: 'string', text: 'string',
  char: 'char', character: 'char',
  boolean: 'bool', bool: 'bool',
};

export function parseType(raw: string | undefined): TypeInfo {
  if (!raw) return { base: 'unknown', array: false };
  let s = raw.trim().toLowerCase().replace(/^std::/, '');
  let array = false;
  const m = /^array\s*(\[[^\]]*\])?\s*of\s+(.+)$/.exec(s);
  if (m) { array = true; s = m[2].trim(); }
  if (s.endsWith('[]')) { array = true; s = s.slice(0, -2).trim(); }
  const base = TYPE_ALIASES[s];
  if (base) return { base, array };
  // keep the spelling of a user type (record types) for the executor and the variable display
  const orig = /([A-Za-z_]\w*)\s*(\[\s*\])?\s*$/.exec(raw.trim())?.[1];
  return orig && orig.toLowerCase() === s ? { base: 'unknown', array, name: orig } : { base: 'unknown', array };
}

// ------------------------------------------------------------------ keywords

export function kwEq(a: string, b: string, k: Keywords): boolean {
  return k.ignoreCase ? a.toLowerCase() === b.toLowerCase() : a === b;
}

/** Does the line start with keyword `kw` (followed by a non-identifier character)? */
export function startsWithKw(line: string, kw: string, k: Keywords): boolean {
  const w = kw.trim();
  if (!w) return false;
  const s = line.trim();
  if (s.length < w.length || !kwEq(s.slice(0, w.length), w, k)) return false;
  return !/[\p{L}\p{N}_]/u.test(s[w.length] ?? ' ');
}

export function afterKw(line: string, kw: string): string {
  return line.trim().slice(kw.trim().length).trim();
}

// ------------------------------------------------------------------ statements

export type Stmt =
  | { t: 'input'; prompt?: string; targets: string[] }
  | { t: 'output'; exprs: string[] }
  | { t: 'assign'; target: string; expr: string; decl?: TypeInfo; isConst?: boolean }
  | { t: 'decl'; names: string[]; type: TypeInfo; isConst?: boolean }
  | { t: 'typedef'; raw: string }
  | { t: 'return'; expr?: string }
  | { t: 'leave'; levels: number }
  | { t: 'exit'; expr?: string }
  | { t: 'throw'; expr?: string }
  | { t: 'call'; expr: string }
  | { t: 'empty' };

const DECL_WORDS = ['var', 'dim', 'const'];

export function classifyLine(raw: string, k: Keywords): Stmt {
  const line = raw.trim();
  if (line === '') return { t: 'empty' };
  if (startsWithKw(line, k.input, k)) {
    const rest = tokenize(afterKw(line, k.input));
    const parts = splitTop(rest, ',').filter((p) => p.length > 0);
    let prompt: string | undefined;
    if (parts[0] && parts[0].length === 1 && parts[0][0].k === 'str') prompt = parts.shift()![0].v;
    else if (parts[0] && parts[0][0]?.k === 'str') {
      // INPUT "prompt" x  (prompt and variable not separated by a comma)
      prompt = parts[0][0].v;
      parts[0] = trimToks(parts[0].slice(1));
    }
    return { t: 'input', prompt, targets: parts.map(join).filter((s) => s !== '') };
  }
  if (startsWithKw(line, k.output, k)) {
    const rest = afterKw(line, k.output);
    return { t: 'output', exprs: rest === '' ? [] : splitTop(tokenize(rest), ',').map(join) };
  }
  if (startsWithKw(line, k.preReturn, k)) {
    const e = afterKw(line, k.preReturn);
    return { t: 'return', expr: e || undefined };
  }
  if (startsWithKw(line, k.preLeave, k)) {
    const n = parseInt(afterKw(line, k.preLeave), 10);
    return { t: 'leave', levels: Number.isFinite(n) && n > 0 ? n : 1 };
  }
  if (startsWithKw(line, k.preExit, k)) {
    const e = afterKw(line, k.preExit);
    return { t: 'exit', expr: e || undefined };
  }
  if (startsWithKw(line, k.preThrow, k)) {
    const e = afterKw(line, k.preThrow);
    return { t: 'throw', expr: e || undefined };
  }
  if (/^type\s+\w+\s*=/i.test(line)) return { t: 'typedef', raw: line };

  let toks = tokenize(line);
  let isConst = false;
  const first = nonWs(toks)[0];
  if (first?.k === 'id' && DECL_WORDS.includes(first.v.toLowerCase())) {
    isConst = first.v.toLowerCase() === 'const';
    toks = trimToks(toks.slice(toks.indexOf(first) + 1));
  }
  const ai = indexTop(toks, '<-') >= 0 ? indexTop(toks, '<-') : indexTop(toks, ':=');
  const lhs = trimToks(ai >= 0 ? toks.slice(0, ai) : toks);
  const rhs = ai >= 0 ? join(trimToks(toks.slice(ai + 1))) : undefined;

  // Pascal style  a, b: int   /  BASIC style  a as int
  const colon = indexTop(lhs, ':');
  const asIdx = lhs.findIndex((t) => t.k === 'id' && t.v.toLowerCase() === 'as');
  if (colon > 0 || asIdx > 0) {
    const cut = colon > 0 ? colon : asIdx;
    const names = splitTop(lhs.slice(0, cut), ',').map(join).filter(Boolean);
    const type = parseType(join(lhs.slice(cut + 1)));
    if (rhs !== undefined && names.length === 1) return { t: 'assign', target: names[0], expr: rhs, decl: type, isConst };
    return { t: 'decl', names, type, isConst };
  }
  // C style  int x <- 5  /  int x
  const lw = nonWs(lhs);
  if (lw.length >= 2 && lw[0].k === 'id' && lw[lw.length - 1].k === 'id' && lw.every((t) => t.k === 'id' || t.v === '[' || t.v === ']')) {
    const type = parseType(lw.slice(0, -1).map((t) => t.v).join(''));
    const name = lw[lw.length - 1].v;
    if (rhs !== undefined) return { t: 'assign', target: name, expr: rhs, decl: type, isConst };
    return { t: 'decl', names: [name], type, isConst };
  }
  if (rhs !== undefined) return { t: 'assign', target: join(lhs), expr: rhs, isConst: isConst || undefined };
  if (isConst || first?.v.toLowerCase() === 'var') return { t: 'decl', names: splitTop(lhs, ',').map(join), type: parseType(undefined) };
  return { t: 'call', expr: line };
}

/** Jump element text (empty means leave). */
export function classifyJump(el: Element, k: Keywords): Stmt {
  const line = el.text.join(' ').trim();
  if (line === '') return { t: 'leave', levels: 1 };
  const s = classifyLine(line, k);
  return s.t === 'call' ? { t: 'leave', levels: 1 } : s;
}

// ------------------------------------------------------------------ control structures

export function conditionOf(line: string[], pre: string, post: string, k: Keywords): string {
  const text = line.map((l) => l.replace(/\\$/, '')).join(' ').trim();
  return join(stripParens(tokenize(stripKeywords(text, pre, post, k.ignoreCase)))) || 'true';
}

export interface ForInfo { style: 'COUNTER' | 'TRAVERSAL' | 'FREETEXT'; var: string; start: string; end: string; step: number; list: string; raw: string }

export function forInfo(el: For, k: Keywords): ForInfo {
  const raw = el.text.join(' ').trim();
  const info: ForInfo = { style: el.style, var: el.counterVar ?? '', start: el.startValue ?? '', end: el.endValue ?? '', step: el.stepConst ?? 1, list: '', raw };
  // traversal: foreach v in list
  if (el.style === 'TRAVERSAL' || startsWithKw(raw, k.preForIn, k) && !startsWithKw(raw, k.preFor, k) || (k.preForIn === k.preFor && new RegExp(`\\s${escapeRe(k.postForIn)}\\s`, k.ignoreCase ? 'i' : '').test(raw) && !raw.includes('<-'))) {
    const body = startsWithKw(raw, k.preForIn, k) ? afterKw(raw, k.preForIn) : afterKw(raw, k.preFor);
    const m = new RegExp(`^(\\w+)\\s+${escapeRe(k.postForIn)}\\s+(.+)$`, k.ignoreCase ? 'i' : '').exec(body);
    if (m) return { ...info, style: 'TRAVERSAL', var: m[1], list: m[2].trim() };
  }
  if (startsWithKw(raw, k.preFor, k)) {
    const body = afterKw(raw, k.preFor);
    const re = new RegExp(`^(\\w+)\\s*(?:<-|:=|←|=)\\s*(.+?)\\s+${escapeRe(k.postFor)}\\s+(.+?)(?:\\s+${escapeRe(k.stepFor)}\\s+([+-]?\\s*\\d+))?$`, k.ignoreCase ? 'i' : '');
    const m = re.exec(body);
    if (m) {
      return {
        ...info, style: 'COUNTER', var: m[1], start: m[2].trim(), end: m[3].trim(),
        step: m[4] ? parseInt(m[4].replace(/\s/g, ''), 10) : 1,
      };
    }
  }
  if (info.var && info.end) return { ...info, style: 'COUNTER' };
  return { ...info, style: 'FREETEXT' };
}

function escapeRe(s: string): string {
  return s.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&') || '\\u0000';
}

export interface CaseInfo { discriminator: string; branches: { values: string[] | null; index: number }[] }

/** Case selectors: values per branch; `null` = default branch. Hidden default (%) is omitted. */
export function caseInfo(lines: string[], k: Keywords): CaseInfo {
  const discriminator = conditionOf([lines[0] ?? ''], k.preCase, k.postCase, k);
  const branches: CaseInfo['branches'] = [];
  const n = lines.length - 1;
  for (let i = 1; i <= n; i++) {
    const last = i === n;
    const s = (lines[i] ?? '').trim();
    if (last) {
      if (s !== '%') branches.push({ values: null, index: i - 1 });
    } else branches.push({ values: splitTop(tokenize(s), ',').map(join).filter(Boolean), index: i - 1 });
  }
  return { discriminator, branches };
}

// ------------------------------------------------------------------ diagram header

export interface Param { name: string; type: TypeInfo; def?: string }
export interface Signature { name: string; params: Param[]; result?: TypeInfo; isFunction: boolean }

export function parseSignature(d: Diagram): Signature {
  const head = d.text.join(' ').trim();
  const open = head.indexOf('(');
  if (open < 0) {
    const raw = head.split(/\s/)[0];
    const name = !raw || raw === '???' ? 'structorizer' : sanitizeName(raw);
    return { name, params: [], isFunction: false };
  }
  const close = head.lastIndexOf(')');
  const before = head.slice(0, open).trim();
  const inner = head.slice(open + 1, close > open ? close : undefined);
  const after = close > open ? head.slice(close + 1).trim() : '';
  const beforeWords = before.split(/\s+/);
  const rawName = beforeWords[beforeWords.length - 1] || '';
  const name = !rawName || rawName === '???' ? 'structorizer' : sanitizeName(rawName);
  let result: TypeInfo | undefined;
  const cStyle = beforeWords.length > 1;
  if (cStyle) result = parseType(beforeWords.slice(0, -1).join(' '));
  const am = /^(?::|as)\s*(.+)$/i.exec(after);
  if (am) result = parseType(am[1]);
  if (result && /^void$/i.test(cStyle ? beforeWords.slice(0, -1).join(' ') : (am?.[1] ?? ''))) result = undefined;

  const params: Param[] = [];
  const basic = /\bas\b/i.test(inner);
  const groups = inner.includes(';') ? inner.split(';') : cStyle || basic ? inner.split(',') : [inner];
  for (const g of groups) {
    const gs = g.trim();
    if (!gs) continue;
    const def = /=(.+)$/.exec(gs)?.[1]?.trim();
    const noDef = gs.replace(/=.+$/, '').trim();
    const pc = /^(.+?)\s*(?::|\bas\b)\s*(.+)$/i.exec(noDef);
    if (pc) {
      for (const nm of pc[1].split(',')) if (nm.trim()) params.push({ name: nm.trim().replace(/^var\s+/i, ''), type: parseType(pc[2]), def });
    } else if (cStyle || /^\w+(\[\])?\s+\w+$/.test(noDef)) {
      const parts = noDef.split(/\s+/);
      if (parts.length >= 2) params.push({ name: parts[parts.length - 1], type: parseType(parts.slice(0, -1).join(' ')), def });
      else params.push({ name: noDef, type: parseType(undefined), def });
    } else {
      for (const nm of noDef.split(',')) if (nm.trim()) params.push({ name: nm.trim(), type: parseType(undefined), def });
    }
  }
  const returns = d.diagramType === 'sub' && (result !== undefined || assignsResult(d, name));
  return { name: sanitizeName(name), params, result, isFunction: returns };
}

const RESULT_NAMES = ['result', 'RESULT', 'Result'];

/** Name of the variable carrying the function result (Pascal style), if any. */
export function resultVariable(d: Diagram, fnName: string): string | null {
  let found: string | null = null;
  walk(d, (el) => {
    if (found || (el.kind !== 'instruction' && el.kind !== 'call')) return;
    for (const l of el.text) {
      const s = classifyLine(l, d.keywords);
      if (s.t === 'assign' && (s.target === fnName || RESULT_NAMES.includes(s.target))) { found = s.target; return; }
    }
  });
  return found;
}

function assignsResult(d: Diagram, name: string): boolean {
  if (resultVariable(d, name)) return true;
  let ret = false;
  walk(d, (el) => {
    for (const l of el.text) {
      if ((el.kind === 'jump' || el.kind === 'instruction') && startsWithKw(l, d.keywords.preReturn, d.keywords) && afterKw(l, d.keywords.preReturn) !== '') ret = true;
    }
  });
  return ret;
}

/** All variable names of a diagram: parameters, assigned, declared, input targets, loop variables. */
export function diagramVariables(d: Diagram): Set<string> {
  const vars = new Set<string>();
  const ident = (s: string) => /^[\p{L}_][\p{L}\p{N}_]*/u.exec(s.trim())?.[0];
  if (d.diagramType === 'sub') for (const p of parseSignature(d).params) vars.add(p.name);
  walk(d, (el) => {
    if (el.kind === 'for') { const v = forInfo(el, d.keywords).var; if (v) vars.add(v); return; }
    if (el.kind === 'try' && el.text[0]?.trim()) vars.add(el.text[0].trim());
    if (el.kind !== 'instruction' && el.kind !== 'call') return;
    for (const l of el.text) {
      const s = classifyLine(l, d.keywords);
      if (s.t === 'assign') { const n = ident(s.target); if (n) vars.add(n); }
      else if (s.t === 'decl') s.names.forEach((n) => { const x = ident(n); if (x) vars.add(x); });
      else if (s.t === 'input') s.targets.forEach((n) => { const x = ident(n); if (x) vars.add(x); });
    }
  });
  return vars;
}

export function sanitizeName(s: string): string {
  const n = s.replace(/[^\p{L}\p{N}_]/gu, '_');
  return /^[\p{L}_]/u.test(n) ? n : '_' + n;
}

/** Name of the routine called in a call text line (`x <- f(a)` or `f(a)`), with argument count. */
export function calledRoutine(line: string, k: Keywords): { name: string; argc: number } | null {
  const s = classifyLine(line, k);
  const expr = s.t === 'assign' ? s.expr : s.t === 'call' ? s.expr : null;
  if (!expr) return null;
  const all = trimToks(tokenize(expr));
  const toks = nonWs(all);
  if (toks.length < 3 || toks[0].k !== 'id' || toks[1].v !== '(' || toks[toks.length - 1].v !== ')') return null;
  const inner = trimToks(all.slice(all.indexOf(toks[1]) + 1, all.length - 1));
  return { name: toks[0].v, argc: inner.length === 0 ? 0 : splitTop(inner, ',').length };
}

export type { Tok };
