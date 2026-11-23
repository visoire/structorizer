// SPDX-License-Identifier: GPL-3.0-or-later
// Executor & Debugger state store (P2-06, P2-07, P2-08, P2-09, Turtleizer).
import { create } from 'zustand';
import {
  createExecState, executeDiagram, parseInputString, RuntimeError,
  type ExecEvent, type ExecResult, type ExecState, type RuntimeVal,
} from '../core/exec';
import { useStore } from './diagramStore';

export type ExecStatus = 'idle' | 'running' | 'paused' | 'waitingInput' | 'done' | 'error';

interface ExecStoreState {
  open: boolean;
  turtleOpen: boolean;
  coverageOverlay: boolean;
  status: ExecStatus;
  speedMs: number;
  runningElementId: string | null;
  runningDiagramId: string | null;
  waitingIds: string[];
  breakpoints: Set<string>;
  inputRequest: { elementId: string; prompt: string; target: string } | null;
  error: { elementId: string; message: string } | null;
  returnValue: RuntimeVal | undefined;
  execState: ExecState;
  tick: number;

  setOpen: (open: boolean) => void;
  setTurtleOpen: (open: boolean) => void;
  toggleCoverage: () => void;
  /** Reset the execution counters and coverage marks (Coverage on: they add up over runs). */
  resetCoverage: () => void;
  setSpeed: (ms: number) => void;
  toggleBreakpoint: (id?: string) => void;
  clearBreakpoints: () => void;
  start: (mode: 'run' | 'step', args?: RuntimeVal[]) => void;
  step: () => void;
  resume: () => void;
  pause: () => void;
  stop: () => void;
  submitInput: (value: string) => void;
  setWatchVar: (name: string, rawValue: string) => void;
  clearTurtle: () => void;
}

let activeGen: Generator<ExecEvent, ExecResult, string | undefined> | null = null;
let timerId: ReturnType<typeof setTimeout> | null = null;
let pausedAtStep = false;
/** Kind of the last event the generator produced (an `output` event is no step of its own). */
let lastEvent: ExecEvent['t'] | null = null;
/** Status before an INPUT prompt: stepping stays stepping after the value was entered. */
let statusBeforeInput: ExecStatus = 'running';

function clearTimer() {
  if (timerId !== null) {
    clearTimeout(timerId);
    timerId = null;
  }
}

