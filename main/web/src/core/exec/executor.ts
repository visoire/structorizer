// SPDX-License-Identifier: GPL-3.0-or-later
// Generator-based Nassi-Shneiderman diagram executor (Decision D-14: function*, no eval, no new Function).
// Covers P2-04 (values & built-ins, #408, #530), P2-05 (all 11 elements + jumps/try/parallel),
// P2-08 (multi-diagram subroutine pool + includables), P2-09 (execution counts & coverage).
import type { Diagram, Element, For, Keywords } from '../model/types';
import {
  caseInfo, forInfo, parseSignature, resultVariable, type TypeInfo,
} from '../lang/analyze';
import {
  exprToLValue, getElementAst, parseExpr, type Expr, type LValue, type StmtNode,
} from '../lang/parser';
import { createTurtleState, execTurtleRoutine, type TurtleState } from './turtle';

export type RuntimeVal =
  | number
  | boolean
  | string
  | null
  | RuntimeVal[]
  | { [field: string]: RuntimeVal };

export class RuntimeError extends Error {
  constructor(message: string, public readonly elementId: string, public readonly diagramId?: string) {
    super(message);
    this.name = 'RuntimeError';
  }
}

export interface StackFrame {
  diagramId: string;
  name: string;
  vars: Map<string, RuntimeVal>;
  types: Map<string, TypeInfo>;
  consts: Set<string>;
  resultVar: string | null;
}

export type ExecEvent =
  | { t: 'step'; elementId: string; diagramId: string; kind: Element['kind']; waitingIds?: string[] }
  | { t: 'input'; elementId: string; diagramId: string; prompt: string; target: string }
  | { t: 'output'; elementId: string; diagramId: string; text: string };

export interface ExecResult {
  returnValue?: RuntimeVal;
  exitCode?: number;
  outputs: string[];
  execCounts: Map<string, number>;
  covered: Set<string>;
  turtle: TurtleState;
}

export interface ExecState {
  frames: StackFrame[];
  outputs: string[];
  execCounts: Map<string, number>;
  covered: Set<string>;
  turtle: TurtleState;
  typeDefs: Map<string, { name: string; type: TypeInfo }[]>;
  includedDone: Set<string>;
}

export interface ExecOptions {
  /** Pool of open diagrams (for subroutine and includable lookup, P2-08). */
  pool?: Diagram[];
  /** Optional initial argument values when executing a subroutine directly. */
  args?: RuntimeVal[];
  /** Optional queued inputs for automated testing or non-interactive runs. */
  inputs?: string[];
  /** Maximum steps before halting an infinite loop (default 50000). */
  maxSteps?: number;
  /** Existing state object to mutate and inspect live from the UI. */
  state?: ExecState;
}

export function createExecState(): ExecState {
  return {
    frames: [],
    outputs: [],
    execCounts: new Map(),
    covered: new Set(),
    turtle: createTurtleState(),
    typeDefs: new Map(),
    includedDone: new Set(),
  };
}

export function formatValue(v: RuntimeVal): string {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '0';
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return '{' + v.map((x) => (typeof x === 'string' ? JSON.stringify(x) : formatValue(x))).join(', ') + '}';
  const entries = Object.entries(v).map(([k, val]) => `${k}: ${typeof val === 'string' ? JSON.stringify(val) : formatValue(val)}`);
  return '{' + entries.join(', ') + '}';
}

/** Hidden tag with the record type name (not enumerable: invisible to formatValue and code). */
const RECORD_TYPE: unique symbol = Symbol('recordType');
type RecordObj = { [k: string]: RuntimeVal };

function tagRecord(obj: RecordObj, typeName: string): RecordObj {
  Object.defineProperty(obj, RECORD_TYPE, { value: typeName, enumerable: false });
  return obj;
}

export function typeNameOf(v: RuntimeVal, declared?: TypeInfo): string {
  if (declared && declared.base !== 'unknown') return declared.base + (declared.array ? '[]' : '');
  if (declared?.name && !declared.array) return declared.name;
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const tn = (v as unknown as Record<symbol, string | undefined>)[RECORD_TYPE];
    if (tn) return tn;
  }
  if (v === null) return 'null';
  if (typeof v === 'boolean') return 'bool';
  if (typeof v === 'number') return Number.isInteger(v) ? 'int' : 'double';
  if (typeof v === 'string') return v.length === 1 ? 'char' : 'string';
  if (Array.isArray(v)) return 'array';
  return 'record';
}

export function defaultForType(t: TypeInfo): RuntimeVal {
  if (t.array) return [];
  switch (t.base) {
    case 'int':
    case 'double': return 0;
    case 'bool': return false;
    case 'char': return ' ';
    case 'string': return '';
    default: return null;
  }
}

