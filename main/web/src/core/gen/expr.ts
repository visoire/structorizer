// SPDX-License-Identifier: GPL-3.0-or-later
// AST and token-assisted translation of Structorizer expressions into target languages (P2-10).
import { tokenize, type Tok } from '../lang/lexer';
import { parseExpr, type Expr } from '../lang/parser';

export type LangId = 'python' | 'java' | 'javascript' | 'c' | 'cpp' | 'csharp' | 'pascal' | 'php' | 'bash';

export interface ExprCtx {
  lang: LangId;
  imports: Set<string>;
  /** element type hint for Java / C# array literals */
  arrayType?: string;
}

type Tpl = (a: string[]) => string;
const fn = (name: string): Tpl => (a) => `${name}(${a.join(', ')})`;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const math = (n: string): Record<LangId, Tpl> => ({
  python: (a) => `math.${n}(${a.join(', ')})`,
  java: fn(`Math.${n}`), javascript: fn(`Math.${n}`),
  c: fn(n), cpp: fn(`std::${n}`),
  csharp: fn(`Math.${n === 'ceil' ? 'Ceiling' : cap(n)}`),
  pascal: fn(n === 'log' ? 'ln' : n === 'pow' ? 'power' : n),
  php: fn(n), bash: fn(n),
});

const BUILTINS: Record<string, Record<LangId, Tpl>> = {
  sqrt: math('sqrt'), sin: math('sin'), cos: math('cos'), tan: math('tan'), exp: math('exp'), log: math('log'),
  floor: math('floor'), ceil: math('ceil'), pow: math('pow'),
  abs: { python: fn('abs'), java: fn('Math.abs'), javascript: fn('Math.abs'), c: fn('abs'), cpp: fn('std::abs'), csharp: fn('Math.Abs'), pascal: fn('abs'), php: fn('abs'), bash: (a) => `(${a[0]} < 0 ? -(${a[0]}) : ${a[0]})` },
  round: { python: fn('round'), java: fn('Math.round'), javascript: fn('Math.round'), c: fn('round'), cpp: fn('std::round'), csharp: fn('Math.Round'), pascal: fn('round'), php: fn('round'), bash: (a) => a[0] },
  min: { python: fn('min'), java: fn('Math.min'), javascript: fn('Math.min'), c: (a) => `((${a[0]}) < (${a[1]}) ? (${a[0]}) : (${a[1]}))`, cpp: fn('std::min'), csharp: fn('Math.Min'), pascal: fn('Min'), php: fn('min'), bash: (a) => `(${a[0]} < ${a[1]} ? ${a[0]} : ${a[1]})` },
  max: { python: fn('max'), java: fn('Math.max'), javascript: fn('Math.max'), c: (a) => `((${a[0]}) > (${a[1]}) ? (${a[0]}) : (${a[1]}))`, cpp: fn('std::max'), csharp: fn('Math.Max'), pascal: fn('Max'), php: fn('max'), bash: (a) => `(${a[0]} > ${a[1]} ? ${a[0]} : ${a[1]})` },
  random: {
    python: (a) => `random.randrange(${a[0]})`, java: (a) => `(int)(Math.random() * (${a[0]}))`,
    javascript: (a) => `Math.floor(Math.random() * (${a[0]}))`, c: (a) => `(rand() % (${a[0]}))`,
    cpp: (a) => `(std::rand() % (${a[0]}))`, csharp: (a) => `rng.Next(${a[0]})`,
    pascal: (a) => `random(${a[0]})`, php: (a) => `random_int(0, (${a[0]}) - 1)`,
    bash: (a) => `(RANDOM % (${a[0]}))`,
  },
  length: {
    python: (a) => `len(${a[0]})`, java: (a) => `${a[0]}.length()`, javascript: (a) => `${a[0]}.length`,
    c: (a) => `strlen(${a[0]})`, cpp: (a) => `${a[0]}.length()`, csharp: (a) => `${a[0]}.Length`,
    pascal: (a) => `length(${a[0]})`, php: (a) => `strlen(${a[0]})`, bash: (a) => `\${#${a[0].replace(/^\$/, '')}}`,
  },
  uppercase: {
    python: (a) => `${a[0]}.upper()`, java: (a) => `${a[0]}.toUpperCase()`, javascript: (a) => `${a[0]}.toUpperCase()`,
    c: fn('toupper_str'), cpp: fn('toupper_str'), csharp: (a) => `${a[0]}.ToUpper()`,
    pascal: fn('UpCase'), php: fn('strtoupper'), bash: (a) => `\${${a[0]}^^}`,
  },
  lowercase: {
    python: (a) => `${a[0]}.lower()`, java: (a) => `${a[0]}.toLowerCase()`, javascript: (a) => `${a[0]}.toLowerCase()`,
    c: fn('tolower_str'), cpp: fn('tolower_str'), csharp: (a) => `${a[0]}.ToLower()`,
    pascal: fn('LowerCase'), php: fn('strtolower'), bash: (a) => `\${${a[0]},,}`,
  },
  // Turtleizer routines (#1237)
  forward: turtleFn('forward', 'forward'),
  fd: turtleFn('forward', 'forward'),
  backward: turtleFn('backward', 'backward'),
  bk: turtleFn('backward', 'backward'),
  left: turtleFn('left', 'left'),
  rl: turtleFn('left', 'left'),
  right: turtleFn('right', 'right'),
  rr: turtleFn('right', 'right'),
  penup: turtleFn('penup', 'penUp'),
  pendown: turtleFn('pendown', 'penDown'),
  gotoxy: turtleFn('goto', 'gotoXY'),
  gotox: turtleFn('setx', 'gotoX'),
  gotoy: turtleFn('sety', 'gotoY'),
  clear: turtleFn('clear', 'clear'),
  hideturtle: turtleFn('hideturtle', 'hideTurtle'),
  showturtle: turtleFn('showturtle', 'showTurtle'),
  setpencolor: turtleFn('pencolor', 'setPenColor'),
  setbackgroundcolor: turtleFn('bgcolor', 'setBackgroundColor'),
  setpenwidth: turtleFn('pensize', 'setPenWidth'),
  penwidth: turtleFn('pensize', 'setPenWidth'),
  home: turtleFn('home', 'home'),
  setheading: turtleFn('setheading', 'setHeading'),
  seth: turtleFn('setheading', 'setHeading'),
  circle: turtleFn('circle', 'circle'),
  arc: turtleFn('circle', 'arc'),
  writeturtle: turtleFn('write', 'writeTurtle'),
};

