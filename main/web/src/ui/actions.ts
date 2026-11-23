// SPDX-License-Identifier: GPL-3.0-or-later
// All user commands in one place: menu bar, toolbar, context menu and keyboard call these.
import { createDiagram, findById, slotsOf, STRUCTURED_KINDS, type DiagramType, type ElementKind } from '../core/model';
import { readNsd } from '../core/io';
import type { LangId } from '../core/gen/generators';
import { translator } from '../i18n';
import { useStore } from '../store/diagramStore';
import { useExecStore } from '../store/execStore';
import { usePrefs } from '../store/prefsStore';
import {
  copyPngToClipboard, exportArrFile, exportArrzFile, exportCode, exportEmf, exportPdf, exportPng, exportPngMulti, exportSvg, moveSaveHandle,
  pickFile, printDiagram, readArrFile, readArrzFile, readFile, saveDiagram, savePrefsFile, type RecentFile,
} from './exporters';

declare const __SINGLE_FILE__: boolean;
const IS_SINGLE = typeof __SINGLE_FILE__ === 'boolean' && __SINGLE_FILE__;

const st = () => useStore.getState();
const t = () => translator(usePrefs.getState().lang);
const notify = (text: string, kind: 'info' | 'success' | 'error' = 'info') => st().notify(text, kind);
const pool = () => st().allDocs().map((x) => x.diagram);

/** Document key for file handles: stable per open document. */
const docKey = new Map<string, object>();
function keyOf(id: string): object {
  let k = docKey.get(id);
  if (!k) { k = {}; docKey.set(id, k); }
  return k;
}

function isDirtyActive(): boolean {
  const s = st();
  return s.diagram !== s.savedDiagram && (s.savedDiagram !== null || s.past.length > 0);
}

async function guard<T>(fn: () => Promise<T> | T): Promise<T | undefined> {
  try { return await fn(); } catch (e) { notify((e as Error).message, 'error'); return undefined; }
}

