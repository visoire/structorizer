// @vitest-environment jsdom
// Regression tests for the review of web.10 (fiuxes.md) and the iPad Home Screen tip (web.11).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanComment, createLayoutEngine, fakeMeasure, type Hit } from '../src/core/layout';
import { createDiagram, createElement, insertAt, type Diagram } from '../src/core/model';
import { executeDiagram, typeNameOf } from '../src/core/exec';
import { parseExpr, parseComponentList } from '../src/core/lang/parser';
import { joinContinuedLines } from '../src/core/lang/lexer';
import { generateCode } from '../src/core/gen/generators';
import { sceneToSvg } from '../src/core/render/svg';
import { useStore } from '../src/store/diagramStore';
import { useExecStore } from '../src/store/execStore';
import { commentTipLines } from '../src/ui/DiagramView';
import { safeFileName } from '../src/ui/actions';
import { isAppleTouchDevice, neverAgain, shouldOfferInstall, snoozed, SNOOZE_MS, type InstallEnv } from '../src/ui/installTipRules';

const program = (...lines: string[][]) =>
  insertAt(createDiagram(), { seq: { owner: 'root' }, index: 0 }, ...lines.map((l) => createElement('instruction', l)));
const run = (d: Diagram) => {
  const gen = executeDiagram(d);
  let r = gen.next();
  while (!r.done) r = gen.next();
  return r.value;
};
const texts = (d: Diagram, textMode: 'text' | 'comments' | 'both', extra = {}) =>
  createLayoutEngine(fakeMeasure, { textMode, ...extra }).layout(d).items.filter((i) => i.t === 'text').map((i) => (i as { s: string }).s);
const DATE = 'type Date = record{year: int; month, day: short}';

afterEach(() => { vi.useRealTimers(); });

describe('1 root comment', () => {
  it('blank comment lines neither replace the title nor reserve space', () => {
    expect(cleanComment(['', ' '])).toEqual([]);
    expect(cleanComment(['', 'a', '', 'b', ''])).toEqual(['a', '', 'b']);
    const d = { ...program(['x <- 1']), text: ['Main'], comment: ['', ''] };
    expect(texts(d, 'comments')).toContain('Main');
    const plain = createLayoutEngine(fakeMeasure).layout(d);
    expect(createLayoutEngine(fakeMeasure, { textMode: 'both' }).layout(d).height).toBe(plain.height);
  });

  it('draws a comment mark at the frame and keeps comments free of C operator replacement', () => {
    const d = { ...program(['x <- 1']), text: ['Main'], comment: ['a <- b and c'] };
    const scene = createLayoutEngine(fakeMeasure, { showComments: true }).layout(d);
    expect(scene.items.some((i) => i.t === 'rect' && i.mark && i.x === 2)).toBe(true);
    expect(texts(d, 'comments', { cOperators: true })).toContain('a <- b and c');
    expect(texts(d, 'both', { cOperators: true })).toContain('a <- b and c');
  });
});

describe('2 comment pop-up', () => {
  it('shows the comment, or the hidden text when text and comments are switched', () => {
    const d = { ...program(['x <- 1']), text: ['Main'], comment: ['frame note'] };
    const el = d.children[0];
    const withComment = { ...d, children: [{ ...el, comment: ['note'] }] };
    const hit = { t: 'el', id: el.id, comment: ['note'] } as unknown as Hit;
    const root = { t: 'root' } as unknown as Hit;
    expect(commentTipLines(hit, withComment, true, false)).toEqual(['note']);
    expect(commentTipLines(hit, withComment, true, true)).toEqual(['x <- 1']);
    expect(commentTipLines(root, d, true, false)).toEqual(['frame note']);
    expect(commentTipLines(hit, withComment, false, false)).toEqual([]);
    expect(commentTipLines({ t: 'el', id: el.id, comment: ['', ' '] } as unknown as Hit, d, true, false)).toEqual([]);
  });
});