function turtleFn(pyName: string, javaName: string): Record<LangId, Tpl> {
  return {
    python: fn(`turtle.${pyName}`),
    java: fn(`Turtleizer.${javaName}`),
    javascript: fn(`turtle.${javaName}`),
    c: fn(javaName),
    cpp: fn(javaName),
    csharp: fn(`Turtleizer.${cap(javaName)}`),
    pascal: fn(javaName),
    php: fn(javaName),
    bash: fn(javaName),
  };
}

const TURTLE_IMPORTS: Record<string, string> = {
  forward: 'turtle', fd: 'turtle', backward: 'turtle', bk: 'turtle',
  left: 'turtle', rl: 'turtle', right: 'turtle', rr: 'turtle',
  penup: 'turtle', pendown: 'turtle', gotoxy: 'turtle', gotox: 'turtle', gotoy: 'turtle',
  clear: 'turtle', hideturtle: 'turtle', showturtle: 'turtle',
  setpencolor: 'turtle', setbackgroundcolor: 'turtle',
  setpenwidth: 'turtle', penwidth: 'turtle', home: 'turtle', setheading: 'turtle', seth: 'turtle',
  circle: 'turtle', arc: 'turtle', writeturtle: 'turtle',
};

const IMPORTS: Partial<Record<LangId, Record<string, string>>> = {
  python: { sqrt: 'math', sin: 'math', cos: 'math', tan: 'math', exp: 'math', log: 'math', floor: 'math', ceil: 'math', pow: 'math', random: 'random', ...TURTLE_IMPORTS },
  c: { sqrt: 'math.h', sin: 'math.h', cos: 'math.h', tan: 'math.h', exp: 'math.h', log: 'math.h', floor: 'math.h', ceil: 'math.h', pow: 'math.h', round: 'math.h', abs: 'stdlib.h', random: 'stdlib.h', length: 'string.h' },
  cpp: { sqrt: 'cmath', sin: 'cmath', cos: 'cmath', tan: 'cmath', exp: 'cmath', log: 'cmath', floor: 'cmath', ceil: 'cmath', pow: 'cmath', abs: 'cmath', round: 'cmath', min: 'algorithm', max: 'algorithm', random: 'cstdlib' },
  pascal: { pow: 'Math', min: 'Math', max: 'Math', lowercase: 'SysUtils' },
};

