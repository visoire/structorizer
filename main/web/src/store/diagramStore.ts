// SPDX-License-Identifier: GPL-3.0-or-later
// Application state (D-13: undo/redo as immutable snapshots).
import { create } from 'zustand';
import {
  cloneWithNewIds, createDiagram, createElement, findById, insertAt, removeById, setBranchHeadColor, shiftElement,
  updateElement, moveTo, type Diagram, type Element, type ElementKind, type ElementPatch, type Position, type SeqRef,
} from '../core/model';
import { getSeq, isInside, sameRef, slotsOf } from '../core/model/tree';
import { mapSeq, replaceElement } from '../core/model/ops';
import { newId } from '../core/model/ids';

/** An open diagram that is not the active one (Arranger index). */
export interface DocSlot {
  id: string;
  diagram: Diagram;
  savedDiagram: Diagram | null;
  fileName: string | null;
  past: Diagram[];
  future: Diagram[];
  x?: number;
  y?: number;
  pinned?: boolean;
}

export type DialogName = 'prefs' | 'find' | 'about' | 'keys' | 'pngMulti' | 'install' | null;
export type ViewMode = 'editor' | 'arranger';

export type Selection =
  | { t: 'el'; id: string; ids?: string[]; anchorId?: string; branchHead?: number }
  | { t: 'seq'; ref: SeqRef }
  | { t: 'root' }
  | null;

/** Ordered list of selected element IDs (single or contiguous multi-selection). */
export function selectedIds(sel: Selection): string[] {
  if (sel?.t !== 'el') return [];
  return sel.ids && sel.ids.length > 0 ? sel.ids : [sel.id];
}

const MAX_UNDO = 100;

export interface EditorTarget { t: 'el'; id: string; isNew: boolean }

interface State {
  diagram: Diagram;
  savedDiagram: Diagram | null;
  fileName: string | null;
  selection: Selection;
  past: Diagram[];
  future: Diagram[];
  clipboard: Element | null;
  clipboardItems: Element[];
  editor: EditorTarget | { t: 'root' } | null;
  zoom: number;
  /** id of the active document; the others live in `docs`. */
  activeId: string;
  activeX?: number;
  activeY?: number;
  activePinned?: boolean;
  viewMode: ViewMode;
  docs: DocSlot[];
  dialog: DialogName;
  contextMenu: { x: number; y: number } | null;
  quickDish: { x: number; y: number } | null;
  /** Incremented to ask the view to fit the diagram into the window. */
  fitTick: number;
  /** Touch helper: next insert goes before the selection (desktop: Shift + button). */
  insertBefore: boolean;
  message: { text: string; kind: 'info' | 'success' | 'error' } | null;