describe('3 executor stepping', () => {
  it('Run never stops on an OUTPUT, Resume keeps the breakpoint of the next element', () => {
    vi.useFakeTimers();
    const d = program(['OUTPUT 1'], ['x <- 2'], ['y <- 3']);
    useStore.getState().restoreSession([{ diagram: d, fileName: null }], 0);
    const ex = () => useExecStore.getState();
    ex().setSpeed(100);
    ex().toggleBreakpoint(d.children[1].id);
    ex().start('step');
    expect(ex().runningElementId).toBe(d.children[0].id);
    ex().resume();
    vi.advanceTimersByTime(100);
    // after one tick: OUTPUT done and paused on the breakpoint of x <- 2 (not skipped)
    expect(ex().execState.outputs).toEqual(['1']);
    expect(ex().status).toBe('paused');
    expect(ex().runningElementId).toBe(d.children[1].id);
    ex().toggleBreakpoint(d.children[1].id);
    ex().stop();
  });

  it('a FOR head counts every pass like WHILE', () => {
    let d = createDiagram();
    const f = createElement('for', ['for i <- 1 to 3']);
    d = insertAt(d, { seq: { owner: 'root' }, index: 0 }, f);
    d = insertAt(d, { seq: { owner: f.id, slot: 'body' }, index: 0 }, createElement('instruction', ['x <- i']));
    expect(run(d).execCounts.get(f.id)).toBe(4);
  });
});

describe('4 records', () => {
  it('"x = 5" in an initializer is a comparison, not a component name', () => {
    const e = parseExpr('Flags{x = 5, 10}');
    expect(e.t === 'record' && e.fields.map((f) => f.name)).toEqual(['', '']);
    const c = parseExpr('Point{.x = 1, y: 2}');
    expect(c.t === 'record' && c.fields.map((f) => f.name)).toEqual(['x', 'y']);
  });

  it('type definitions: C style lists, brackets and several lines', () => {
    expect(parseComponentList('int year; short month, day').map((f) => f.name)).toEqual(['year', 'month', 'day']);
    expect(parseComponentList('m: array[2,3] of int; s: string').map((f) => f.name)).toEqual(['m', 's']);
    expect(parseComponentList('x: int, y: int').map((f) => f.name)).toEqual(['x', 'y']);
    expect(joinContinuedLines(['type Date = record {', 'year: int;', 'month: int', '}', 'x <- 1'])).toHaveLength(2);
    const d = program(['type Date = record {', '  year: int;', '  month, day: short', '}', 'd <- Date{2026, 11, 23}', 'OUTPUT d.day']);
    expect(run(d).outputs).toEqual(['23']);
  });

  it('errors, conversion, no evaluation of dropped values, declared record variables, type name', () => {
    expect(() => run(program([DATE], ['d <- Dat{2026, 11, 23}']))).toThrow(/Unknown record type/);
    expect(() => run(program([DATE], ['d <- Date{yea: 2026}']))).toThrow(/no component "yea"/);
    expect(run(program([DATE], ['d <- Date{2026.9, 11, 23}'], ['OUTPUT d.year'])).outputs).toEqual(['2026']);
    // the dropped value would fail if it were evaluated
    expect(run(program([DATE], ['d <- Date{month: 4, nosuchfn(1) + undefinedvar[3]}'], ['OUTPUT d.month'])).outputs).toEqual(['4']);
    const res = run(program([DATE], ['var d: Date'], ['d <- {2026, 11, 23}'], ['OUTPUT d.month']));
    expect(res.outputs).toEqual(['11']);
  });

  it('typeNameOf shows the record type', () => {
    expect(typeNameOf({ year: 1 })).toBe('record');
    expect(typeNameOf(null, { base: 'unknown', array: false, name: 'Date' })).toBe('Date');
  });
  it('code generators translate Date{2026, 11, 23} with the known components', () => {
    const d = program([DATE], ['today <- Date{2026, 11, 23}']);
    const code = (l: Parameters<typeof generateCode>[1]) => generateCode(d, l, {}).code;
    expect(code('python')).toContain('today = {"year": 2026, "month": 11, "day": 23}');
    expect(code('javascript')).toContain('{year: 2026, month: 11, day: 23}');
    expect(code('java')).toContain('new Date(2026, 11, 23)');
    expect(code('cpp')).toContain('Date{2026, 11, 23}');
    expect(code('php')).toContain('["year" => 2026, "month" => 11, "day" => 23]');
    expect(code('python')).not.toContain('Date[');
    // the variable is declared with the record type, not guessed as double
    expect(code('java')).toMatch(/\bDate today\b/);
    expect(code('csharp')).toMatch(/\bDate today\b/);
    expect(code('c')).toMatch(/\bDate today;/);
  });
});