export function coerceToType(v: RuntimeVal, t: TypeInfo | undefined, elementId: string): RuntimeVal {
  if (!t || t.base === 'unknown') return v;
  if (t.array) {
    if (Array.isArray(v)) return v;
    return [v];
  }
  switch (t.base) {
    case 'int': {
      const n = typeof v === 'boolean' ? (v ? 1 : 0) : Number(v);
      if (!Number.isFinite(n)) throw new RuntimeError(`Cannot convert "${formatValue(v)}" to int`, elementId);
      return Math.trunc(n);
    }
    case 'double': {
      const n = typeof v === 'boolean' ? (v ? 1 : 0) : Number(v);
      if (!Number.isFinite(n)) throw new RuntimeError(`Cannot convert "${formatValue(v)}" to double`, elementId);
      return n;
    }
    case 'bool':
      if (typeof v === 'string') return /^(true|1|yes|ja)$/i.test(v.trim());
      return Boolean(v);
    case 'char': {
      const s = formatValue(v);
      return s.length > 0 ? s[0] : ' ';
    }
    case 'string':
      return formatValue(v);
    default:
      return v;
  }
}

export function parseInputString(raw: string, expectedType: TypeInfo | undefined, elementId: string): RuntimeVal {
  const s = raw.trim();
  if (expectedType && expectedType.base !== 'unknown' && !expectedType.array) {
    if (expectedType.base === 'string') return raw;
    if (expectedType.base === 'char') return raw.length > 0 ? raw[0] : ' ';
    return coerceToType(s, expectedType, elementId);
  }
  if (/^(true|false)$/i.test(s)) return s.toLowerCase() === 'true';
  if (/^[+-]?\d+$/.test(s)) return parseInt(s, 10);
  if (/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(s)) return parseFloat(s);
  if (s.startsWith('{') && s.endsWith('}')) {
    const inner = s.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(',').map((item) => parseInputString(item, undefined, elementId));
  }
  return raw;
}

type Signal =
  | { s: 'none' }
  | { s: 'leave'; levels: number }
  | { s: 'return'; value?: RuntimeVal }
  | { s: 'exit'; code: number }
  | { s: 'throw'; error: string; elementId: string };

function isTruthy(v: RuntimeVal): boolean {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') return v.length > 0 && v.toLowerCase() !== 'false' && v !== '0';
  if (Array.isArray(v)) return v.length > 0;
  return v !== null && v !== undefined;
}

function valuesEqual(a: RuntimeVal, b: RuntimeVal): boolean {
  if (typeof a === 'number' && typeof b === 'number') return a === b;
  if (typeof a === 'string' && typeof b === 'string') return a === b;
  if (typeof a === 'boolean' && typeof b === 'boolean') return a === b;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => valuesEqual(x, b[i]));
  }
  return formatValue(a) === formatValue(b);
}

/**
 * Execute a Structorizer diagram step by step as a generator (P2-05).
 */
