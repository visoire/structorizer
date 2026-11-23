// SPDX-License-Identifier: GPL-3.0-or-later
// Pratt expression parser (P2-02) and statement parser (P2-03) with cached element AST (#800).
import type { Element, Keywords } from '../model/types';
import { classifyLine, conditionOf, forInfo, parseType, type Stmt, type TypeInfo } from './analyze';
import { joinContinuedLines, nonWs, tokenize, type Tok } from './lexer';

export type Expr =
  | { t: 'num'; v: number; raw: string; isInt: boolean }
  | { t: 'str'; v: string; raw: string; isChar: boolean }
  | { t: 'bool'; v: boolean }
  | { t: 'null' }
  | { t: 'id'; name: string }
  | { t: 'unary'; op: '-' | '+' | '!' | 'not' | '~'; arg: Expr }
  | { t: 'binary'; op: string; left: Expr; right: Expr }
  | { t: 'call'; name: string; args: Expr[] }
  | { t: 'index'; target: Expr; index: Expr }
  | { t: 'member'; target: Expr; field: string }
  | { t: 'array'; items: Expr[] }
  | { t: 'record'; typeName?: string; fields: { name: string; value: Expr }[] };

export type LValue =
  | { t: 'var'; name: string }
  | { t: 'index'; target: LValue; index: Expr }
  | { t: 'member'; target: LValue; field: string };

export type StmtNode =
  | { t: 'input'; prompt?: string; targets: LValue[]; rawTargets: string[] }
  | { t: 'output'; exprs: Expr[]; rawExprs: string[] }
  | { t: 'assign'; target: LValue; rawTarget: string; expr: Expr; rawExpr: string; decl?: TypeInfo; isConst?: boolean }
  | { t: 'decl'; names: string[]; type: TypeInfo; isConst?: boolean }
  | { t: 'typedef'; name: string; fields: { name: string; type: TypeInfo }[]; raw: string }
  | { t: 'call'; name: string; args: Expr[]; expr: Expr; raw: string }
  | { t: 'return'; expr?: Expr; rawExpr?: string }
  | { t: 'leave'; levels: number }
  | { t: 'exit'; expr?: Expr; rawExpr?: string }
  | { t: 'throw'; expr?: Expr; rawExpr?: string }
  | { t: 'empty' };

export interface ElementAst {
  stmts: StmtNode[];
  condition?: Expr;
}

export class ParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ParseError';
  }
}

const INFIX_BP: Record<string, [number, number]> = {
  '||': [10, 11],
  or: [10, 11],
  '^^': [20, 21],
  xor: [20, 21],
  '&&': [30, 31],
  and: [30, 31],
  '|': [40, 41],
  '^': [50, 51],
  '&': [60, 61],
  '=': [70, 71],
  '==': [70, 71],
  '<>': [70, 71],
  '!=': [70, 71],
  '<': [80, 81],
  '<=': [80, 81],
  '>': [80, 81],
  '>=': [80, 81],
  in: [80, 81],
  '<<': [90, 91],
  '>>': [90, 91],
  shl: [90, 91],
  shr: [90, 91],
  '+': [100, 101],
  '-': [100, 101],
  '*': [110, 111],
  '/': [110, 111],
  div: [110, 111],
  '%': [110, 111],
  mod: [110, 111],
};

const WORD_OPS = new Set(['or', 'xor', 'and', 'in', 'shl', 'shr', 'div', 'mod']);

function unquoteString(raw: string): { v: string; isChar: boolean } {
  if (raw.length < 2) return { v: raw, isChar: false };
  const q = raw[0];
  const body = raw.slice(1, -1);
  let out = '';
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === '\\' && i + 1 < body.length) {
      const n = body[++i];
      out += n === 'n' ? '\n' : n === 't' ? '\t' : n === 'r' ? '\r' : n;
    } else if (c === q && body[i + 1] === q) {
      out += q;
      i++;
    } else {
      out += c;
    }
  }
  return { v: out, isChar: q === "'" && out.length === 1 };
}

function parseNumber(raw: string): { v: number; isInt: boolean } {
  if (/^0[xX]/.test(raw)) return { v: parseInt(raw.slice(2), 16), isInt: true };
  if (/^0[bB]/.test(raw)) return { v: parseInt(raw.slice(2), 2), isInt: true };
  const isInt = !/[.eE]/.test(raw);
  return { v: isInt ? parseInt(raw, 10) : parseFloat(raw), isInt };
}