const C_LIKE = new Set<LangId>(['java', 'javascript', 'c', 'cpp', 'csharp', 'php']);
const PHP_RESERVED = new Set(['true', 'false', 'null', 'PHP_EOL', 'PHP_INT_MAX', 'M_PI']);

function matching(toks: Tok[], open: number): number {
  const o = toks[open].v;
  const c = o === '(' ? ')' : o === '[' ? ']' : '}';
  let depth = 0;
  for (let i = open; i < toks.length; i++) {
    if (toks[i].v === o && toks[i].k === 'punct') depth++;
    else if (toks[i].v === c && toks[i].k === 'punct') { depth--; if (depth === 0) return i; }
  }
  return toks.length - 1;
}

function nextNonWs(toks: Tok[], i: number): number {
  let j = i + 1;
  while (j < toks.length && toks[j].k === 'ws') j++;
  return j;
}

function splitArgs(toks: Tok[]): Tok[][] {
  const out: Tok[][] = [[]];
  let depth = 0;
  for (const t of toks) {
    if (t.k === 'punct' && '([{'.includes(t.v)) depth++;
    if (t.k === 'punct' && ')]}'.includes(t.v)) depth--;
    if (depth === 0 && t.v === ',' && t.k === 'punct') out.push([]);
    else out[out.length - 1].push(t);
  }
  return out;
}