describe('6 zoomed out', () => {
  it('no clipped frame, thin marks and hatching widened, crisp edges only on straight shapes', () => {
    const d = { ...program(['x <- 1']), comment: ['c'] };
    let alt = createElement('alternative', ['a > b']);
    alt = { ...alt, comment: ['why'] };
    const scene = createLayoutEngine(fakeMeasure).layout(insertAt(d, { seq: { owner: 'root' }, index: 1 }, alt));
    const half = sceneToSvg(scene, { scale: 0.5 });
    expect(half).toContain('overflow="visible"');
    expect(half).toMatch(/<line x1="0" y1="0" x2="0" y2="8" stroke="[^"]+" stroke-width="3"/);
    expect(half).toMatch(/width="3" height="[\d.]+" shape-rendering="crispEdges" fill="#c0c0c0"/);
    const one = sceneToSvg(scene, { scale: 1 });
    expect(one).not.toContain('overflow="visible"');
    expect(one).not.toMatch(/<g[^>]*shape-rendering/);
    expect(sceneToSvg(scene, { scale: 0 })).toContain('stroke-width="1"');
  });
});

describe('7 groups', () => {
  const st = () => useStore.getState();
  const sub = (name: string) => ({ ...createDiagram('sub'), text: [`${name}()`] });

  it('auto layout keeps every group in its own block, positions survive the session', () => {
    st().restoreSession([{ diagram: program(['a <- 1']), fileName: 'main.nsd' }], 0);
    st().openArrz([{ diagram: sub('f'), x: 10, y: 10, fileName: 'f.nsd' }, { diagram: sub('g'), x: 300, y: 10, fileName: 'g.nsd' }], 'Lib');
    // the label of the group needs room above the cards
    expect(Math.min(...st().allDocs().filter((d) => st().groups[d.id]).map((d) => d.y ?? 0))).toBeGreaterThanOrEqual(40);
    st().autoLayoutDocs();
    const docs = st().allDocs();
    const libY = docs.filter((d) => st().groups[d.id] === 'Lib').map((d) => d.y!);
    const restY = docs.filter((d) => !st().groups[d.id]).map((d) => d.y!);
    expect(Math.min(...restY)).toBeGreaterThan(Math.max(...libY));
    const saved = docs.map((d) => ({ diagram: d.diagram, fileName: d.fileName, group: st().groups[d.id], x: d.x, y: d.y, pinned: d.pinned }));
    st().restoreSession(saved, 0);
    expect(st().allDocs().map((d) => [d.x, d.y])).toEqual(docs.map((d) => [d.x, d.y]));
  });

  it('a rename keeps the collapsed state, outsource keeps the group, file names are safe', () => {
    st().restoreSession([{ diagram: program(['a <- 1'], ['b <- 2']), fileName: 'main.nsd', group: 'A' }], 0);
    st().toggleGroupCollapsed('A');
    st().renameGroup('A', 'B');
    expect(st().groupCollapsed).toEqual({ B: true });
    st().select({ t: 'el', id: st().diagram.children[0].id });
    expect(st().outsource()).toBe(true);
    expect(Object.values(st().groups)).toEqual(['B', 'B']);
    expect(safeFileName('Kurs 10/b: Test?')).toBe('Kurs 10_b_ Test_');
  });
});

describe('iPad Home Screen tip', () => {
  const env = (over: Partial<InstallEnv> = {}): InstallEnv => ({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15',
    platform: 'MacIntel', maxTouchPoints: 5, standalone: false, installable: true, ...over,
  });

  it('only for an iPad or iPhone in a browser tab of an http(s) page', () => {
    expect(isAppleTouchDevice(env())).toBe(true); // iPadOS reports a Mac with touch points
    expect(isAppleTouchDevice(env({ maxTouchPoints: 0 }))).toBe(false); // a real Mac
    expect(isAppleTouchDevice(env({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', platform: 'iPhone' }))).toBe(true);
    expect(shouldOfferInstall(env(), null, 0)).toBe(true);
    expect(shouldOfferInstall(env({ standalone: true }), null, 0)).toBe(false);
    expect(shouldOfferInstall(env({ installable: false }), null, 0)).toBe(false);
  });

  it('"Not now" waits two weeks, "Do not show again" is final', () => {
    const now = 1_000_000;
    expect(shouldOfferInstall(env(), snoozed(now), now + SNOOZE_MS - 1)).toBe(false);
    expect(shouldOfferInstall(env(), snoozed(now), now + SNOOZE_MS)).toBe(true);
    expect(shouldOfferInstall(env(), neverAgain(), now * 1000)).toBe(false);
  });
});