/** Parse a Structorizer expression string into an AST node using a Pratt parser (P2-02). */
export function parseExpr(src: string): Expr {
  const toks = nonWs(tokenize(src));
  if (toks.length === 0) return { t: 'bool', v: true };
  let pos = 0;

  const peek = (): Tok | undefined => toks[pos];
  const next = (): Tok | undefined => toks[pos++];
  const eat = (v: string): boolean => {
    if (toks[pos]?.v === v) {
      pos++;
      return true;
    }
    return false;
  };

  const parseExprBp = (minBp: number): Expr => {
    let left = parsePrefix();

    while (pos < toks.length) {
      const tok = peek()!;
      // Postfix: call f(...), index a[...], member r.x, record literal Type{...}
      if (tok.k === 'punct' && tok.v === '(' && left.t === 'id') {
        pos++;
        const args: Expr[] = [];
        if (!eat(')')) {
          while (pos < toks.length) {
            args.push(parseExprBp(0));
            if (eat(',')) continue;
            eat(')');
            break;
          }
        }
        left = { t: 'call', name: left.name, args };
        continue;
      }
      if (tok.k === 'punct' && tok.v === '[') {
        pos++;
        const idx = parseExprBp(0);
        eat(']');
        left = { t: 'index', target: left, index: idx };
        continue;
      }
      if (tok.k === 'punct' && tok.v === '.') {
        pos++;
        const fTok = next();
        const field = fTok ? fTok.v : '';
        if (peek()?.v === '(' && left.t === 'id') {
          pos++;
          const args: Expr[] = [];
          if (!eat(')')) {
            while (pos < toks.length) {
              args.push(parseExprBp(0));
              if (eat(',')) continue;
              eat(')');
              break;
            }
          }
          left = { t: 'call', name: `${left.name}.${field}`, args };
        } else {
          left = { t: 'member', target: left, field };
        }
        continue;
      }
      if (tok.k === 'punct' && tok.v === '{' && left.t === 'id') {
        left = parseBraceLiteral(left.name);
        continue;
      }

      const opKey = tok.k === 'id' ? tok.v.toLowerCase() : tok.v;
      const isInfix = tok.k === 'op' || (tok.k === 'id' && WORD_OPS.has(opKey));
      if (!isInfix) break;
      const bp = INFIX_BP[opKey];
      if (!bp || bp[0] < minBp) break;
      pos++;
      const right = parseExprBp(bp[1]);
      left = { t: 'binary', op: opKey, left, right };
    }
    return left;
  };

  const parseBraceLiteral = (typeName?: string): Expr => {
    eat('{');
    if (eat('}')) return typeName ? { t: 'record', typeName, fields: [] } : { t: 'array', items: [] };
    // Check if it is a record literal `{ x: 1, y: 2 }` or `{ .x = 1 }`
    const first = toks[pos];
    const second = toks[pos + 1];
    if (
      typeName ||
      (first?.k === 'id' && (second?.v === ':' || second?.v === '=' || second?.v === '<-')) ||
      (first?.v === '.' && second?.k === 'id')
    ) {
      const fields: { name: string; value: Expr }[] = [];
      while (pos < toks.length && peek()?.v !== '}') {
        // "smart" record initializer (desktop 3.28-06): an item without a component name
        // (Date{2026, 11, 23}) gets the name '' and takes the component of its position
        const a = toks[pos], b = toks[pos + 1];
        const named = (a?.k === 'id' && (b?.v === ':' || b?.v === '=' || b?.v === '<-' || b?.v === ':='))
          || (a?.v === '.' && toks[pos + 1]?.k === 'id');
        let fName = '';
        if (named) {
          eat('.');
          fName = next()?.v ?? '';
          if (!eat(':') && !eat('=') && !eat('<-')) eat(':=');
        }
        const value = parseExprBp(0);
        fields.push({ name: fName, value });
        if (!eat(',') && !eat(';')) break;
      }
      eat('}');
      return { t: 'record', typeName, fields };
    }
    const items: Expr[] = [];
    while (pos < toks.length && peek()?.v !== '}') {
      items.push(parseExprBp(0));
      if (!eat(',')) break;
    }
    eat('}');
    return { t: 'array', items };
  };

  const parsePrefix = (): Expr => {
    const tok = next();
    if (!tok) return { t: 'null' };
    if (tok.k === 'num') {
      const { v, isInt } = parseNumber(tok.v);
      return { t: 'num', v, raw: tok.v, isInt };
    }
    if (tok.k === 'str') {
      const { v, isChar } = unquoteString(tok.v);
      return { t: 'str', v, raw: tok.v, isChar };
    }
    if (tok.k === 'op' && (tok.v === '-' || tok.v === '+' || tok.v === '!' || tok.v === '~')) {
      return { t: 'unary', op: tok.v, arg: parseExprBp(120) };
    }
    if (tok.k === 'id') {
      const low = tok.v.toLowerCase();
      if (low === 'not') return { t: 'unary', op: 'not', arg: parseExprBp(120) };
      if (low === 'true') return { t: 'bool', v: true };
      if (low === 'false') return { t: 'bool', v: false };
      if (low === 'null' || low === 'nil' || low === 'none') return { t: 'null' };
      return { t: 'id', name: tok.v };
    }
    if (tok.k === 'punct' && tok.v === '(') {
      const inner = parseExprBp(0);
      eat(')');
      return inner;
    }
    if (tok.k === 'punct' && tok.v === '{') {
      pos--;
      return parseBraceLiteral();
    }
    if (tok.k === 'punct' && tok.v === '[') {
      const items: Expr[] = [];
      if (!eat(']')) {
        while (pos < toks.length) {
          items.push(parseExprBp(0));
          if (eat(',')) continue;
          eat(']');
          break;
        }
      }
      return { t: 'array', items };
    }
    return { t: 'id', name: tok.v };
  };

  return parseExprBp(0);
}