function translateToks(toks: Tok[], ctx: ExprCtx): string {
  const L = ctx.lang;
  let out = '';
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    const v = t.v;
    if (t.k === 'id') {
      const low = v.toLowerCase();
      const ni = nextNonWs(toks, i);
      const isCall = toks[ni]?.v === '(';
      if (isCall) {
        const close = matching(toks, ni);
        const args = splitArgs(toks.slice(ni + 1, close)).map((a) => translateToks(a, ctx).trim()).filter((a, _i, arr) => a !== '' || arr.length > 1);
        const b = BUILTINS[low];
        if (b) {
          const imp = IMPORTS[L]?.[low];
          if (imp) ctx.imports.add(imp);
          out += b[L](args);
        } else {
          out += `${v}(${args.join(', ')})`;
        }
        i = close;
        continue;
      }
      if (low === 'and') { out += L === 'python' || L === 'pascal' ? 'and' : '&&'; continue; }
      if (low === 'or') { out += L === 'python' || L === 'pascal' ? 'or' : '||'; continue; }
      if (low === 'not') {
        if (L === 'python' || L === 'pascal') out += 'not';
        else { out += '!'; if (toks[i + 1]?.k === 'ws') i++; }
        continue;
      }
      if (low === 'xor') { out += L === 'pascal' ? 'xor' : '^'; continue; }
      if (low === 'div') { out += L === 'python' ? '//' : L === 'pascal' ? 'div' : '/'; continue; }
      if (low === 'mod') { out += L === 'pascal' ? 'mod' : '%'; continue; }
      if (low === 'shl') { out += L === 'pascal' ? 'shl' : '<<'; continue; }
      if (low === 'shr') { out += L === 'pascal' ? 'shr' : '>>'; continue; }
      if (low === 'true' || low === 'false') {
        out += L === 'python' ? (low === 'true' ? 'True' : 'False') : L === 'bash' ? (low === 'true' ? '1' : '0') : low;
        continue;
      }
      const prev = out.trimEnd().slice(-1);
      if (L === 'php' && prev !== '.' && prev !== '>' && !PHP_RESERVED.has(v) && !/^[A-Z][A-Z0-9_]+$/.test(v)) { out += '$' + v; continue; }
      out += v;
      continue;
    }
    if (t.k === 'op') {
      if (v === '=') { out += L === 'pascal' ? '=' : '=='; continue; }
      if (v === '<>') { out += L === 'pascal' ? '<>' : '!='; continue; }
      if (v === '<-' || v === ':=') { out += L === 'pascal' ? ':=' : '='; continue; }
      if ((L === 'python' || L === 'pascal') && v === '&&') { out += 'and'; continue; }
      if ((L === 'python' || L === 'pascal') && v === '||') { out += 'or'; continue; }
      if ((L === 'python' || L === 'pascal') && v === '!') { out += 'not '; continue; }
      out += v;
      continue;
    }
    if (t.k === 'str') {
      if ((L === 'java' || L === 'cpp' || L === 'c' || L === 'csharp') && v.startsWith("'") && v.length !== 3 && !(v.length === 4 && v[1] === '\\')) {
        out += '"' + v.slice(1, -1).replace(/"/g, '\\"') + '"';
        continue;
      }
      if (L === 'pascal' && v.startsWith('"')) {
        out += "'" + v.slice(1, -1).replace(/'/g, "''") + "'";
        continue;
      }
      if (L === 'php' && v.startsWith('"')) { out += v.replace(/\$/g, '\\$'); continue; }
      out += v;
      continue;
    }
    if (t.k === 'punct' && v === '{') {
      // array literal
      const close = matching(toks, i);
      const items = splitArgs(toks.slice(i + 1, close)).map((a) => translateToks(a, ctx).trim());
      if (L === 'java') out += `new ${ctx.arrayType ?? guessArrayType(toks.slice(i + 1, close), 'java')}[]{${items.join(', ')}}`;
      else if (L === 'csharp') out += `new ${ctx.arrayType ?? guessArrayType(toks.slice(i + 1, close), 'csharp')}[]{${items.join(', ')}}`;
      else if (L === 'cpp' || L === 'c') out += `{${items.join(', ')}}`;
      else if (L === 'pascal') out += `(${items.join(', ')})`;
      else if (L === 'bash') out += `(${items.join(' ')})`;
      else out += `[${items.join(', ')}]`;
      i = close;
      continue;
    }
    out += v;
  }
  return out;
}

function guessArrayType(toks: Tok[], lang: 'java' | 'csharp' = 'java'): string {
  const first = toks.find((t) => t.k !== 'ws');
  if (!first) return 'int';
  if (first.k === 'str') return lang === 'csharp' ? 'string' : 'String';
  if (first.k === 'num') return /[.eE]/.test(first.v) ? 'double' : 'int';
  if (/^(true|false)$/i.test(first.v)) return lang === 'csharp' ? 'bool' : 'boolean';
  return lang === 'csharp' ? 'object' : 'Object';
}

/** Translate a parsed AST expression node into `ctx.lang` (P2-10). */
export function translateAst(node: Expr, ctx: ExprCtx): string {
  const L = ctx.lang;
  switch (node.t) {
    case 'num': return node.raw;
    case 'bool': return L === 'python' ? (node.v ? 'True' : 'False') : L === 'bash' ? (node.v ? '1' : '0') : String(node.v);
    case 'null': return L === 'python' ? 'None' : L === 'pascal' ? 'nil' : 'null';
    case 'str': return translateToks([{ k: 'str', v: node.raw }], ctx);
    case 'id': return translateToks([{ k: 'id', v: node.name }], ctx);
    case 'unary': {
      const arg = translateAst(node.arg, ctx);
      const wrap = node.arg.t === 'binary' ? `(${arg})` : arg;
      if (node.op === 'not' || node.op === '!') {
        return L === 'python' || L === 'pascal' ? `not ${wrap}` : `!${wrap}`;
      }
      return `${node.op}${wrap}`;
    }
    case 'binary': {
      const l = translateAst(node.left, ctx);
      const r = translateAst(node.right, ctx);
      const op = translateToks([{ k: WORD_OP_SET.has(node.op) ? 'id' : 'op', v: node.op }], ctx).trim();
      return `${l} ${op} ${r}`;
    }
    case 'call': {
      const args = node.args.map((a) => translateAst(a, ctx));
      const low = node.name.toLowerCase();
      const b = BUILTINS[low];
      if (b) {
        const imp = IMPORTS[L]?.[low];
        if (imp) ctx.imports.add(imp);
        return b[L](args);
      }
      return `${node.name}(${args.join(', ')})`;
    }
    case 'index': return `${translateAst(node.target, ctx)}[${translateAst(node.index, ctx)}]`;
    case 'member': return `${translateAst(node.target, ctx)}.${node.field}`;
    case 'array': {
      const items = node.items.map((a) => translateAst(a, ctx));
      if (L === 'java' || L === 'csharp') return `new ${ctx.arrayType ?? 'int'}[]{${items.join(', ')}}`;
      if (L === 'cpp' || L === 'c') return `{${items.join(', ')}}`;
      if (L === 'pascal') return `(${items.join(', ')})`;
      if (L === 'bash') return `(${items.join(' ')})`;
      return `[${items.join(', ')}]`;
    }
    case 'record': {
      // positional ("smart") items have no component name: keep them as plain values
      const entries = node.fields.map((f) => (f.name ? `${JSON.stringify(f.name)}: ` : '') + translateAst(f.value, ctx));
      return `{${entries.join(', ')}}`;
    }
  }
}

const WORD_OP_SET = new Set(['and', 'or', 'not', 'xor', 'div', 'mod', 'shl', 'shr']);

/** Translate one expression of the Structorizer language into `ctx.lang`. */
export function translateExpr(expr: string, ctx: ExprCtx): string {
  return translateToks(tokenize(expr), ctx).trim();
}

/** Literal type of an expression inspected via the AST (for declarations in typed languages, P2-10). */
export function literalType(expr: string): 'int' | 'double' | 'string' | 'bool' | 'char' | 'array' | null {
  const trimmed = expr.trim();
  if (!trimmed) return null;
  const ast = parseExpr(trimmed);
  if (ast.t === 'array') return 'array';
  if (ast.t === 'num') return ast.isInt ? 'int' : 'double';
  if (ast.t === 'str') return ast.isChar ? 'char' : 'string';
  if (ast.t === 'bool') return 'bool';
  if (ast.t === 'unary' && (ast.op === '-' || ast.op === '+') && ast.arg.t === 'num') {
    return ast.arg.isInt ? 'int' : 'double';
  }
  const toks = tokenize(trimmed).filter((t) => t.k !== 'ws');
  if (toks.some((x) => x.k === 'str')) return 'string';
  if (toks.some((x) => x.k === 'num' && /[.eE]/.test(x.v)) || toks.some((x) => x.v === '/')) return 'double';
  if (toks.every((x) => x.k === 'num' || x.k === 'op' || x.v === '(' || x.v === ')' || /^(div|mod)$/i.test(x.v))) return 'int';
  return null;
}

export const isCLike = (l: LangId) => C_LIKE.has(l);
