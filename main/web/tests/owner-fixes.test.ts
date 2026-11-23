// @vitest-environment jsdom
// Regression tests for the issues reported by the desktop maintainer (web.10).
import { describe, expect, it } from 'vitest';
import { createLayoutEngine, fakeMeasure } from '../src/core/layout';
import { createDiagram, createElement, insertAt } from '../src/core/model';
import { executeDiagram } from '../src/core/exec';
import { sceneToSvg } from '../src/core/render/svg';
import { useStore } from '../src/store/diagramStore';
import { useExecStore } from '../src/store/execStore';

const texts = (scene: ReturnType<ReturnType<typeof createLayoutEngine>['layout']>) =>
  scene.items.filter((i) => i.t === 'text').map((i) => (i as { s: string }).s);

function program(...lines: string[][]) {
  let d = createDiagram();
  d = insertAt(d, { seq: { owner: 'root' }, index: 0 }, ...lines.map((l) => createElement('instruction', l)));
  return d;
}

describe('owner report 2026-11-23', () => {
  it('root comment is drawn in "comments plus texts" and replaces the title when switched', () => {
    const d = { ...program(['x <- 1']), text: ['Main'], comment: ['root note'] };
    const plain = createLayoutEngine(fakeMeasure).layout(d);
    const both = createLayoutEngine(fakeMeasure, { textMode: 'both' }).layout(d);
    const sw = createLayoutEngine(fakeMeasure, { textMode: 'comments' }).layout(d);
    expect(texts(plain)).not.toContain('root note');
    expect(texts(both)).toContain('root note');
    expect(texts(both)).toContain('Main');
    expect(both.height).toBeGreaterThan(plain.height);
    expect(texts(sw)).toContain('root note');
    expect(texts(sw)).not.toContain('Main');
  });

  it('smart record initializers fill the components in declaration order', () => {
    const d = program(
      ['type Date = record{year: int; month, day: short}'],
      ['today <- Date{2026, 11, 23}'],
      ['partial <- Date{2026, month: 4, 21}'],
      ['OUTPUT today.year, "-", today.month, "-", today.day'],
    );
    const gen = executeDiagram(d);
    let r = gen.next();
    while (!r.done) r = gen.next();
    expect(r.value.outputs).toEqual(['2026-11-23']);
  });

  it('a positional value after a named component is ignored (user guide rule)', () => {
    const d = program(
      ['type Date = record{year: int; month, day: short}'],
      ['p <- Date{2026, month: 4, 21}'],
      ['OUTPUT p.year, "/", p.month, "/", p.day'],
    );
    const gen = executeDiagram(d);
    let r = gen.next();
    while (!r.done) r = gen.next();
    expect(r.value.outputs).toEqual(['2026/4/0']);
  });

  it('one Step past an OUTPUT element highlights the next element', () => {
    const d = program(['OUTPUT "a"'], ['x <- 2']);
    useStore.getState().restoreSession([{ diagram: d, fileName: null }], 0);
    const ex = useExecStore.getState();
    ex.start('step');
    const first = useExecStore.getState().runningElementId;
    expect(first).toBe(d.children[0].id);
    useExecStore.getState().step();
    expect(useExecStore.getState().execState.outputs).toEqual(['a']);
    expect(useExecStore.getState().runningElementId).toBe(d.children[1].id);
    useExecStore.getState().stop();
  });

  it('coverage counts add up over runs while Coverage is on and can be reset', () => {
    const d = program(['x <- 1']);
    useStore.getState().restoreSession([{ diagram: d, fileName: null }], 0);
    const ex = () => useExecStore.getState();
    if (!ex().coverageOverlay) ex().toggleCoverage();
    ex().setSpeed(0);
    const runSync = () => { ex().start('step'); while (ex().status === 'paused') ex().step(); };
    runSync();
    runSync();
    expect(ex().execState.execCounts.get(d.children[0].id)).toBe(2);
    ex().resetCoverage();
    expect(ex().execState.execCounts.size).toBe(0);
    ex().toggleCoverage();
  });

  it('arrangement groups: an .arrz opens as group, can be renamed, dissolved and survives a session restore', () => {
    const st = () => useStore.getState();
    st().restoreSession([{ diagram: program(['a <- 1']), fileName: 'main.nsd' }], 0);
    st().openArrz([
      { diagram: { ...createDiagram('sub'), text: ['f(x)'] }, x: 10, y: 10, fileName: 'f.nsd' },
      { diagram: { ...createDiagram('sub'), text: ['g(y)'] }, x: 300, y: 10, fileName: 'g.nsd' },
    ], 'Library');
    const inGroup = () => st().allDocs().filter((d) => st().groups[d.id] === 'Library').map((d) => d.fileName).sort();
    expect(inGroup()).toEqual(['f.nsd', 'g.nsd']);
    st().renameGroup('Library', 'Lib');
    expect(Object.values(st().groups)).toEqual(['Lib', 'Lib']);
    const saved = st().allDocs().map((d) => ({ diagram: d.diagram, fileName: d.fileName, group: st().groups[d.id] }));
    st().restoreSession(saved, 0);
    expect(st().allDocs().filter((d) => st().groups[d.id] === 'Lib')).toHaveLength(2);
    st().dissolveGroup('Lib');
    expect(st().groups).toEqual({});
    expect(st().allDocs()).toHaveLength(3);
  });

  it('zoomed out, lines keep at least one device pixel', () => {
    const scene = createLayoutEngine(fakeMeasure).layout(program(['x <- 1']));
    expect(sceneToSvg(scene, { scale: 0.5 })).toContain('stroke-width="2.00"');
    expect(sceneToSvg(scene, { scale: 1 })).toContain('stroke-width="1"');
    expect(sceneToSvg(scene, { scale: 2 })).toContain('stroke-width="1"');
  });
});