/** Convert an Expr into an LValue (`x`, `a[i]`, `r.f`). */
export function exprToLValue(expr: Expr, rawFallback = 'x'): LValue {
  if (expr.t === 'id') return { t: 'var', name: expr.name };
  if (expr.t === 'index') return { t: 'index', target: exprToLValue(expr.target, rawFallback), index: expr.index };
  if (expr.t === 'member') return { t: 'member', target: exprToLValue(expr.target, rawFallback), field: expr.field };
  return { t: 'var', name: rawFallback.trim() };
}

export function parseLValue(src: string): LValue {
  return exprToLValue(parseExpr(src), src);
}

function parseTypedef(raw: string): StmtNode {
  const m = /^type\s+(\w+)\s*=\s*(?:record|struct)\s*\{?([^}]*)\}?/i.exec(raw.trim());
  if (!m) return { t: 'typedef', name: 'Record', fields: [], raw };
  const name = m[1];
  const fields: { name: string; type: TypeInfo }[] = [];
  // Pascal style groups share one type: in "month, day: short" the bare "month" waits for the
  // type of the next "name: type" part (it used to be dropped, which broke positional initializers)
  let pending: string[] = [];
  for (const part of m[2].split(/[;,]/)) {
    const s = part.trim();
    if (!s) continue;
    const colon = s.indexOf(':');
    if (colon > 0) {
      const fNames = [...pending, ...s.slice(0, colon).split(',').map((x) => x.trim()).filter(Boolean)];
      pending = [];
      const ty = parseType(s.slice(colon + 1));
      for (const fn of fNames) fields.push({ name: fn, type: ty });
    } else if (/^\w+$/.test(s)) {
      pending.push(s);
    } else {
      const words = s.split(/\s+/);
      if (words.length >= 2) {
        fields.push({ name: words[words.length - 1], type: parseType(words.slice(0, -1).join(' ')) });
      }
    }
  }
  return { t: 'typedef', name, fields, raw };
}

