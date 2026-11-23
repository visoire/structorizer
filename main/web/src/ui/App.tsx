// SPDX-License-Identifier: GPL-3.0-or-later
import { useEffect, useState } from 'react';
import { findById, STRUCTURED_KINDS, type ElementKind } from '../core/model';
import { parseSignature } from '../core/lang/analyze';
import { htmlLang, useTranslator, type TKey } from '../i18n';
import { anyDirty, isDirty, useStore } from '../store/diagramStore';
import { useExecStore } from '../store/execStore';
import { resolvedTheme, usePrefs } from '../store/prefsStore';
import appIcon from '../assets/app-icon.png';
import { actions } from './actions';
import { ContextMenu, Dialogs } from './Dialogs';
import { DiagramView } from './DiagramView';
import { DiagramEditor, ElementEditor } from './ElementEditor';
import { ExecutorPanel } from './ExecutorPanel';
import { clearPrintArea, loadSession, preparePrintArea, saveSession } from './exporters';
import { Icon, KindIcon } from './icons';
import { applyUiFont } from './fonts';
import { bindVisualViewport } from './ipad';
import { MenuBar } from './MenuBar';
import { SidePanel } from './SidePanel';

const KINDS: ElementKind[] = ['instruction', 'alternative', 'case', 'for', 'while', 'repeat', 'forever', 'call', 'jump', 'parallel', 'try'];

/** Desktop key bindings (user guide chapter 13) + iPad Magic Keyboard Option+Digit bindings. */
const KEY_INSERT: Record<string, ElementKind> = {
  F5: 'instruction', F6: 'alternative', F10: 'case', F7: 'for', F8: 'while', F9: 'repeat', F11: 'call', F12: 'jump',
};
const CTRL_KEY_INSERT: Record<string, ElementKind> = { F7: 'forever', F6: 'parallel', F5: 'try' };
const ALT_CODE_INSERT: Record<string, ElementKind> = {
  Digit1: 'instruction', Digit2: 'alternative', Digit3: 'case', Digit4: 'for', Digit5: 'while',
  Digit6: 'repeat', Digit7: 'forever', Digit8: 'call', Digit9: 'jump', Digit0: 'parallel', Minus: 'try',
};

function ToolButton({ label, onClick, disabled, children, pressed }: {
  label: string; onClick: (e: React.MouseEvent) => void; disabled?: boolean; children: React.ReactNode; pressed?: boolean;
}) {
  return (
    <button type="button" className="tool" title={label} aria-label={label} aria-pressed={pressed} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  );
}