export const useExecStore = create<ExecStoreState>((set, get) => {
  const advanceOne = (inputVal?: string): boolean => {
    if (!activeGen) return false;
    try {
      const res = inputVal !== undefined ? activeGen.next(inputVal) : activeGen.next();
      const st = get().execState;
      const autoOpenTurtle = st.turtle.used && !get().turtleOpen;
      if (res.done) {
        activeGen = null;
        clearTimer();
        set((s) => ({
          status: 'done',
          runningElementId: null,
          waitingIds: [],
          inputRequest: null,
          returnValue: res.value.returnValue,
          turtleOpen: s.turtleOpen || autoOpenTurtle,
          tick: s.tick + 1,
        }));
        return false;
      }
      const ev = res.value;
      lastEvent = ev.t;
      if (ev.t === 'input') {
        clearTimer();
        statusBeforeInput = get().status === 'paused' ? 'paused' : 'running';
        set((s) => ({
          status: 'waitingInput',
          runningElementId: ev.elementId,
          runningDiagramId: ev.diagramId,
          inputRequest: { elementId: ev.elementId, prompt: ev.prompt, target: ev.target },
          turtleOpen: s.turtleOpen || autoOpenTurtle,
          tick: s.tick + 1,
        }));
        return false;
      }
      if (ev.t === 'output') {
        set((s) => ({
          turtleOpen: s.turtleOpen || autoOpenTurtle,
          tick: s.tick + 1,
        }));
        return true;
      }
      // ev.t === 'step'
      // Switch active diagram in editor if execution stepped into another diagram in the pool
      const ds = useStore.getState();
      if (ds.diagram.id !== ev.diagramId) {
        const slot = ds.docs.find((d) => d.diagram.id === ev.diagramId);
        if (slot) ds.switchDoc(slot.id);
      }
      const hitBp = get().breakpoints.has(ev.elementId);
      set((s) => ({
        runningElementId: ev.elementId,
        runningDiagramId: ev.diagramId,
        waitingIds: ev.waitingIds ?? [],
        turtleOpen: s.turtleOpen || autoOpenTurtle,
        tick: s.tick + 1,
      }));
      if (hitBp && !pausedAtStep) {
        pausedAtStep = true;
        clearTimer();
        set({ status: 'paused' });
        return false;
      }
      pausedAtStep = false;
      return true;
    } catch (err) {
      activeGen = null;
      clearTimer();
      const elId = err instanceof RuntimeError ? err.elementId : (get().runningElementId ?? '');
      const msg = (err as Error).message || 'Runtime error';
      if (elId) useStore.getState().select({ t: 'el', id: elId });
      set((s) => ({
        status: 'error',
        error: { elementId: elId, message: msg },
        inputRequest: null,
        tick: s.tick + 1,
      }));
      return false;
    }
  };

  /**
   * One Step: advance until the next element is reached. An OUTPUT element yields an extra
   * `output` event after its step; without this loop the highlight stayed on the OUTPUT element
   * and a second Step was needed.
   */
  const stepOnce = () => {
    lastEvent = null;
    while (advanceOne() && lastEvent === 'output') { /* continue to the next element */ }
  };

  const scheduleRun = () => {
    clearTimer();
    if (get().status !== 'running' || !activeGen) return;
    const speed = get().speedMs;
    if (speed <= 0) {
      // Fast batch execution: run up to 250 steps per frame so UI stays responsive
      timerId = setTimeout(() => {
        let count = 0;
        while (get().status === 'running' && activeGen && count < 250) {
          if (!advanceOne()) return;
          count++;
        }
        if (get().status === 'running' && activeGen) scheduleRun();
      }, 8);
    } else {
      timerId = setTimeout(() => {
        if (get().status !== 'running' || !activeGen) return;
        if (advanceOne() && get().status === 'running') {
          scheduleRun();
        }
      }, speed);
    }
  };

  return {
    open: false,
    turtleOpen: false,
    coverageOverlay: false,
    status: 'idle',
    speedMs: 180,
    runningElementId: null,
    runningDiagramId: null,
    waitingIds: [],
    breakpoints: new Set(),
    inputRequest: null,
    error: null,
    returnValue: undefined,
    execState: createExecState(),
    tick: 0,

    setOpen: (open) => set({ open }),
    setTurtleOpen: (turtleOpen) => set({ turtleOpen }),
    // like the desktop's "Collect Run Data": switching it off wipes the collected counts
    toggleCoverage: () => {
      if (get().coverageOverlay) get().resetCoverage();
      set((s) => ({ coverageOverlay: !s.coverageOverlay }));
    },
    resetCoverage: () => {
      get().execState.execCounts.clear();
      get().execState.covered.clear();
      set((s) => ({ tick: s.tick + 1 }));
    },
    setSpeed: (speedMs) => {
      set({ speedMs });
      if (get().status === 'running') scheduleRun();
    },

    toggleBreakpoint: (id) => {
      const sel = useStore.getState().selection;
      const targetId = id ?? (sel?.t === 'el' ? sel.id : undefined);
      if (!targetId) return;
      const next = new Set(get().breakpoints);
      if (next.has(targetId)) next.delete(targetId);
      else next.add(targetId);
      set({ breakpoints: next });
    },

    clearBreakpoints: () => set({ breakpoints: new Set() }),

    start: (mode, args) => {
      clearTimer();
      const ds = useStore.getState();
      const pool = ds.allDocs().map((d) => d.diagram);
      const execState = createExecState();
      if (get().coverageOverlay) {
        // run data tracking (desktop): counts add up over several runs until they are reset
        const prev = get().execState;
        for (const [id, c] of prev.execCounts) execState.execCounts.set(id, c);
        for (const id of prev.covered) execState.covered.add(id);
      }
      pausedAtStep = false;
      activeGen = executeDiagram(ds.diagram, { pool, args, state: execState });
      set((s) => ({
        open: true,
        status: mode === 'run' ? 'running' : 'paused',
        runningElementId: null,
        runningDiagramId: ds.diagram.id,
        waitingIds: [],
        inputRequest: null,
        error: null,
        returnValue: undefined,
        execState,
        tick: s.tick + 1,
      }));
      if (mode === 'step') {
        stepOnce();
      } else {
        if (advanceOne() && get().status === 'running') {
          scheduleRun();
        }
      }
    },

    step: () => {
      clearTimer();
      if (!activeGen || get().status === 'done' || get().status === 'error') {
        get().start('step');
        return;
      }
      if (get().status === 'waitingInput') return;
      pausedAtStep = true;
      set({ status: 'paused' });
      stepOnce();
    },

    resume: () => {
      if (!activeGen || get().status === 'done' || get().status === 'error' || get().status === 'idle') {
        get().start('run');
        return;
      }
      if (get().status === 'waitingInput') return;
      pausedAtStep = true;
      set({ status: 'running' });
      scheduleRun();
    },

    pause: () => {
      clearTimer();
      if (get().status === 'running') set({ status: 'paused' });
    },

    stop: () => {
      clearTimer();
      activeGen = null;
      set((s) => ({
        status: 'idle',
        runningElementId: null,
        waitingIds: [],
        inputRequest: null,
        error: null,
        tick: s.tick + 1,
      }));
    },

    submitInput: (value) => {
      if (get().status !== 'waitingInput' || !activeGen) return;
      const wasRunning = statusBeforeInput === 'running';
      set({ status: wasRunning ? 'running' : 'paused', inputRequest: null });
      lastEvent = null;
      const more = advanceOne(value);
      if (!wasRunning) {
        // stepping: also finish a following output so the next element is highlighted
        if (more && lastEvent === 'output') stepOnce();
      } else if (more && get().status === 'running') {
        scheduleRun();
      }
    },

    setWatchVar: (name, rawValue) => {
      const frames = get().execState.frames;
      if (frames.length === 0) return;
      const top = frames[frames.length - 1];
      const parsed = parseInputString(rawValue, top.types.get(name), '');
      top.vars.set(name, parsed);
      set((s) => ({ tick: s.tick + 1 }));
    },

    clearTurtle: () => {
      get().execState.turtle.segments = [];
      get().execState.turtle.x = get().execState.turtle.homeX;
      get().execState.turtle.y = get().execState.turtle.homeY;
      get().execState.turtle.orientation = 0;
      set((s) => ({ tick: s.tick + 1 }));
    },
  };
});