  // actions
  commit: (d: Diagram, selection?: Selection) => void;
  load: (d: Diagram, fileName: string | null) => void;
  markSaved: (fileName?: string) => void;
  undo: () => void;
  redo: () => void;
  select: (s: Selection) => void;
  extendSelection: (dir: 'up' | 'down') => void;
  selectRangeTo: (id: string) => void;
  setBranchColor: (color: string) => void;
  insert: (kind: ElementKind, before?: boolean) => void;
  removeSelected: () => void;
  updateSelected: (patch: ElementPatch) => void;
  update: (id: string, patch: ElementPatch) => void;
  move: (id: string, pos: Position) => void;
  shift: (delta: -1 | 1) => void;
  copy: () => void;
  cut: () => void;
  paste: () => void;
  duplicate: () => void;
  toggleDisabled: () => void;
  toggleCollapsed: (value?: boolean) => void;
  openEditor: (target: State['editor']) => void;
  closeEditor: (cancelNew?: boolean) => void;
  setZoom: (z: number) => void;
  // documents (Arranger index & Arranger board)
  newDoc: (d?: Diagram, fileName?: string | null, pos?: { x?: number; y?: number }) => void;
  openDoc: (d: Diagram, fileName: string | null, pos?: { x?: number; y?: number }) => void;
  /** Opens the diagrams of an arrangement; with `group` they form a group named after the file (desktop). */
  openArrz: (entries: { diagram: Diagram; x: number; y: number; fileName: string }[], group?: string) => void;
  switchDoc: (id: string) => void;
  closeDoc: (id: string) => void;
  setViewMode: (m: ViewMode) => void;
  moveDocCard: (id: string, x: number, y: number) => void;
  togglePinDoc: (id: string) => void;
  autoLayoutDocs: () => void;
  allDocs: () => (DocSlot & { active: boolean; dirty: boolean })[];
  restoreSession: (docs: { diagram: Diagram; fileName: string | null; group?: string; x?: number; y?: number; pinned?: boolean }[], active: number) => void;
  // arrangement groups (desktop Arranger groups, basic): doc id -> group name, no entry = default group
  groups: Record<string, string>;
  /** collapsed groups in the Arranger index (kept here so a rename keeps it) */
  groupCollapsed: Record<string, boolean>;
  toggleGroupCollapsed: (name: string) => void;
  /** the small group dialog: put a diagram into a group, or rename a group */
  groupDialog: { mode: 'assign'; docId: string } | { mode: 'rename'; group: string } | null;
  openGroupDialog: (d: State['groupDialog']) => void;
  setDocGroup: (id: string, group: string | null) => void;
  renameGroup: (from: string, to: string) => void;
  dissolveGroup: (name: string) => void;
  // more desktop functions
  clearDiagram: () => void;
  transmute: () => boolean;
  outsource: () => boolean;
  setDialog: (d: DialogName) => void;
  openContextMenu: (pos: { x: number; y: number } | null) => void;
  openQuickDish: (pos: { x: number; y: number } | null) => void;
  requestFit: () => void;
  setInsertBefore: (b: boolean) => void;
  notify: (text: string, kind?: 'info' | 'success' | 'error') => void;
  navigate: (dir: 'up' | 'down' | 'left' | 'right') => void;
}

/** Where a new element goes for the current selection. */
export function insertPosition(d: Diagram, sel: Selection, before: boolean): Position {
  if (sel?.t === 'el') {
    const ids = selectedIds(sel);
    const refId = before ? ids[0] : ids[ids.length - 1];
    const f = findById(d, refId);
    if (f) return { seq: f.parentSeq, index: before ? f.index : f.index + 1 };
  }
  if (sel?.t === 'seq') return { seq: sel.ref, index: 0 };
  return { seq: { owner: 'root' }, index: before ? 0 : d.children.length };
}