export function App() {
  const s = useStore();
  const exOpen = useExecStore((x) => x.open);
  const p = usePrefs();
  const t = useTranslator(p.lang);
  const dirty = isDirty(s);
  const [storageOk, setStorageOk] = useState(true);
  const [restored, setRestored] = useState(false);

  const sel = s.selection;
  const selEl = sel?.t === 'el' ? findById(s.diagram, sel.id)?.el ?? null : null;

  // ---------- theme (light / dark / system)
  useEffect(() => {
    const apply = () => { document.documentElement.dataset.theme = resolvedTheme(p.theme); };
    apply();
    const mq = matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [p.theme]);
  useEffect(() => { document.documentElement.lang = htmlLang(p.lang); }, [p.lang]);
  useEffect(() => { applyUiFont(); }, [p.uiFont, p.customUiFont]);
  useEffect(() => bindVisualViewport(), []);

  // ---------- restore + autosave of all open diagrams (local only)
  useEffect(() => {
    // on tablets and phones the side panel overlays the diagram: start with it closed
    if (window.innerWidth < 1100 && usePrefs.getState().panelOpen) usePrefs.getState().set({ panelOpen: false });
    const session = loadSession();
    if (session) useStore.getState().restoreSession(session.docs, session.active);
    setRestored(true);
  }, []);
  useEffect(() => {
    if (!restored) return;
    const h = setTimeout(() => {
      const { groups } = useStore.getState();
      const docs = useStore.getState().allDocs();
      setStorageOk(saveSession(docs.map((d) => ({ diagram: d.diagram, fileName: d.fileName, group: groups[d.id] })), 0));
    }, 800);
    return () => clearTimeout(h);
  }, [s.diagram, s.docs, s.fileName, s.groups, restored]);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (!anyDirty(useStore.getState())) return;
      e.preventDefault();
      e.returnValue = '';
    };
    const onBeforePrint = () => { preparePrintArea(useStore.getState().diagram); };
    const onAfterPrint = () => { clearPrintArea(); };
    window.addEventListener('beforeunload', warn);
    window.addEventListener('beforeprint', onBeforePrint);
    window.addEventListener('afterprint', onAfterPrint);
    return () => {
      window.removeEventListener('beforeunload', warn);
      window.removeEventListener('beforeprint', onBeforePrint);
      window.removeEventListener('afterprint', onAfterPrint);
    };
  }, []);

  // ---------- drag and drop of .nsd/.arrz/.arr files (desktop browsers and iPadOS Files/Split View)
  const [dropActive, setDropActive] = useState(false);
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => !!e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files');
    const enter = (e: DragEvent) => { if (!hasFiles(e)) return; e.preventDefault(); depth++; setDropActive(true); };
    const over = (e: DragEvent) => { if (!hasFiles(e)) return; e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'; };
    const leave = (e: DragEvent) => { if (!hasFiles(e)) return; depth = Math.max(0, depth - 1); if (depth === 0) setDropActive(false); };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDropActive(false);
      void actions.openFiles(Array.from(e.dataTransfer?.files ?? []), true);
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragover', over);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    // installed PWA: "Open with Structorizer" for .nsd files (manifest file_handlers)
    const lq = (window as unknown as { launchQueue?: { setConsumer: (fn: (p: { files: { getFile: () => Promise<File> }[] }) => void) => void } }).launchQueue;
    lq?.setConsumer((params) => {
      if (!params.files?.length) return;
      void Promise.all(params.files.map((h) => h.getFile())).then((files) => actions.openFiles(files, true));
    });
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragover', over);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop);
    };
  }, []);

  // ---------- toast auto-hide
  useEffect(() => {
    if (!s.message) return;
    const h = setTimeout(() => useStore.setState({ message: null }), s.message.kind === 'error' ? 7000 : 3500);
    return () => clearTimeout(h);
  }, [s.message]);

  // ---------- keyboard (desktop bindings; only when no dialog is open)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const st = useStore.getState();
      if (st.editor || st.dialog) return;
      const target = e.target as HTMLElement;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) return;
      const ctrl = e.ctrlKey || e.metaKey;
      const k = e.key;
      const lower = k.length === 1 ? k.toLowerCase() : k;
      let handled = true;
      if (!ctrl && !e.altKey && KEY_INSERT[k]) actions.insert(KEY_INSERT[k], e.shiftKey);
      else if (ctrl && !e.altKey && CTRL_KEY_INSERT[k]) actions.insert(CTRL_KEY_INSERT[k], e.shiftKey);
      else if (!ctrl && e.altKey && ALT_CODE_INSERT[e.code]) actions.insert(ALT_CODE_INSERT[e.code], e.shiftKey);
      else if (ctrl && lower === 'z') { if (e.shiftKey) actions.redo(); else actions.undo(); }
      else if (ctrl && lower === 'y') actions.redo();
      else if (ctrl && (lower === 'c' || k === 'Insert')) actions.copy();
      else if (ctrl && lower === 'x') actions.cut();
      else if (ctrl && lower === 'v') actions.paste();
      else if (ctrl && e.shiftKey && lower === 'd') void actions.copyPicture();
      else if (ctrl && lower === 'd') actions.duplicate();
      else if (e.shiftKey && k === 'Delete') actions.cut();
      else if (e.shiftKey && k === 'Insert') actions.paste();
      else if (ctrl && e.shiftKey && lower === 's') void actions.saveAll();
      else if (ctrl && lower === 's') void actions.save(e.altKey);
      else if (ctrl && lower === 'o') void actions.open();
      else if (ctrl && lower === 'n') actions.newDiagram();
      else if (ctrl && lower === 'e') void actions.exportPicture('png');
      else if (ctrl && lower === 'p') actions.print();
      else if (ctrl && lower === 'f') actions.find();
      else if (ctrl && lower === 't') actions.transmute();
      else if (ctrl && lower === 'k') st.openQuickDish(st.quickDish ? null : { x: window.innerWidth / 2, y: window.innerHeight / 2 });
      else if (ctrl && e.shiftKey && lower === 'x') actions.exportCode();
      else if (ctrl && e.shiftKey && lower === 'a') actions.toggleArrangerBoard();
      else if (ctrl && k === 'F11') actions.outsource();
      else if (ctrl && e.shiftKey && lower === 'r') actions.turtleizer();
      else if (ctrl && lower === 'r') actions.executor();
      else if (ctrl && lower === 'b') actions.breakpoint();
      else if (ctrl && k === '7') actions.disable();
      else if (ctrl && (k === '+' || k === '=')) actions.zoomIn();
      else if (ctrl && k === '-') actions.zoomOut();
      else if (ctrl && k === '0') actions.zoomReset();
      else if (ctrl && k === '9') actions.zoomFit();
      else if (ctrl && e.altKey && lower === 'v') usePrefs.getState().set({ switchTextComments: !usePrefs.getState().switchTextComments, commentsPlusText: false });
      else if (ctrl && k === 'ArrowUp') actions.moveUp();
      else if (ctrl && k === 'ArrowDown') actions.moveDown();
      else if (e.shiftKey && k === 'ArrowUp') st.extendSelection('up');
      else if (e.shiftKey && k === 'ArrowDown') st.extendSelection('down');
      else if (k === 'ArrowUp') st.navigate('up');
      else if (k === 'ArrowDown') st.navigate('down');
      else if (k === 'ArrowLeft') st.navigate('left');
      else if (k === 'ArrowRight') st.navigate('right');
      else if (k === 'Delete' || k === 'Backspace') actions.remove();
      else if (e.altKey && k === 'Enter') actions.attributes();
      else if (k === 'Enter') actions.editSelected();
      else if (k === 'F1' && e.shiftKey) actions.about();
      else if (k === 'F1' && e.altKey) actions.keys();
      else if (k === 'F1') actions.docs('#user-guide');
      else if (k === 'F4' && e.shiftKey) actions.togglePanel('code');
      else if (k === 'F3' && e.shiftKey) actions.togglePanel('index');
      else if (k === 'F3') actions.toggleAnalyser();
      else if (k === 'F4') usePrefs.getState().toggle('highlightVars');
      else if (e.code === 'NumpadSubtract') actions.collapse();
      else if (e.code === 'NumpadAdd') actions.expand();
      else if (k === 'Escape') { st.select(null); st.openContextMenu(null); st.openQuickDish(null); }
      else handled = false;
      if (handled) e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const title = parseSignature(s.diagram).name;
  const docCount = s.docs.length + 1;
  const hasEl = !!selEl;
  const selComment = p.showComments && selEl && selEl.comment.some((c) => c.trim() !== '')
    ? selEl.comment.map((c) => c.trim()).filter(Boolean).join(' · ')
    : '';

  return (
    <>
      <div className={'app' + (p.panelOpen ? ' with-panel' : '')}>
        <header className="topbar">
          <div className="brand">
            <img className="logo" src={appIcon} alt="" width={22} height={22} aria-hidden="true" />
            <span className="brand-name">Structorizer</span>
          </div>
          <MenuBar />
          <div className="doc-title" title={s.fileName ?? s.diagram.text.join(' ')}>
            <span className="doc-name">{s.fileName ?? title}</span>{dirty && <span className="dot" aria-label={t('unsaved')}> •</span>}
          </div>
          <div className="top-quick">
            <ToolButton label={t('executor')} pressed={exOpen} onClick={actions.executor}><Icon name="play" /></ToolButton>
            <ToolButton label={t('undo')} disabled={s.past.length === 0} onClick={actions.undo}><Icon name="undo" /></ToolButton>
            <ToolButton label={t('redo')} disabled={s.future.length === 0} onClick={actions.redo}><Icon name="redo" /></ToolButton>
            <ToolButton label={t('save')} onClick={() => void actions.save(false)}><Icon name="save" /></ToolButton>
            <ToolButton label={t('openPanel')} pressed={p.panelOpen} onClick={() => actions.togglePanel()}>
              <Icon name="panel" />{docCount > 1 && <span className="badge">{docCount}</span>}
            </ToolButton>
          </div>
        </header>

        <div className="toolbar" role="toolbar" aria-label={t('elements')}>
          <div className="tool-group"><div className="tool-row">
            {KINDS.map((k) => (
              <ToolButton key={k} label={t(('kind.' + k) as TKey)} onClick={(e) => actions.insert(k, e.shiftKey)}><KindIcon kind={k} /></ToolButton>
            ))}
            <ToolButton label={t('insertBefore')} pressed={s.insertBefore} onClick={() => s.setInsertBefore(!s.insertBefore)}><Icon name="before" /></ToolButton>
          </div><span className="group-label">{t('grpInsert')}</span></div>
          {!p.simplifiedToolbar && (
            <div className="tool-group"><div className="tool-row">
              <ToolButton label={t('edit')} onClick={actions.editSelected}><Icon name="edit" /></ToolButton>
              <ToolButton label={t('delete')} disabled={!hasEl} onClick={actions.remove}><Icon name="delete" /></ToolButton>
              <ToolButton label={t('cut')} disabled={!hasEl} onClick={actions.cut}><Icon name="cut" /></ToolButton>
              <ToolButton label={t('copy')} disabled={!hasEl} onClick={actions.copy}><Icon name="copy" /></ToolButton>
              <ToolButton label={t('paste')} disabled={!s.clipboard} onClick={actions.paste}><Icon name="paste" /></ToolButton>
              <ToolButton label={t('moveUp')} disabled={!hasEl} onClick={actions.moveUp}><Icon name="up" /></ToolButton>
              <ToolButton label={t('moveDown')} disabled={!hasEl} onClick={actions.moveDown}><Icon name="down" /></ToolButton>
              <ToolButton label={t('disable')} disabled={!hasEl} pressed={selEl?.disabled} onClick={actions.disable}><Icon name="disable" /></ToolButton>
              <ToolButton label={selEl?.collapsed ? t('expand') : t('collapse')} disabled={!selEl || !STRUCTURED_KINDS.has(selEl.kind)}
                pressed={!!selEl?.collapsed} onClick={actions.toggleCollapse}><Icon name="collapse" /></ToolButton>
            </div><span className="group-label">{t('grpEdit')}</span></div>
          )}
          <div className="tool-group push"><div className="tool-row">
            <ToolButton label={t('zoomOut')} onClick={actions.zoomOut}><Icon name="zoomOut" /></ToolButton>
            <button type="button" className="zoom-label" title={t('zoomReset')} onClick={actions.zoomReset}>{Math.round(s.zoom * 100)}%</button>
            <ToolButton label={t('zoomIn')} onClick={actions.zoomIn}><Icon name="zoomIn" /></ToolButton>
            <ToolButton label={t('zoomFit')} onClick={actions.zoomFit}><Icon name="zoomFit" /></ToolButton>
          </div><span className="group-label">{t('grpView')}</span></div>
        </div>

        {p.execPosition === 'top' && <ExecutorPanel placement="vertical" />}

        <main className="workspace">
          {p.panelPosition === 'left' && <SidePanel />}
          {p.execPosition === 'left' && <ExecutorPanel placement="horizontal" />}
          <DiagramView />
          {p.execPosition === 'right' && <ExecutorPanel placement="horizontal" />}
          {p.panelPosition !== 'left' && <SidePanel />}
        </main>

        {p.execPosition !== 'top' && <ExecutorPanel placement="vertical" />}

        <footer className="statusbar">
          <span className="status-left">
            {sel ? (selEl ? t(('kind.' + selEl.kind) as TKey) : sel.t === 'root' ? t('diagramProps').replace(/\s*\.\.\.$/, '') : '∅') : t('selectHint')}
            {selComment ? ` — ${selComment}` : ''}
          </span>
          <span className={'status-right' + (storageOk ? '' : ' warn')}>{storageOk ? t('autosaved') : t('unsaved')}</span>
        </footer>

        <ElementEditor />
        <DiagramEditor />
        <Dialogs />
        <ContextMenu />

        {dropActive && (
          <div className="drop-overlay" aria-live="polite">
            <div className="drop-card">
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 3v12M7 10l5 5 5-5M4 19h16" />
              </svg>
              <span>{t('dropFiles')}</span>
            </div>
          </div>
        )}

        {s.message && (
          <div className={'toast ' + s.message.kind} role="status" onClick={() => useStore.setState({ message: null })}>{s.message.text}</div>
        )}
      </div>
      <div id="print-area" aria-hidden="true" />
    </>
  );
}