/** Parse one instruction/call/jump line into a structured StmtNode with full ASTs (P2-03). */
export function parseStmt(raw: string, k: Keywords): StmtNode {
  const trimmed = raw.trim();
  if (!trimmed) return { t: 'empty' };

  // Handle C-style increment/decrement statements: i++, ++i, i--, --i, x += y
  const incMatch = /^([\p{L}_][\p{L}\p{N}_]*(?:\[[^\]]+\]|\.\w+)*)\s*(\+\+|--)$/u.exec(trimmed) ??
    /^(\+\+|--)([\p{L}_][\p{L}\p{N}_]*(?:\[[^\]]+\]|\.\w+)*)$/u.exec(trimmed);
  if (incMatch) {
    const isPrefix = incMatch[1] === '++' || incMatch[1] === '--';
    const op = (isPrefix ? incMatch[1] : incMatch[2]) === '++' ? '+' : '-';
    const targetRaw = isPrefix ? incMatch[2] : incMatch[1];
    const targetExpr = parseExpr(targetRaw);
    const expr: Expr = { t: 'binary', op, left: targetExpr, right: { t: 'num', v: 1, raw: '1', isInt: true } };
    return { t: 'assign', target: exprToLValue(targetExpr, targetRaw), rawTarget: targetRaw, expr, rawExpr: `${targetRaw} ${op} 1` };
  }

  const compoundMatch = /^([\p{L}_][\p{L}\p{N}_]*(?:\[[^\]]+\]|\.\w+)*)\s*(\+=|-=|\*=|\/=)\s*(.+)$/u.exec(trimmed);
  if (compoundMatch) {
    const targetRaw = compoundMatch[1].trim();
    const op = compoundMatch[2][0];
    const rhsRaw = compoundMatch[3].trim();
    const targetExpr = parseExpr(targetRaw);
    const expr: Expr = { t: 'binary', op, left: targetExpr, right: parseExpr(rhsRaw) };
    return { t: 'assign', target: exprToLValue(targetExpr, targetRaw), rawTarget: targetRaw, expr, rawExpr: `(${targetRaw}) ${op} (${rhsRaw})` };
  }

  const s: Stmt = classifyLine(raw, k);
  switch (s.t) {
    case 'empty': return { t: 'empty' };
    case 'input':
      return {
        t: 'input',
        prompt: s.prompt ? unquoteString(s.prompt).v : undefined,
        targets: s.targets.map(parseLValue),
        rawTargets: s.targets,
      };
    case 'output':
      return {
        t: 'output',
        exprs: s.exprs.map(parseExpr),
        rawExprs: s.exprs,
      };
    case 'assign':
      return {
        t: 'assign',
        target: parseLValue(s.target),
        rawTarget: s.target,
        expr: parseExpr(s.expr),
        rawExpr: s.expr,
        decl: s.decl,
        isConst: s.isConst,
      };
    case 'decl':
      return { t: 'decl', names: s.names, type: s.type, isConst: s.isConst };
    case 'typedef':
      return parseTypedef(s.raw);
    case 'return':
      return { t: 'return', expr: s.expr ? parseExpr(s.expr) : undefined, rawExpr: s.expr };
    case 'leave':
      return { t: 'leave', levels: s.levels };
    case 'exit':
      return { t: 'exit', expr: s.expr ? parseExpr(s.expr) : undefined, rawExpr: s.expr };
    case 'throw':
      return { t: 'throw', expr: s.expr ? parseExpr(s.expr) : undefined, rawExpr: s.expr };
    case 'call': {
      const expr = parseExpr(s.expr);
      if (expr.t === 'call') {
        return { t: 'call', name: expr.name, args: expr.args, expr, raw: s.expr };
      }
      return { t: 'call', name: s.expr.trim(), args: [], expr, raw: s.expr };
    }
  }
}

const astCache = new WeakMap<Element, { kw: Keywords; ast: ElementAst }>();

/** Permanent cached syntax tree per element (desktop issue #800). */
export function getElementAst(el: Element, k: Keywords): ElementAst {
  const hit = astCache.get(el);
  if (hit && hit.kw === k) return hit.ast;

  const lines = joinContinuedLines(el.text);
  let ast: ElementAst;
  switch (el.kind) {
    case 'instruction':
    case 'call':
      ast = { stmts: lines.map((l) => parseStmt(l, k)).filter((s) => s.t !== 'empty') };
      break;
    case 'jump': {
      const line = lines.join(' ').trim();
      if (!line) ast = { stmts: [{ t: 'leave', levels: 1 }] };
      else {
        const st = parseStmt(line, k);
        ast = { stmts: [st.t === 'call' ? { t: 'leave', levels: 1 } : st] };
      }
      break;
    }
    case 'alternative':
      ast = { stmts: [], condition: parseExpr(conditionOf(el.text, k.preAlt, k.postAlt, k)) };
      break;
    case 'while':
      ast = { stmts: [], condition: parseExpr(conditionOf(el.text, k.preWhile, k.postWhile, k)) };
      break;
    case 'repeat':
      ast = { stmts: [], condition: parseExpr(conditionOf(el.text, k.preRepeat, k.postRepeat, k)) };
      break;
    case 'for': {
      const fi = forInfo(el, k);
      ast = { stmts: [], condition: fi.style === 'TRAVERSAL' ? parseExpr(fi.list) : parseExpr(fi.end || '0') };
      break;
    }
    default:
      ast = { stmts: [] };
      break;
  }
  astCache.set(el, { kw: k, ast });
  return ast;
}