export const actions = {
  // ---------------------------------------------------------------- File
  newDiagram: () => actions.newWith('program'),

  open: async () => {
    const files = await pickFile('.nsd,.arrz,.arr,application/xml,text/xml,application/zip', true);
    await actions.openFiles(files);
  },

  /** Open picked or dropped files (drag and drop from Finder/Explorer/Files app). Other files are skipped. */
  openFiles: async (input: File[], fromDrop = false) => {
    const files = fromDrop ? input.filter((f) => /\.(nsd|arrz|arr|xml)$/i.test(f.name)) : input;
    if (fromDrop && files.length === 0) { notify(t()('dropNoFiles'), 'error'); return; }
    for (const file of files) {
      await guard(async () => {
        const low = file.name.toLowerCase();
        if (low.endsWith('.arrz')) {
          const bundle = await readArrzFile(file);
          // like the desktop Arranger, the diagrams of an arrangement form a group named after the file
          st().openArrz(bundle.entries, file.name.replace(/\.arrz$/i, ''));
          notify(`Loaded ${bundle.entries.length} diagrams from ${file.name}`, 'success');
          return;
        }
        if (low.endsWith('.arr')) {
          const entries = await readArrFile(file);
          const all = st().allDocs();
          let matched = 0;
          for (const entry of entries) {
            const doc = all.find((d) => (d.fileName ?? '').toLowerCase() === entry.fileName.toLowerCase());
            if (doc) {
              st().moveDocCard(doc.id, entry.x, entry.y);
              matched++;
            }
          }
          if (all.length > 1) st().setViewMode('arranger');
          notify(`Applied arrangement positions (${matched}/${entries.length} matched)`, 'info');
          return;
        }
        const { diagram, warnings } = await readFile(file);
        st().openDoc(diagram, file.name);
        st().requestFit();
        if (warnings.length) notify(`${t()('loadedWithWarnings')}: ${warnings.slice(0, 3).join(' ')}`);
      }).catch(() => notify(t()('openFailed'), 'error'));
    }
  },

  exportArrz: () => {
    exportArrzFile(st().allDocs());
    notify(`${t()('exported')}: ARRZ`, 'success');
  },

  exportArr: () => {
    exportArrFile(st().allDocs());
    notify(`${t()('exported')}: ARR`, 'success');
  },

  // ---------------------------------------------------------------- Arrangement groups
  /** Saves the diagrams of one group as portable arrangement (.arrz named after the group). */
  exportGroupArrz: (group: string) => {
    const s = st();
    const docs = s.allDocs().filter((d) => s.groups[d.id] === group);
    if (docs.length === 0) return;
    exportArrzFile(docs, group);
    notify(`${t()('exported')}: ${group}.arrz`, 'success');
  },

  /** Puts a diagram into a group (new or existing name); an empty name takes it out again. */
  moveToGroup: (id: string) => {
    const s = st();
    const names = [...new Set(Object.values(s.groups))].sort();
    const current = s.groups[id] ?? '';
    const hint = names.length ? `\n(${names.join(', ')})` : '';
    const name = window.prompt(`${t()('groupPrompt')}${hint}`, current);
    if (name === null) return;
    s.setDocGroup(id, name);
  },

  renameGroup: (group: string) => {
    const name = window.prompt(t()('groupRenamePrompt'), group);
    if (name !== null) st().renameGroup(group, name);
  },

  dissolveGroup: (group: string) => {
    if (window.confirm(`${t()('groupDissolveConfirm')} "${group}"`)) st().dissolveGroup(group);
  },

  toggleArrangerBoard: () => {
    const s = st();
    s.setViewMode(s.viewMode === 'arranger' ? 'editor' : 'arranger');
  },

  toggleAnalyser: () => {
    usePrefs.getState().toggle('analyserWarnings');
  },

  openXml: (xml: string, name: string | null) => {
    try {
      const { diagram, warnings } = readNsd(xml);
      st().openDoc(diagram, name);
      st().requestFit();
      if (warnings.length) notify(`${t()('loadedWithWarnings')}: ${warnings.slice(0, 3).join(' ')}`);
    } catch (e) {
      notify(`${t()('openFailed')}: ${(e as Error).message}`, 'error');
    }
  },

  openRecent: (r: RecentFile) => actions.openXml(r.xml, r.name),

  save: async (saveAs = false) => {
    const s = st();
    const name = await guard(() => saveDiagram(s.diagram, keyOf(s.activeId), saveAs));
    if (name) { st().markSaved(name); notify(`${t()('saved')}: ${name}`, 'success'); }
  },

  saveAll: async () => {
    const startId = st().activeId;
    let savedCount = 0;
    for (const doc of st().allDocs()) {
      if (!doc.dirty) continue;
      st().switchDoc(doc.id);
      const s = st();
      const name = await guard(() => saveDiagram(s.diagram, keyOf(s.activeId), false));
      if (name) { st().markSaved(name); savedCount++; }
    }
    st().switchDoc(startId);
    if (savedCount > 0) notify(t()('saved'), 'success');
  },

  closeDiagram: (id?: string) => {
    const s = st();
    const target = id ?? s.activeId;
    const doc = s.allDocs().find((x) => x.id === target);
    if (doc?.dirty && !window.confirm(t()('closeUnsaved'))) return;
    s.closeDoc(target);
  },

  clear: () => {
    if (st().diagram.children.length === 0) return;
    if (window.confirm(t()('clearConfirm'))) st().clearDiagram();
  },

  exportPicture: async (kind: 'png' | 'pngMulti' | 'svg' | 'emf' | 'pdf' | 'swf') => {
    const d = st().diagram;
    if (kind === 'swf') { notify(t()('swfNote')); return; }
    if (kind === 'pngMulti') { st().setDialog('pngMulti'); return; }
    await guard(async () => {
      if (kind === 'png') await exportPng(d);
      else if (kind === 'svg') exportSvg(d);
      else if (kind === 'emf') exportEmf(d);
      else if (kind === 'pdf') await exportPdf(d);
      notify(`${t()('exported')}: ${kind.toUpperCase()}`, 'success');
    });
  },

  exportPngTiles: async (cols: number, rows: number) => {
    const n = await guard(() => exportPngMulti(st().diagram, cols, rows));
    if (n) notify(`${t()('exported')}: ${n} PNG`, 'success');
  },

  exportCode: (lang?: LangId) => {
    const l = lang ?? usePrefs.getState().codeLang;
    void guard(() => {
      exportCode(st().diagram, l, pool());
      notify(`${t()('exported')}: ${l.toUpperCase()}`, 'success');
    });
  },

  print: () => { notify(t()('printHint')); printDiagram(st().diagram); },

  attributes: () => st().openEditor({ t: 'root' }),

  // ---------------------------------------------------------------- Edit
  undo: () => st().undo(),
  redo: () => st().redo(),
  cut: () => st().cut(),
  copy: () => st().copy(),
  paste: () => st().paste(),
  duplicate: () => st().duplicate(),

  remove: () => {
    const s = st();
    if (s.selection?.t !== 'el') return;
    const el = findById(s.diagram, s.selection.id)?.el;
    if (el && usePrefs.getState().confirmDelete && STRUCTURED_KINDS.has(el.kind) && slotsOf(el).some((x) => x.seq.length > 0)) {
      if (!window.confirm(t()('deleteConfirm'))) return;
    }
    s.removeSelected();
  },

  editSelected: () => {
    const s = st();
    if (s.selection?.t === 'el') s.openEditor({ t: 'el', id: s.selection.id, isNew: false });
    else if (s.selection?.t === 'root' || !s.selection) s.openEditor({ t: 'root' });
  },

  find: () => st().setDialog('find'),

  copyPicture: async () => {
    const ok = await copyPngToClipboard(st().diagram);
    notify(ok ? t()('copied') : t()('clipboardFailed'), ok ? 'success' : 'error');
  },

  // ---------------------------------------------------------------- Diagram
  insert: (kind: ElementKind, before = false) => {
    const s = st();
    s.insert(kind, before || s.insertBefore);
    if (s.insertBefore) s.setInsertBefore(false);
  },
  moveUp: () => st().shift(-1),
  moveDown: () => st().shift(1),
  transmute: () => { if (!st().transmute()) notify(t()('transmuteNone')); },
  outsource: () => { if (st().outsource()) notify(t()('outsourced')); },
  collapse: () => st().toggleCollapsed(true),
  expand: () => st().toggleCollapsed(false),
  toggleCollapse: () => st().toggleCollapsed(),
  disable: () => st().toggleDisabled(),
  setType: (type: DiagramType) => {
    const s = st();
    if (s.diagram.diagramType !== type) s.commit({ ...s.diagram, diagramType: type });
  },
  toggleBoxed: () => { const s = st(); s.commit({ ...s.diagram, boxed: !s.diagram.boxed }); },

  // ---------------------------------------------------------------- View
  zoomIn: () => st().setZoom(st().zoom * 1.2),
  zoomOut: () => st().setZoom(st().zoom / 1.2),
  zoomReset: () => st().setZoom(1),
  zoomFit: () => st().requestFit(),
  togglePanel: (tab?: 'code' | 'index') => {
    const p = usePrefs.getState();
    if (tab && (!p.panelOpen || p.panelTab !== tab)) p.set({ panelOpen: true, panelTab: tab });
    else p.set({ panelOpen: !p.panelOpen });
  },

  // ---------------------------------------------------------------- Preferences
  prefs: () => st().setDialog('prefs'),
  savePrefs: () => savePrefsFile(usePrefs.getState().exportJson()),
  loadPrefs: async () => {
    const [f] = await pickFile('.json,application/json');
    if (!f) return;
    await guard(async () => usePrefs.getState().importJson(await f.text()));
  },

  // ---------------------------------------------------------------- Debug / Help
  planned: () => notify(t()('plannedNote')),
  executor: () => {
    const ex = useExecStore.getState();
    if (!ex.open) ex.setOpen(true);
    else if (ex.status === 'idle' || ex.status === 'done' || ex.status === 'error') ex.start('run');
    else ex.setOpen(false);
  },
  turtleizer: () => {
    const ex = useExecStore.getState();
    ex.setTurtleOpen(!ex.turtleOpen);
  },
  breakpoint: () => useExecStore.getState().toggleBreakpoint(),
  clearBreakpoints: () => useExecStore.getState().clearBreakpoints(),
  docs: (anchor = '') => {
    // the single-file version has no docs folder next to it
    const url = !IS_SINGLE ? `./docs/${anchor}`
      : anchor === '#user-guide' ? 'https://help.structorizer.fisch.lu/' : 'https://github.com/visoire/Structorizer#readme';
    window.open(url, '_blank', 'noopener');
  },
  keys: () => st().setDialog('keys'),
  about: () => st().setDialog('about'),

  newWith: (type: DiagramType) => {
    const d = createDiagram(type);
    st().newDoc({ ...d, keywords: { ...usePrefs.getState().defaultKeywords } });
  },
};

/** Keep file handles when documents switch (the handle belongs to the doc id). */
export function rememberHandle(fromId: string, toId: string): void {
  moveSaveHandle(keyOf(fromId), keyOf(toId));
}

export { isDirtyActive };