export const useStore = create<State>((set, get) => ({
  diagram: createDiagram(),
  savedDiagram: null,
  fileName: null,
  selection: null,
  past: [],
  future: [],
  clipboard: null,
  clipboardItems: [],
  editor: null,
  zoom: 1,
  activeId: newId(),
  activeX: 32,
  activeY: 32,
  activePinned: false,
  viewMode: 'editor',
  docs: [],
  groups: {},
  groupCollapsed: {},
  groupDialog: null,
  dialog: null,
  contextMenu: null,
  quickDish: null,
  fitTick: 0,
  insertBefore: false,
  message: null,

  commit: (d, selection) => {
    const { diagram, past } = get();
    if (d === diagram) return;
    set({
      diagram: d,
      past: [...past, diagram].slice(-MAX_UNDO),
      future: [],
      ...(selection !== undefined ? { selection } : {}),
    });
  },

  load: (d, fileName) => set({ diagram: d, savedDiagram: d, fileName, past: [], future: [], selection: null, editor: null }),

  markSaved: (fileName) => set((s) => ({ savedDiagram: s.diagram, fileName: fileName ?? s.fileName })),

  undo: () => {
    const { past, diagram, future } = get();
    if (past.length === 0) return;
    set({ diagram: past[past.length - 1], past: past.slice(0, -1), future: [diagram, ...future], selection: null });
  },

  redo: () => {
    const { past, diagram, future } = get();
    if (future.length === 0) return;
    set({ diagram: future[0], future: future.slice(1), past: [...past, diagram], selection: null });
  },

  select: (selection) => set({ selection }),

  extendSelection: (dir) => {
    const { diagram, selection, navigate } = get();
    if (!selection || selection.t !== 'el') {
      navigate(dir);
      return;
    }
    const anchor = findById(diagram, selection.anchorId ?? selection.id);
    const focus = findById(diagram, selection.id);
    if (!anchor || !focus || !sameRef(anchor.parentSeq, focus.parentSeq)) return;
    const seq = getSeq(diagram, anchor.parentSeq);
    const nextIdx = Math.max(0, Math.min(seq.length - 1, focus.index + (dir === 'up' ? -1 : 1)));
    const lo = Math.min(anchor.index, nextIdx);
    const hi = Math.max(anchor.index, nextIdx);
    const ids = seq.slice(lo, hi + 1).map((e) => e.id);
    set({
      selection: ids.length === 1
        ? { t: 'el', id: seq[nextIdx].id }
        : { t: 'el', id: seq[nextIdx].id, anchorId: anchor.el.id, ids },
    });
  },

  selectRangeTo: (targetId) => {
    const { diagram, selection } = get();
    if (selection?.t === 'el') {
      const anchor = findById(diagram, selection.anchorId ?? selection.id);
      const target = findById(diagram, targetId);
      if (anchor && target && sameRef(anchor.parentSeq, target.parentSeq)) {
        const seq = getSeq(diagram, anchor.parentSeq);
        const lo = Math.min(anchor.index, target.index);
        const hi = Math.max(anchor.index, target.index);
        const ids = seq.slice(lo, hi + 1).map((e) => e.id);
        set({
          selection: ids.length === 1
            ? { t: 'el', id: targetId }
            : { t: 'el', id: targetId, anchorId: anchor.el.id, ids },
        });
        return;
      }
    }
    set({ selection: { t: 'el', id: targetId } });
  },

  setBranchColor: (color) => {
    const { diagram, selection, commit } = get();
    if (selection?.t !== 'el' || selection.branchHead === undefined) return;
    commit(setBranchHeadColor(diagram, selection.id, selection.branchHead, color));
  },

  insert: (kind, before = false) => {
    const { diagram, selection, commit } = get();
    const el = createElement(kind, undefined, diagram.keywords);
    const pos = insertPosition(diagram, selection, before);
    commit(insertAt(diagram, pos, el), { t: 'el', id: el.id });
    set({ editor: { t: 'el', id: el.id, isNew: true } });
  },

  removeSelected: () => {
    const { diagram, selection, commit } = get();
    const ids = selectedIds(selection);
    if (ids.length === 0) return;
    const first = findById(diagram, ids[0]);
    if (!first) return;
    let next = diagram;
    for (const id of ids) next = removeById(next, id);
    const seq = getSeq(next, first.parentSeq);
    const neighbour = seq[Math.min(first.index, seq.length - 1)];
    commit(next, neighbour ? { t: 'el', id: neighbour.id } : { t: 'seq', ref: first.parentSeq });
  },

  updateSelected: (patch) => {
    const { selection, update } = get();
    if (selection?.t === 'el') update(selection.id, patch);
  },

  update: (id, patch) => {
    const { diagram, commit } = get();
    commit(updateElement(diagram, id, patch));
  },

  move: (id, pos) => {
    const { diagram, selection, commit } = get();
    const ids = selectedIds(selection);
    if (ids.length > 1 && ids.includes(id)) {
      const first = findById(diagram, ids[0]);
      if (!first) return;
      if (pos.seq.owner !== 'root' && ids.some((eid) => isInside(diagram, eid, pos.seq.owner))) return;
      const els = ids.map((eid) => findById(diagram, eid)?.el).filter((e): e is Element => !!e);
      if (els.length !== ids.length) return;
      let index = pos.index;
      if (sameRef(first.parentSeq, pos.seq)) {
        const beforeCount = ids.filter((eid) => (findById(diagram, eid)?.index ?? Infinity) < pos.index).length;
        index -= beforeCount;
      }
      let without = diagram;
      for (const eid of ids) without = removeById(without, eid);
      commit(insertAt(without, { seq: pos.seq, index }, ...els), {
        t: 'el', id, anchorId: ids[0], ids,
      });
      return;
    }
    commit(moveTo(diagram, id, pos), { t: 'el', id });
  },

  shift: (delta) => {
    const { diagram, selection, commit } = get();
    const ids = selectedIds(selection);
    if (ids.length === 0) return;
    if (ids.length === 1) {
      commit(shiftElement(diagram, ids[0], delta));
      return;
    }
    const first = findById(diagram, ids[0]);
    const last = findById(diagram, ids[ids.length - 1]);
    if (!first || !last || !sameRef(first.parentSeq, last.parentSeq)) return;
    const lo = Math.min(first.index, last.index);
    const hi = Math.max(first.index, last.index);
    commit(mapSeq(diagram, first.parentSeq, (seq) => {
      if (delta === -1 && lo > 0) {
        return [...seq.slice(0, lo - 1), ...seq.slice(lo, hi + 1), seq[lo - 1], ...seq.slice(hi + 1)];
      }
      if (delta === 1 && hi < seq.length - 1) {
        return [...seq.slice(0, lo), seq[hi + 1], ...seq.slice(lo, hi + 1), ...seq.slice(hi + 2)];
      }
      return seq;
    }));
  },

  copy: () => {
    const { diagram, selection } = get();
    const ids = selectedIds(selection);
    if (ids.length === 0) return;
    const items = ids.map((id) => findById(diagram, id)?.el).filter((e): e is Element => !!e).map(cloneWithNewIds);
    if (items.length > 0) set({ clipboard: items[0], clipboardItems: items });
  },

  cut: () => {
    get().copy();
    get().removeSelected();
  },

  paste: () => {
    const { diagram, selection, clipboard, clipboardItems, commit } = get();
    const src = clipboardItems.length > 0 ? clipboardItems : clipboard ? [clipboard] : [];
    if (src.length === 0) return;
    const els = src.map(cloneWithNewIds);
    const next = insertAt(diagram, insertPosition(diagram, selection, false), ...els);
    commit(
      next,
      els.length === 1
        ? { t: 'el', id: els[0].id }
        : { t: 'el', id: els[els.length - 1].id, anchorId: els[0].id, ids: els.map((e) => e.id) },
    );
  },

  duplicate: () => {
    const { diagram, selection, commit } = get();
    const ids = selectedIds(selection);
    if (ids.length === 0) return;
    const last = findById(diagram, ids[ids.length - 1]);
    if (!last) return;
    const els = ids.map((id) => findById(diagram, id)?.el).filter((e): e is Element => !!e).map(cloneWithNewIds);
    if (els.length === 0) return;
    const next = insertAt(diagram, { seq: last.parentSeq, index: last.index + 1 }, ...els);
    commit(
      next,
      els.length === 1
        ? { t: 'el', id: els[0].id }
        : { t: 'el', id: els[els.length - 1].id, anchorId: els[0].id, ids: els.map((e) => e.id) },
    );
  },

  toggleDisabled: () => {
    const { diagram, selection, commit } = get();
    const ids = selectedIds(selection);
    if (ids.length === 0) return;
    const els = ids.map((id) => findById(diagram, id)?.el).filter((e): e is Element => !!e);
    const targetState = els.some((e) => !e.disabled);
    let next = diagram;
    for (const id of ids) next = updateElement(next, id, { disabled: targetState });
    commit(next);
  },

  toggleCollapsed: (value) => {
    const { diagram, selection } = get();
    if (selection?.t !== 'el') return;
    const f = findById(diagram, selection.id);
    if (!f || slotsOf(f.el).length === 0) return;
    // collapsing is a view change: not recorded in the undo history
    set({ diagram: updateElement(diagram, f.el.id, { collapsed: value ?? !f.el.collapsed }) });
  },

  openEditor: (editor) => set({ editor }),

  closeEditor: (cancelNew = false) => {
    const { editor, diagram, past } = get();
    if (cancelNew && editor?.t === 'el' && editor.isNew) {
      // cancelling the editor of a just inserted element removes it again (no undo entry)
      const prev = past[past.length - 1];
      set({ diagram: prev ?? removeById(diagram, editor.id), past: past.slice(0, -1), editor: null, selection: null });
      return;
    }
    set({ editor: null });
  },

  newDoc: (d, fileName = null, pos) => {
    const s = get();
    const idx = s.docs.length + 1;
    const slot: DocSlot = {
      id: s.activeId,
      diagram: s.diagram,
      savedDiagram: s.savedDiagram,
      fileName: s.fileName,
      past: s.past,
      future: s.future,
      x: s.activeX ?? 32,
      y: s.activeY ?? 32,
      pinned: s.activePinned ?? false,
    };
    const fresh = d ?? createDiagram();
    set({
      docs: [...s.docs, slot],
      activeId: newId(),
      activeX: pos?.x ?? (32 + (idx % 3) * 320),
      activeY: pos?.y ?? (32 + Math.floor(idx / 3) * 260),
      activePinned: false,
      diagram: fresh,
      savedDiagram: d ? fresh : null,
      fileName,
      past: [],
      future: [],
      selection: null,
      editor: null,
    });
  },

  openDoc: (d, fileName, pos) => {
    const s = get();
    // replace an untouched empty diagram, otherwise open next to it (nothing gets lost)
    const untouched = s.diagram.children.length === 0 && s.past.length === 0 && !s.fileName;
    if (untouched) {
      set({
        diagram: d,
        savedDiagram: d,
        fileName,
        activeX: pos?.x ?? s.activeX ?? 32,
        activeY: pos?.y ?? s.activeY ?? 32,
        activePinned: false,
        past: [],
        future: [],
        selection: null,
        editor: null,
      });
    } else {
      get().newDoc(d, fileName, pos);
    }
  },

  openArrz: (entries, group) => {
    // room for the group label above the cards (desktop arrangements often start at y = 10)
    const minY = Math.min(...entries.map((e) => e.y));
    const dy = group && minY < 40 ? 40 - minY : 0;
    for (const entry of entries) {
      get().openDoc(entry.diagram, entry.fileName, { x: entry.x, y: entry.y + dy });
      if (group) get().setDocGroup(get().activeId, group);
    }
    if (entries.length > 1) {
      set({ viewMode: 'arranger' });
    }
  },

  switchDoc: (id) => {
    const s = get();
    if (id === s.activeId) return;
    const target = s.docs.find((x) => x.id === id);
    if (!target) return;
    const current: DocSlot = {
      id: s.activeId,
      diagram: s.diagram,
      savedDiagram: s.savedDiagram,
      fileName: s.fileName,
      past: s.past,
      future: s.future,
      x: s.activeX,
      y: s.activeY,
      pinned: s.activePinned,
    };
    set({
      docs: s.docs.map((x) => (x.id === id ? current : x)),
      activeId: target.id,
      activeX: target.x ?? 32,
      activeY: target.y ?? 32,
      activePinned: target.pinned ?? false,
      diagram: target.diagram,
      savedDiagram: target.savedDiagram,
      fileName: target.fileName,
      past: target.past,
      future: target.future,
      selection: null,
      editor: null,
    });
  },

  closeDoc: (id) => {
    const s = get();
    if (s.groups[id]) get().setDocGroup(id, null);
    if (id !== s.activeId) { set({ docs: s.docs.filter((x) => x.id !== id) }); return; }
    const next = s.docs[s.docs.length - 1];
    if (!next) {
      set({
        diagram: createDiagram(),
        savedDiagram: null,
        fileName: null,
        activeX: 32,
        activeY: 32,
        activePinned: false,
        past: [],
        future: [],
        selection: null,
      });
      return;
    }
    set({
      docs: s.docs.slice(0, -1),
      activeId: next.id,
      activeX: next.x ?? 32,
      activeY: next.y ?? 32,
      activePinned: next.pinned ?? false,
      diagram: next.diagram,
      savedDiagram: next.savedDiagram,
      fileName: next.fileName,
      past: next.past,
      future: next.future,
      selection: null,
      editor: null,
    });
  },

  setViewMode: (viewMode) => set({ viewMode }),

  moveDocCard: (id, x, y) => {
    const s = get();
    const rx = Math.max(8, Math.round(x));
    const ry = Math.max(8, Math.round(y));
    if (id === s.activeId) {
      if (s.activePinned) return;
      set({ activeX: rx, activeY: ry });
    } else {
      set({
        docs: s.docs.map((d) => (d.id === id && !d.pinned ? { ...d, x: rx, y: ry } : d)),
      });
    }
  },

  togglePinDoc: (id) => {
    const s = get();
    if (id === s.activeId) {
      set({ activePinned: !s.activePinned });
    } else {
      set({
        docs: s.docs.map((d) => (d.id === id ? { ...d, pinned: !d.pinned } : d)),
      });
    }
  },

  autoLayoutDocs: () => {
    const s = get();
    // one block of rows per group (named groups first, then the default group), so the frame of a
    // group does not stretch over the cards of other groups
    const names = [...new Set(Object.values(s.groups))].sort((a, b) => a.localeCompare(b));
    const blocks = [...names.map((g) => s.allDocs().filter((d) => s.groups[d.id] === g)), s.allDocs().filter((d) => !s.groups[d.id])]
      .filter((b) => b.length > 0);
    const placed: { doc: ReturnType<State['allDocs']>[number]; x: number; y: number }[] = [];
    let top = 48;
    for (const block of blocks) {
      block.forEach((doc, idx) => placed.push({ doc, x: 32 + (idx % 3) * 340, y: top + Math.floor(idx / 3) * 280 }));
      top += Math.ceil(block.length / 3) * 280 + 48;
    }
    placed.forEach(({ doc, x, y }) => {
      if (doc.id === s.activeId) {
        if (!s.activePinned) set({ activeX: x, activeY: y });
      } else {
        set((st) => ({
          docs: st.docs.map((d) => (d.id === doc.id && !d.pinned ? { ...d, x, y } : d)),
        }));
      }
    });
  },

  allDocs: () => {
    const s = get();
    const dirtyOf = (x: { diagram: Diagram; savedDiagram: Diagram | null; past: Diagram[] }) =>
      x.diagram !== x.savedDiagram && (x.savedDiagram !== null || x.past.length > 0);
    const active: DocSlot = {
      id: s.activeId,
      diagram: s.diagram,
      savedDiagram: s.savedDiagram,
      fileName: s.fileName,
      past: s.past,
      future: s.future,
      x: s.activeX ?? 32,
      y: s.activeY ?? 32,
      pinned: s.activePinned ?? false,
    };
    return [
      { ...active, active: true, dirty: dirtyOf(active) },
      ...s.docs.map((x, idx) => ({
        ...x,
        x: x.x ?? (32 + ((idx + 1) % 3) * 320),
        y: x.y ?? (32 + Math.floor((idx + 1) / 3) * 260),
        active: false,
        dirty: dirtyOf(x),
      })),
    ];
  },

  restoreSession: (docs, active) => {
    if (docs.length === 0) return;
    const a = docs[Math.min(Math.max(0, active), docs.length - 1)];
    const ids = docs.map(() => newId());
    const groups: Record<string, string> = {};
    docs.forEach((x, i) => { if (x.group) groups[ids[i]] = x.group; });
    set({
      diagram: a.diagram, savedDiagram: a.diagram, fileName: a.fileName, past: [], future: [], selection: null,
      activeId: ids[docs.indexOf(a)],
      activeX: a.x ?? 32, activeY: a.y ?? 32, activePinned: !!a.pinned,
      docs: docs.map((x, i) => ({ x, id: ids[i] })).filter(({ x }) => x !== a)
        .map(({ x, id }) => ({ id, diagram: x.diagram, savedDiagram: x.diagram, fileName: x.fileName, past: [], future: [], x: x.x, y: x.y, pinned: x.pinned })),
      groups,
    });
  },

  setDocGroup: (id, group) => {
    const name = group?.trim();
    set((s) => {
      const groups = { ...s.groups };
      if (name) groups[id] = name; else delete groups[id];
      return { groups };
    });
  },

  renameGroup: (from, to) => {
    const name = to.trim();
    if (!name || name === from) return;
    set((s) => {
      const groupCollapsed = { ...s.groupCollapsed };
      if (from in groupCollapsed) { groupCollapsed[name] = groupCollapsed[from]; delete groupCollapsed[from]; }
      return { groups: Object.fromEntries(Object.entries(s.groups).map(([id, g]) => [id, g === from ? name : g])), groupCollapsed };
    });
  },

  openGroupDialog: (groupDialog) => set({ groupDialog, contextMenu: null, quickDish: null }),

  toggleGroupCollapsed: (name) => set((s) => ({ groupCollapsed: { ...s.groupCollapsed, [name]: !s.groupCollapsed[name] } })),

  dissolveGroup: (name) => {
    set((s) => ({ groups: Object.fromEntries(Object.entries(s.groups).filter(([, g]) => g !== name)) }));
  },

  clearDiagram: () => {
    const { diagram, commit } = get();
    if (diagram.children.length === 0) return;
    commit({ ...diagram, children: [] }, null);
  },

  /** Desktop "Transmute" (Ctrl+T): change the element type where it makes sense, or merge/split instructions (P1-30). */
  transmute: () => {
    const { diagram, selection, commit } = get();
    const ids = selectedIds(selection);
    if (ids.length === 0) return false;
    if (ids.length > 1) {
      const found = ids.map((id) => findById(diagram, id));
      if (found.some((f) => !f)) return false;
      const first = found[0]!;
      const last = found[found.length - 1]!;
      if (!sameRef(first.parentSeq, last.parentSeq)) return false;
      const els = found.map((f) => f!.el);
      if (!els.every((e) => e.kind === 'instruction' || e.kind === 'call' || e.kind === 'jump')) return false;
      const merged: Element = {
        id: newId(),
        kind: 'instruction',
        text: els.flatMap((e) => (e.text.length ? e.text : [''])),
        comment: els.flatMap((e) => e.comment.filter((c) => c.trim() !== '')),
        color: els[0].color,
        disabled: els.every((e) => e.disabled),
      };
      const lo = Math.min(first.index, last.index);
      const hi = Math.max(first.index, last.index);
      commit(
        mapSeq(diagram, first.parentSeq, (seq) => [...seq.slice(0, lo), merged, ...seq.slice(hi + 1)]),
        { t: 'el', id: merged.id },
      );
      return true;
    }
    const f = findById(diagram, ids[0]);
    if (!f) return false;
    const el = f.el;
    if (el.kind === 'instruction' && el.text.length > 1) {
      // split a multi-line instruction into single instructions (selected as a range so Ctrl+T can merge back)
      const parts = el.text.map((t) => ({ ...el, id: newId(), text: [t], comment: [] as string[] }));
      parts[0].comment = el.comment;
      commit(
        mapSeq(diagram, f.parentSeq, (seq) => [...seq.slice(0, f.index), ...parts, ...seq.slice(f.index + 1)]),
        { t: 'el', id: parts[parts.length - 1].id, anchorId: parts[0].id, ids: parts.map((p) => p.id) },
      );
      return true;
    }
    const next: Partial<Record<Element['kind'], Element['kind']>> = { instruction: 'call', call: 'jump', jump: 'instruction', while: 'repeat', repeat: 'while' };
    const to = next[el.kind];
    if (!to) return false;
    commit(replaceElement(diagram, el.id, (e) => {
      if ((e.kind === 'while' || e.kind === 'repeat') && (to === 'while' || to === 'repeat')) return { ...e, kind: to } as Element;
      const base = { id: e.id, text: e.text, comment: e.comment, color: e.color, disabled: e.disabled };
      return { ...base, kind: to } as Element;
    }));
    return true;
  },

  /** Desktop "Outsource": move the selected element(s) into a new subroutine and call it. */
  outsource: () => {
    const { diagram, selection } = get();
    const ids = selectedIds(selection);
    if (ids.length === 0) return false;
    const first = findById(diagram, ids[0]);
    const last = findById(diagram, ids[ids.length - 1]);
    if (!first || !last || !sameRef(first.parentSeq, last.parentSeq)) return false;
    const els = ids.map((id) => findById(diagram, id)?.el).filter((e): e is Element => !!e);
    if (els.length === 0) return false;
    const used = new Set<string>();
    get().allDocs().forEach((x) => used.add((x.diagram.text[0] ?? '').split('(')[0].trim()));
    let n = 1;
    while (used.has(`sub${n}`)) n++;
    const name = `sub${n}`;
    const call = createElement('call', [`${name}()`]);
    const sub = { ...createDiagram('sub'), text: [`${name}()`], children: els.map(cloneWithNewIds) };
    const lo = Math.min(first.index, last.index);
    const hi = Math.max(first.index, last.index);
    const replaced = mapSeq(diagram, first.parentSeq, (seq) => [...seq.slice(0, lo), call, ...seq.slice(hi + 1)]);
    get().commit(replaced, { t: 'el', id: call.id });
    // the new subroutine opens next to the current diagram, which stays active
    const s = get();
    const subId = newId();
    set({ docs: [...s.docs, { id: subId, diagram: sub, savedDiagram: null, fileName: null, past: [], future: [] }] });
    // the subroutine joins the group of its caller (desktop: same arrangement)
    if (s.groups[s.activeId]) get().setDocGroup(subId, s.groups[s.activeId]);
    return true;
  },

  setDialog: (dialog) => set({ dialog, contextMenu: null, quickDish: null }),
  openContextMenu: (contextMenu) => set({ contextMenu, quickDish: null }),
  openQuickDish: (quickDish) => set({ quickDish, contextMenu: null }),

  setZoom: (z) => set({ zoom: Math.min(3, Math.max(0.3, Math.round(z * 100) / 100)) }),

  requestFit: () => set((s) => ({ fitTick: s.fitTick + 1 })),

  setInsertBefore: (insertBefore) => set({ insertBefore }),

  notify: (text, kind = 'info') => set({ message: { text, kind } }),

  navigate: (dir) => {
    const { diagram, selection } = get();
    if (!selection || selection.t === 'root') {
      if (diagram.children[0]) set({ selection: { t: 'el', id: diagram.children[0].id } });
      return;
    }
    if (selection.t === 'seq') return;
    const f = findById(diagram, selection.id);
    if (!f) return;
    const seq = getSeq(diagram, f.parentSeq);
    if (dir === 'up' || dir === 'down') {
      const j = f.index + (dir === 'up' ? -1 : 1);
      if (j >= 0 && j < seq.length) set({ selection: { t: 'el', id: seq[j].id } });
      else if (dir === 'up' && f.parentSeq.owner !== 'root') set({ selection: { t: 'el', id: f.parentSeq.owner } });
      return;
    }
    if (dir === 'right') {
      const slots = slotsOf(f.el);
      const first = slots.find((s) => s.seq.length > 0) ?? slots[0];
      if (first) set({ selection: first.seq[0] ? { t: 'el', id: first.seq[0].id } : { t: 'seq', ref: first.ref } });
      return;
    }
    if (f.parentSeq.owner !== 'root') set({ selection: { t: 'el', id: f.parentSeq.owner } });
  },
}));

export const isDirty = (s: State) => s.diagram !== s.savedDiagram && (s.savedDiagram !== null || s.past.length > 0);
export const anyDirty = (s: State) => s.allDocs().some((d) => d.dirty);