export function* executeDiagram(
  mainDiagram: Diagram,
  opts: ExecOptions = {},
): Generator<ExecEvent, ExecResult, string | undefined> {
  const state = opts.state ?? createExecState();
  const pool = opts.pool ?? [mainDiagram];
  const inputQueue = [...(opts.inputs ?? [])];
  const maxSteps = opts.maxSteps ?? 50_000;
  let totalSteps = 0;

  const topFrame = (): StackFrame => state.frames[state.frames.length - 1];

  const markStep = function* (el: Element, diagramId: string, waitingIds?: string[]): Generator<ExecEvent, void, string | undefined> {
    totalSteps++;
    if (totalSteps > maxSteps) {
      throw new RuntimeError(`Maximum execution step limit (${maxSteps}) exceeded (possible infinite loop).`, el.id, diagramId);
    }
    state.execCounts.set(el.id, (state.execCounts.get(el.id) ?? 0) + 1);
    state.covered.add(el.id);
    yield { t: 'step', elementId: el.id, diagramId, kind: el.kind, waitingIds };
  };

  const getVar = (name: string): RuntimeVal => {
    const f = topFrame();
    if (f.vars.has(name)) return f.vars.get(name)!;
    // Check case-insensitive match if diagram ignoreCase is active, or check bottom/global frame
    const globalFrame = state.frames[0];
    if (globalFrame && globalFrame.vars.has(name)) return globalFrame.vars.get(name)!;
    if (name.toLowerCase() === 'pi') return Math.PI;
    if (name.toLowerCase() === 'e') return Math.E;
    return 0;
  };

  /** A record type definition by name (exact, else ignoring case). */
  const findTypeDef = (name: string): { name: string; fields: { name: string; type: TypeInfo }[] } | null => {
    const exact = state.typeDefs.get(name);
    if (exact) return { name, fields: exact };
    for (const [n, fields] of state.typeDefs) if (n.toLowerCase() === name.toLowerCase()) return { name: n, fields };
    return null;
  };

  /** Default value of a declared variable; a record type gets its components (var d: Date). */
  const defaultFor = (t: TypeInfo): RuntimeVal => {
    const rec = t.name && !t.array ? findTypeDef(t.name) : null;
    if (!rec) return defaultForType(t);
    const obj: RecordObj = {};
    for (const c of rec.fields) obj[c.name] = defaultForType(c.type);
    return tagRecord(obj, rec.name);
  };

  /** `var d: Date` and then `d <- {2026, 11, 23}`: the anonymous list fills the components in order. */
  const asDeclaredRecord = (val: RuntimeVal, t: TypeInfo | undefined, elementId: string): RuntimeVal => {
    if (!t?.name || t.array || !Array.isArray(val)) return val;
    const rec = findTypeDef(t.name);
    if (!rec) return val;
    const obj: RecordObj = {};
    rec.fields.forEach((c, i) => { obj[c.name] = i < val.length ? coerceToType(val[i], c.type, elementId) : defaultForType(c.type); });
    return tagRecord(obj, rec.name);
  };

  const setVar = (name: string, val: RuntimeVal, elementId: string, decl?: TypeInfo, isConst?: boolean) => {
    const f = topFrame();
    if (f.consts.has(name) && !decl && !isConst) {
      throw new RuntimeError(`Cannot reassign constant "${name}"`, elementId, f.diagramId);
    }
    if (decl && (decl.base !== 'unknown' || decl.name)) f.types.set(name, decl);
    if (isConst) f.consts.add(name);
    const t = f.types.get(name);
    const coerced = coerceToType(asDeclaredRecord(val, t, elementId), t, elementId);
    f.vars.set(name, coerced);
  };

  const readLValue = function* (lv: LValue, elId: string, k: Keywords): Generator<ExecEvent, RuntimeVal, string | undefined> {
    if (lv.t === 'var') return getVar(lv.name);
    if (lv.t === 'index') {
      const container = yield* readLValue(lv.target, elId, k);
      const idxVal = yield* evalExpr(lv.index, elId, k);
      const idx = Math.trunc(Number(idxVal));
      if (Array.isArray(container)) return container[idx] ?? null;
      if (typeof container === 'string') return container[idx] ?? '';
      throw new RuntimeError(`Target is not indexable`, elId, topFrame().diagramId);
    }
    const container = yield* readLValue(lv.target, elId, k);
    if (container && typeof container === 'object' && !Array.isArray(container)) {
      return container[lv.field] ?? null;
    }
    throw new RuntimeError(`Cannot read field ".${lv.field}" of non-record value`, elId, topFrame().diagramId);
  };

  const writeLValue = function* (
    lv: LValue,
    val: RuntimeVal,
    elId: string,
    k: Keywords,
    decl?: TypeInfo,
    isConst?: boolean,
  ): Generator<ExecEvent, void, string | undefined> {
    if (lv.t === 'var') {
      setVar(lv.name, val, elId, decl, isConst);
      return;
    }
    if (lv.t === 'index') {
      let container = yield* readLValue(lv.target, elId, k);
      if (!Array.isArray(container)) {
        container = [];
        yield* writeLValue(lv.target, container, elId, k);
      }
      const idxVal = yield* evalExpr(lv.index, elId, k);
      const idx = Math.trunc(Number(idxVal));
      if (idx < 0) throw new RuntimeError(`Negative array index ${idx}`, elId, topFrame().diagramId);
      while (container.length <= idx) container.push(0);
      container[idx] = val;
      return;
    }
    let container = yield* readLValue(lv.target, elId, k);
    if (!container || typeof container !== 'object' || Array.isArray(container)) {
      container = {};
      yield* writeLValue(lv.target, container, elId, k);
    }
    container[lv.field] = val;
  };

  const findSubroutine = (name: string, argc: number, ignoreCase: boolean): Diagram | undefined => {
    const eq = (a: string, b: string) => (ignoreCase ? a.toLowerCase() === b.toLowerCase() : a === b);
    return pool.find((d) => {
      if (d.diagramType !== 'sub') return false;
      const sig = parseSignature(d);
      const minArgs = sig.params.filter((p) => p.def === undefined).length;
      return eq(sig.name, name) && argc >= minArgs && argc <= sig.params.length;
    });
  };

  const evalCall = function* (
    name: string,
    argExprs: Expr[],
    elId: string,
    k: Keywords,
  ): Generator<ExecEvent, RuntimeVal, string | undefined> {
    const low = name.trim().toLowerCase();

    // Special mutating procedures inc(v[, d]), dec(v[, d]), insert(sub, s, pos), delete(s, pos, count)
    if ((low === 'inc' || low === 'dec') && argExprs.length >= 1) {
      const lv = exprToLValue(argExprs[0]);
      const cur = Number(yield* readLValue(lv, elId, k));
      const delta = argExprs[1] ? Number(yield* evalExpr(argExprs[1], elId, k)) : 1;
      const next = low === 'inc' ? cur + delta : cur - delta;
      yield* writeLValue(lv, next, elId, k);
      return next;
    }

    const args: RuntimeVal[] = [];
    for (const a of argExprs) args.push(yield* evalExpr(a, elId, k));

    // Check Turtleizer routines first
    const turtleRes = execTurtleRoutine(state.turtle, name, args);
    if (turtleRes.handled) return turtleRes.result;

    const num = (i: number) => {
      const n = Number(args[i]);
      if (!Number.isFinite(n)) throw new RuntimeError(`Expected numeric argument ${i + 1} in ${name}()`, elId, topFrame().diagramId);
      return n;
    };

    switch (low) {
      case 'abs': return Math.abs(num(0));
      case 'sgn': return Math.sign(num(0));
      case 'sqrt': {
        const v = num(0);
        if (v < 0) throw new RuntimeError(`sqrt() of negative number ${v}`, elId, topFrame().diagramId);
        return Math.sqrt(v);
      }
      case 'sqr': { const v = num(0); return v * v; }
      case 'pow': return Math.pow(num(0), num(1));
      case 'exp': return Math.exp(num(0));
      case 'log': return Math.log(num(0));
      case 'sin': return Math.sin(num(0));
      case 'cos': return Math.cos(num(0));
      case 'tan': return Math.tan(num(0));
      case 'asin': return Math.asin(num(0));
      case 'acos': return Math.acos(num(0));
      case 'atan': return Math.atan(num(0));
      case 'toradians': return (num(0) * Math.PI) / 180;
      case 'todegrees': return (num(0) * 180) / Math.PI;
      case 'floor': return Math.floor(num(0));
      case 'ceil': return Math.ceil(num(0));
      case 'round': return Math.round(num(0));
      case 'min': return args.length === 1 && Array.isArray(args[0])
        ? Math.min(...args[0].map(Number))
        : Math.min(...args.map(Number));
      case 'max': return args.length === 1 && Array.isArray(args[0])
        ? Math.max(...args[0].map(Number))
        : Math.max(...args.map(Number));
      case 'random': {
        const bound = Math.max(1, Math.trunc(num(0)));
        return Math.floor(Math.random() * bound);
      }
      case 'randomize': return null;
      case 'length':
      case 'len':
      case 'count': {
        const v = args[0];
        if (Array.isArray(v) || typeof v === 'string') return v.length;
        return 0;
      }
      case 'lowercase':
      case 'tolower': return formatValue(args[0] ?? '').toLowerCase();
      case 'uppercase':
      case 'toupper': return formatValue(args[0] ?? '').toUpperCase();
      case 'trim': return formatValue(args[0] ?? '').trim();
      case 'pos': {
        // Pascal/Structorizer pos(sub, str): 1-based index, 0 if not found
        const sub = formatValue(args[0] ?? '');
        const str = formatValue(args[1] ?? '');
        const idx = str.indexOf(sub);
        return idx >= 0 ? idx + 1 : 0;
      }
      case 'copy':
      case 'substring': {
        // copy(str, start1Based, count)
        const str = formatValue(args[0] ?? '');
        const start = Math.max(1, Math.trunc(num(1))) - 1;
        const count = args[2] !== undefined ? Math.max(0, Math.trunc(num(2))) : str.length - start;
        return str.slice(start, start + count);
      }
      case 'ord': return formatValue(args[0] ?? '').charCodeAt(0) || 0;
      case 'chr': return String.fromCharCode(Math.trunc(num(0)));
      case 'strtoint':
      case 'int':
      case 'parseint': {
        const s = formatValue(args[0] ?? '').trim();
        const parsed = parseInt(s, 10);
        if (!Number.isFinite(parsed)) {
          if (args[1] !== undefined) return Math.trunc(num(1));
          throw new RuntimeError(`Cannot convert "${s}" to int`, elId, topFrame().diagramId);
        }
        return parsed;
      }
      case 'strtodouble':
      case 'strtofloat':
      case 'float':
      case 'parsedouble': {
        const s = formatValue(args[0] ?? '').trim();
        const parsed = parseFloat(s);
        if (!Number.isFinite(parsed)) {
          if (args[1] !== undefined) return num(1);
          throw new RuntimeError(`Cannot convert "${s}" to double`, elId, topFrame().diagramId);
        }
        return parsed;
      }
      case 'strtobool': return /^(true|1|yes|ja)$/i.test(formatValue(args[0] ?? '').trim());
      case 'inttostr':
      case 'doubletostr':
      case 'str':
      case 'tostring': return formatValue(args[0] ?? '');
      case 'isarray': return Array.isArray(args[0]);
      case 'ischar': return typeof args[0] === 'string' && args[0].length === 1;
      case 'isbool': return typeof args[0] === 'boolean';
      case 'isnumber': return typeof args[0] === 'number' && Number.isFinite(args[0]);
      case 'isstring': return typeof args[0] === 'string';
    }

    // Look up subroutine in the open diagram pool (P2-08)
    const sub = findSubroutine(name, args.length, k.ignoreCase);
    if (sub) {
      return yield* runDiagramRoutine(sub, args);
    }

    // If an undefined subroutine procedure is called in a pedagogical diagram (e.g. `brewEspresso()`),
    // record it in the console instead of crashing unless it is a known error.
    return null;
  };

  const evalExpr = function* (
    expr: Expr,
    elId: string,
    k: Keywords,
  ): Generator<ExecEvent, RuntimeVal, string | undefined> {
    switch (expr.t) {
      case 'num': return expr.v;
      case 'str': return expr.v;
      case 'bool': return expr.v;
      case 'null': return null;
      case 'id': return getVar(expr.name);
      case 'array': {
        const items: RuntimeVal[] = [];
        for (const it of expr.items) items.push(yield* evalExpr(it, elId, k));
        return items;
      }
      case 'record': {
        const typed = expr.typeName ? findTypeDef(expr.typeName) : null;
        if (expr.typeName && !typed) {
          throw new RuntimeError(`Unknown record type "${expr.typeName}"`, elId, topFrame().diagramId);
        }
        const def = typed?.fields;
        const obj: RecordObj = {};
        if (def) for (const f of def) obj[f.name] = defaultForType(f.type);
        // "smart" initializer: values without component name fill the components in declaration
        // order; from the first named component on, unnamed values are ignored (user guide) and
        // not even evaluated (desktop Executor.evaluateRecordInitializer)
        let named = false;
        let posIdx = 0;
        for (const f of expr.fields) {
          if (!f.name && (named || (def && posIdx >= def.length))) { posIdx++; continue; }
          const comp = def ? (f.name ? def.find((c) => c.name === f.name) : def[posIdx]) : undefined;
          if (def && f.name && !comp) {
            throw new RuntimeError(`Record type "${typed!.name}" has no component "${f.name}"`, elId, topFrame().diagramId);
          }
          const v = yield* evalExpr(f.value, elId, k);
          const name = f.name || comp?.name;
          if (f.name) named = true; else posIdx++;
          if (name) obj[name] = comp ? coerceToType(v, comp.type, elId) : v;
        }
        return typed ? tagRecord(obj, typed.name) : obj;
      }
      case 'unary': {
        const v = yield* evalExpr(expr.arg, elId, k);
        if (expr.op === '-') return -Number(v);
        if (expr.op === '+') return +Number(v);
        if (expr.op === '~') return ~Math.trunc(Number(v));
        return !isTruthy(v);
      }
      case 'index': {
        const target = yield* evalExpr(expr.target, elId, k);
        const idx = Math.trunc(Number(yield* evalExpr(expr.index, elId, k)));
        if (Array.isArray(target)) {
          if (idx < 0 || idx >= target.length) {
            throw new RuntimeError(`Array index ${idx} out of bounds (length ${target.length})`, elId, topFrame().diagramId);
          }
          return target[idx];
        }
        if (typeof target === 'string') return target[idx] ?? '';
        throw new RuntimeError(`Cannot index non-array value`, elId, topFrame().diagramId);
      }
      case 'member': {
        const target = yield* evalExpr(expr.target, elId, k);
        if (Array.isArray(target) && expr.field === 'length') return target.length;
        if (typeof target === 'string' && expr.field === 'length') return target.length;
        if (target && typeof target === 'object' && !Array.isArray(target)) return target[expr.field] ?? null;
        throw new RuntimeError(`Cannot access field ".${expr.field}" on ${formatValue(target)}`, elId, topFrame().diagramId);
      }
      case 'call':
        return yield* evalCall(expr.name, expr.args, elId, k);
      case 'binary': {
        const op = expr.op;
        if (op === '||' || op === 'or') {
          const l = yield* evalExpr(expr.left, elId, k);
          if (isTruthy(l)) return true;
          return isTruthy(yield* evalExpr(expr.right, elId, k));
        }
        if (op === '&&' || op === 'and') {
          const l = yield* evalExpr(expr.left, elId, k);
          if (!isTruthy(l)) return false;
          return isTruthy(yield* evalExpr(expr.right, elId, k));
        }
        const l = yield* evalExpr(expr.left, elId, k);
        const r = yield* evalExpr(expr.right, elId, k);
        switch (op) {
          case '^^':
          case 'xor':
            if (typeof l === 'number' && typeof r === 'number') return Math.trunc(l) ^ Math.trunc(r);
            return isTruthy(l) !== isTruthy(r);
          case '|': return Math.trunc(Number(l)) | Math.trunc(Number(r));
          case '^': return Math.trunc(Number(l)) ^ Math.trunc(Number(r));
          case '&': return Math.trunc(Number(l)) & Math.trunc(Number(r));
          case '<<':
          case 'shl': return Math.trunc(Number(l)) << Math.trunc(Number(r));
          case '>>':
          case 'shr': return Math.trunc(Number(l)) >> Math.trunc(Number(r));
          case '=':
          case '==': return valuesEqual(l, r);
          case '<>':
          case '!=': return !valuesEqual(l, r);
          case '<': return typeof l === 'string' && typeof r === 'string' ? l < r : Number(l) < Number(r);
          case '<=': return typeof l === 'string' && typeof r === 'string' ? l <= r : Number(l) <= Number(r);
          case '>': return typeof l === 'string' && typeof r === 'string' ? l > r : Number(l) > Number(r);
          case '>=': return typeof l === 'string' && typeof r === 'string' ? l >= r : Number(l) >= Number(r);
          case 'in':
            if (Array.isArray(r)) return r.some((item) => valuesEqual(l, item));
            if (typeof r === 'string') return r.includes(formatValue(l));
            return false;
          case '+':
            if (typeof l === 'string' || typeof r === 'string') return formatValue(l) + formatValue(r);
            return Number(l) + Number(r);
          case '-': return Number(l) - Number(r);
          case '*': return Number(l) * Number(r);
          case '/': {
            const denom = Number(r);
            if (denom === 0) throw new RuntimeError('Division by zero', elId, topFrame().diagramId);
            return Number(l) / denom;
          }
          case 'div': {
            const denom = Math.trunc(Number(r));
            if (denom === 0) throw new RuntimeError('Integer division by zero (div)', elId, topFrame().diagramId);
            return Math.trunc(Number(l) / denom);
          }
          case '%':
          case 'mod': {
            const denom = Number(r);
            if (denom === 0) throw new RuntimeError('Modulo by zero', elId, topFrame().diagramId);
            return Number(l) % denom;
          }
          default:
            return 0;
        }
      }
    }
  };

  const execStmt = function* (
    stmt: StmtNode,
    elId: string,
    diagramId: string,
    k: Keywords,
  ): Generator<ExecEvent, Signal, string | undefined> {
    switch (stmt.t) {
      case 'empty': return { s: 'none' };
      case 'typedef':
        state.typeDefs.set(stmt.name, stmt.fields);
        return { s: 'none' };
      case 'decl':
        for (const name of stmt.names) {
          setVar(name, defaultFor(stmt.type), elId, stmt.type, stmt.isConst);
        }
        return { s: 'none' };
      case 'assign': {
        const val = yield* evalExpr(stmt.expr, elId, k);
        yield* writeLValue(stmt.target, val, elId, k, stmt.decl, stmt.isConst);
        return { s: 'none' };
      }
      case 'input': {
        for (let i = 0; i < stmt.targets.length; i++) {
          const targetLv = stmt.targets[i];
          const rawTarget = stmt.rawTargets[i] ?? 'value';
          const prompt = (i === 0 && stmt.prompt) ? stmt.prompt : `${rawTarget}: `;
          let rawInput: string | undefined;
          if (inputQueue.length > 0) {
            rawInput = inputQueue.shift();
          } else {
            rawInput = yield { t: 'input', elementId: elId, diagramId, prompt, target: rawTarget };
          }
          const expectedType = targetLv.t === 'var' ? topFrame().types.get(targetLv.name) : undefined;
          const parsed = parseInputString(rawInput ?? '0', expectedType, elId);
          yield* writeLValue(targetLv, parsed, elId, k);
        }
        return { s: 'none' };
      }
      case 'output': {
        const parts: string[] = [];
        for (const e of stmt.exprs) parts.push(formatValue(yield* evalExpr(e, elId, k)));
        const text = parts.join('');
        state.outputs.push(text);
        yield { t: 'output', elementId: elId, diagramId, text };
        return { s: 'none' };
      }
      case 'call':
        yield* evalCall(stmt.name, stmt.args, elId, k);
        return { s: 'none' };
      case 'return': {
        const val = stmt.expr ? yield* evalExpr(stmt.expr, elId, k) : undefined;
        return { s: 'return', value: val };
      }
      case 'leave':
        return { s: 'leave', levels: stmt.levels };
      case 'exit': {
        const code = stmt.expr ? Math.trunc(Number(yield* evalExpr(stmt.expr, elId, k))) : 0;
        return { s: 'exit', code };
      }
      case 'throw': {
        const msg = stmt.expr ? formatValue(yield* evalExpr(stmt.expr, elId, k)) : 'Exception';
        return { s: 'throw', error: msg, elementId: elId };
      }
    }
  };

  const execElement = function* (
    el: Element,
    diagram: Diagram,
    inParallel = false,
  ): Generator<ExecEvent, Signal, string | undefined> {
    if (el.disabled) return { s: 'none' };
    const k = diagram.keywords;
    const dId = diagram.id;
    yield* markStep(el, dId);

    try {
      switch (el.kind) {
        case 'instruction':
        case 'call':
        case 'jump': {
          const ast = getElementAst(el, k);
          for (const st of ast.stmts) {
            const sig = yield* execStmt(st, el.id, dId, k);
            if (sig.s !== 'none') {
              if (inParallel && sig.s === 'leave') {
                throw new RuntimeError('Cannot leave a loop across a parallel section boundary', el.id, dId);
              }
              return sig;
            }
          }
          return { s: 'none' };
        }
        case 'alternative': {
          const ast = getElementAst(el, k);
          const cond = ast.condition ? yield* evalExpr(ast.condition, el.id, k) : false;
          const branch = isTruthy(cond) ? el.thenBranch : el.elseBranch;
          return yield* execSeq(branch, diagram, inParallel);
        }
        case 'case': {
          const info = caseInfo(el.text, k);
          const discr = yield* evalExpr(parseExpr(info.discriminator), el.id, k);
          for (const b of info.branches) {
            if (b.values === null) {
              return yield* execSeq(el.branches[b.index] ?? [], diagram, inParallel);
            }
            for (const vRaw of b.values) {
              const vVal = yield* evalExpr(parseExpr(vRaw), el.id, k);
              if (valuesEqual(discr, vVal)) {
                return yield* execSeq(el.branches[b.index] ?? [], diagram, inParallel);
              }
            }
          }
          return { s: 'none' };
        }
        case 'for': {
          const fi = forInfo(el as For, k);
          if (fi.style === 'TRAVERSAL') {
            const listVal = yield* evalExpr(parseExpr(fi.list), el.id, k);
            const items: RuntimeVal[] = Array.isArray(listVal)
              ? listVal
              : typeof listVal === 'string'
                ? [...listVal]
                : [];
            for (const item of items) {
              setVar(fi.var, item, el.id);
              const sig = yield* execSeq(el.body, diagram, inParallel);
              if (sig.s === 'leave') {
                if (sig.levels > 1) return { s: 'leave', levels: sig.levels - 1 };
                break;
              }
              if (sig.s !== 'none') return sig;
              // back to the loop head for the next item: counted like WHILE (coverage, step highlight)
              yield* markStep(el, dId);
            }
            return { s: 'none' };
          }
          const start = Math.trunc(Number(yield* evalExpr(parseExpr(fi.start || '0'), el.id, k)));
          const step = fi.step || 1;
          setVar(fi.var, start, el.id, { base: 'int', array: false });
          while (true) {
            const cur = Number(getVar(fi.var));
            const end = Number(yield* evalExpr(parseExpr(fi.end || '0'), el.id, k));
            if (step >= 0 ? cur > end : cur < end) break;
            const sig = yield* execSeq(el.body, diagram, inParallel);
            if (sig.s === 'leave') {
              if (sig.levels > 1) return { s: 'leave', levels: sig.levels - 1 };
              break;
            }
            if (sig.s !== 'none') return sig;
            yield* markStep(el, dId);
            setVar(fi.var, Number(getVar(fi.var)) + step, el.id);
          }
          return { s: 'none' };
        }
        case 'while': {
          const ast = getElementAst(el, k);
          while (true) {
            const cond = ast.condition ? yield* evalExpr(ast.condition, el.id, k) : false;
            if (!isTruthy(cond)) break;
            const sig = yield* execSeq(el.body, diagram, inParallel);
            if (sig.s === 'leave') {
              if (sig.levels > 1) return { s: 'leave', levels: sig.levels - 1 };
              break;
            }
            if (sig.s !== 'none') return sig;
            yield* markStep(el, dId);
          }
          return { s: 'none' };
        }
        case 'repeat': {
          const ast = getElementAst(el, k);
          while (true) {
            const sig = yield* execSeq(el.body, diagram, inParallel);
            if (sig.s === 'leave') {
              if (sig.levels > 1) return { s: 'leave', levels: sig.levels - 1 };
              break;
            }
            if (sig.s !== 'none') return sig;
            yield* markStep(el, dId);
            const cond = ast.condition ? yield* evalExpr(ast.condition, el.id, k) : true;
            if (isTruthy(cond)) break;
          }
          return { s: 'none' };
        }
        case 'forever': {
          while (true) {
            const sig = yield* execSeq(el.body, diagram, inParallel);
            if (sig.s === 'leave') {
              if (sig.levels > 1) return { s: 'leave', levels: sig.levels - 1 };
              break;
            }
            if (sig.s !== 'none') return sig;
            yield* markStep(el, dId);
          }
          return { s: 'none' };
        }
        case 'parallel': {
          // Interleave top-level elements across branches (Structorizer Desktop semantics)
          const cursors = el.branches.map((b) => ({ seq: b, index: 0 }));
          while (cursors.some((c) => c.index < c.seq.length)) {
            const active = cursors.filter((c) => c.index < c.seq.length);
            const pick = active[0]; // deterministic interleaving (round-robin first unfinished)
            const nextEl = pick.seq[pick.index++];
            const sig = yield* execElement(nextEl, diagram, true);
            if (sig.s !== 'none') return sig;
          }
          return { s: 'none' };
        }
        case 'try': {
          let pending: Signal = { s: 'none' };
          try {
            pending = yield* execSeq(el.tryBody, diagram, inParallel);
          } catch (err) {
            if (err instanceof RuntimeError) {
              pending = { s: 'throw', error: err.message, elementId: err.elementId };
            } else {
              throw err;
            }
          }
          if (pending.s === 'throw') {
            const catchVar = el.text[0]?.trim() || 'ex';
            setVar(catchVar, pending.error, el.id, { base: 'string', array: false });
            pending = yield* execSeq(el.catchBody, diagram, inParallel);
          }
          if (el.finallyBody.length > 0) {
            const finSig = yield* execSeq(el.finallyBody, diagram, inParallel);
            if (finSig.s !== 'none') pending = finSig;
          }
          return pending;
        }
      }
    } catch (err) {
      if (err instanceof RuntimeError) throw err;
      throw new RuntimeError((err as Error).message, el.id, dId);
    }
  };

  function* execSeq(
    seq: Element[],
    diagram: Diagram,
    inParallel = false,
  ): Generator<ExecEvent, Signal, string | undefined> {
    for (const el of seq) {
      const sig = yield* execElement(el, diagram, inParallel);
      if (sig.s !== 'none') return sig;
    }
    return { s: 'none' };
  }

  function* runIncludables(diagram: Diagram): Generator<ExecEvent, void, string | undefined> {
    for (const incName of diagram.includeList) {
      if (state.includedDone.has(incName)) continue;
      state.includedDone.add(incName);
      const inc = pool.find(
        (d) => d.diagramType === 'includable' && parseSignature(d).name.toLowerCase() === incName.toLowerCase(),
      );
      if (inc) {
        yield* execSeq(inc.children, inc, false);
      }
    }
  }

  function* runDiagramRoutine(
    diagram: Diagram,
    callArgs: RuntimeVal[],
  ): Generator<ExecEvent, RuntimeVal, string | undefined> {
    const sig = parseSignature(diagram);
    const frame: StackFrame = {
      diagramId: diagram.id,
      name: sig.name,
      vars: new Map(),
      types: new Map(),
      consts: new Set(),
      resultVar: diagram.diagramType === 'sub' ? resultVariable(diagram, sig.name) : null,
    };
    state.frames.push(frame);
    try {
      for (let i = 0; i < sig.params.length; i++) {
        const p = sig.params[i];
        const val = i < callArgs.length
          ? callArgs[i]
          : p.def !== undefined
            ? yield* evalExpr(parseExpr(p.def), diagram.id, diagram.keywords)
            : defaultForType(p.type);
        frame.types.set(p.name, p.type);
        frame.vars.set(p.name, coerceToType(val, p.type, diagram.id));
      }
      yield* runIncludables(diagram);
      const resSig = yield* execSeq(diagram.children, diagram, false);
      if (resSig.s === 'return') {
        if (resSig.value !== undefined) return resSig.value;
        if (frame.resultVar && frame.vars.has(frame.resultVar)) return frame.vars.get(frame.resultVar)!;
        return null;
      }
      if (resSig.s === 'throw') {
        throw new RuntimeError(resSig.error, resSig.elementId, diagram.id);
      }
      if (resSig.s === 'exit') {
        return resSig.code;
      }
      if (frame.resultVar && frame.vars.has(frame.resultVar)) {
        return frame.vars.get(frame.resultVar)!;
      }
      return null;
    } finally {
      // Keep the root frame visible after completion so the user can inspect final variables in the watch table!
      if (state.frames.length > 1) {
        state.frames.pop();
      }
    }
  }

  const returnValue = yield* runDiagramRoutine(mainDiagram, opts.args ?? []);
  return {
    returnValue,
    outputs: state.outputs,
    execCounts: state.execCounts,
    covered: state.covered,
    turtle: state.turtle,
  };
}
