// SPDX-License-Identifier: GPL-3.0-or-later
// Menu bar with the structure of Structorizer Desktop 3.32 (gui/Menu.java).
import { useEffect, useRef, useState } from 'react';
import { findById, slotsOf, type ElementKind } from '../core/model';
import { LANGUAGES } from '../core/gen/generators';
import { EXAMPLES } from '../examples';
import { LANGS, useTranslator, type TKey } from '../i18n';
import { useStore } from '../store/diagramStore';
import { useExecStore } from '../store/execStore';
import { usePrefs } from '../store/prefsStore';
import { actions } from './actions';
import { getRecent } from './exporters';
import { KindIcon } from './icons';

export interface MenuItem {
  label: string;
  shortcut?: string;
  action?: () => void;
  disabled?: boolean;
  checked?: boolean;
  items?: MenuItem[];
  sep?: boolean;
  kind?: ElementKind;
  note?: string;
}
export interface Menu { label: string; items: MenuItem[] }

const SEP: MenuItem = { label: '', sep: true };

export const INSERT_KEYS: [ElementKind, string, string][] = [
  ['instruction', 'F5', 'Shift+F5'], ['alternative', 'F6', 'Shift+F6'], ['case', 'F10', 'Shift+F10'],
  ['for', 'F7', 'Shift+F7'], ['while', 'F8', 'Shift+F8'], ['repeat', 'F9', 'Shift+F9'],
  ['forever', 'Ctrl+F7', 'Shift+Ctrl+F7'], ['call', 'F11', 'Shift+F11'], ['jump', 'F12', 'Shift+F12'],
  ['parallel', 'Ctrl+F6', 'Shift+Ctrl+F6'], ['try', 'Ctrl+F5', 'Shift+Ctrl+F5'],
];

export function useMenus(): Menu[] {
  const s = useStore();
  const ex = useExecStore();
  const p = usePrefs();
  const t = useTranslator(p.lang);
  const sel = s.selection;
  const el = sel?.t === 'el' ? findById(s.diagram, sel.id)?.el ?? null : null;
  const structured = !!el && slotsOf(el).length > 0;
  const recent = getRecent();
  const lang = LANGUAGES.find((l) => l.id === p.codeLang)?.name ?? '';

  const addItems = (before: boolean): MenuItem[] => INSERT_KEYS.map(([k, after, bef]) => ({
    label: t(('kind.' + k) as TKey), kind: k, shortcut: before ? bef : after, action: () => actions.insert(k, before),
  }));

  return [
    {
      label: t('m.file'),
      items: [
        { label: t('new'), shortcut: 'Ctrl+N', action: actions.newDiagram },
        { label: t('open'), shortcut: 'Ctrl+O', action: () => void actions.open() },
        {
          label: t('openRecent'),
          items: recent.length ? recent.map((r) => ({ label: r.name, action: () => actions.openRecent(r) })) : [{ label: t('noRecent'), disabled: true }],
        },
        { label: t('examples'), items: EXAMPLES.map((ex) => ({ label: ex.title, action: () => actions.openXml(ex.xml, null) })) },
        SEP,
        { label: t('save'), shortcut: 'Ctrl+S', action: () => void actions.save(false) },
        { label: t('saveAs'), shortcut: 'Ctrl+Alt+S', action: () => void actions.save(true) },
        { label: t('saveAll'), shortcut: 'Ctrl+Shift+S', action: () => void actions.saveAll() },
        SEP,
        { label: t('import'), items: [{ label: t('importNsd'), action: () => void actions.open() }] },
        {
          label: t('export'),
          items: [
            {
              label: t('picture'),
              items: [
                { label: t('pngFile'), shortcut: 'Ctrl+E', action: () => void actions.exportPicture('png') },
                { label: t('pngMulti'), action: () => void actions.exportPicture('pngMulti') },
                { label: t('emfFile'), action: () => void actions.exportPicture('emf') },
                { label: t('swfFile'), action: () => void actions.exportPicture('swf'), note: t('swfNote') },
                { label: t('pdfFile'), action: () => void actions.exportPicture('pdf') },
                { label: t('svgFile'), action: () => void actions.exportPicture('svg') },
              ],
            },
            { label: t('code'), items: LANGUAGES.map((l) => ({ label: `${l.name} ...`, action: () => actions.exportCode(l.id) })) },
            { label: t('exportArrz'), action: actions.exportArrz },
            { label: t('exportArr'), action: actions.exportArr },
          ],
        },
        { label: `${t('exportFavCode')} (${lang})`, shortcut: 'Ctrl+Shift+X', action: () => actions.exportCode() },
        SEP,
        { label: t('attributes'), shortcut: 'Alt+Enter', action: actions.attributes },
        { label: t('print'), shortcut: 'Ctrl+P', action: actions.print },
        SEP,
        { label: t('clear'), action: actions.clear, disabled: s.diagram.children.length === 0 },
        { label: t('closeDiagram'), action: () => actions.closeDiagram() },
      ],
    },
    {
      label: t('m.edit'),
      items: [
        { label: t('undo'), shortcut: 'Ctrl+Z', action: actions.undo, disabled: s.past.length === 0 },
        { label: t('redo'), shortcut: 'Ctrl+Y', action: actions.redo, disabled: s.future.length === 0 },
        SEP,
        { label: t('cut'), shortcut: 'Ctrl+X', action: actions.cut, disabled: !el },
        { label: t('copy'), shortcut: 'Ctrl+C', action: actions.copy, disabled: !el },
        { label: t('paste'), shortcut: 'Ctrl+V', action: actions.paste, disabled: !s.clipboard },
        { label: t('duplicate'), shortcut: 'Ctrl+D', action: actions.duplicate, disabled: !el },
        { label: t('delete'), shortcut: 'Del', action: actions.remove, disabled: !el },
        SEP,
        { label: t('findReplace'), shortcut: 'Ctrl+F', action: actions.find },
        { label: t('copyPng'), shortcut: 'Ctrl+Shift+D', action: () => void actions.copyPicture() },
        SEP,
        { label: t('edit'), shortcut: 'Enter', action: actions.editSelected },
      ],
    },
    {
      label: t('m.view'),
      items: [
        { label: t('showComments'), checked: p.showComments, action: () => p.toggle('showComments') },
        { label: t('commentsPlusText'), checked: p.commentsPlusText, action: () => p.set({ commentsPlusText: !p.commentsPlusText, switchTextComments: false }) },
        { label: t('switchTextComments'), shortcut: 'Ctrl+Alt+V', checked: p.switchTextComments, action: () => p.set({ switchTextComments: !p.switchTextComments, commentsPlusText: false }) },
        { label: t('highlightVars'), shortcut: 'F4', checked: p.highlightVars, action: () => p.toggle('highlightVars') },
        { label: t('analyseStructogram'), shortcut: 'F3', checked: p.analyserWarnings, action: actions.toggleAnalyser },
        { label: t('cOperators'), checked: p.cOperators, action: () => p.toggle('cOperators') },
        SEP,
        { label: t('showIndex'), shortcut: 'Shift+F3', checked: p.panelOpen && p.panelTab === 'index', action: () => actions.togglePanel('index') },
        { label: t('showPreview'), shortcut: 'Shift+F4', checked: p.panelOpen && p.panelTab === 'code', action: () => actions.togglePanel('code') },
        { label: t('arrangerBoard'), shortcut: 'Ctrl+Shift+A', checked: s.viewMode === 'arranger', action: actions.toggleArrangerBoard },
        SEP,
        { label: t('zoomIn'), shortcut: 'Ctrl++', action: actions.zoomIn },
        { label: t('zoomOut'), shortcut: 'Ctrl+-', action: actions.zoomOut },
        { label: t('zoomReset'), shortcut: 'Ctrl+0', action: actions.zoomReset },
        { label: t('zoomFit'), action: actions.zoomFit },
      ],
    },
    {
      label: t('m.diagram'),
      items: [
        { label: t('addBefore'), items: addItems(true) },
        { label: t('addAfter'), items: addItems(false) },
        SEP,
        { label: t('edit'), shortcut: 'Enter', action: actions.editSelected },
        { label: t('delete'), shortcut: 'Del', action: actions.remove, disabled: !el },
        { label: t('moveUp'), shortcut: 'Ctrl+↑', action: actions.moveUp, disabled: !el },
        { label: t('moveDown'), shortcut: 'Ctrl+↓', action: actions.moveDown, disabled: !el },
        { label: t('transmute'), shortcut: 'Ctrl+T', action: actions.transmute, disabled: !el },
        { label: t('outsource'), shortcut: 'Ctrl+F11', action: actions.outsource, disabled: !el },
        SEP,
        { label: t('collapse'), shortcut: 'Num −', action: actions.collapse, disabled: !structured || !!el?.collapsed },
        { label: t('expand'), shortcut: 'Num +', action: actions.expand, disabled: !structured || !el?.collapsed },
        { label: t('disable'), shortcut: 'Ctrl+7', action: actions.disable, disabled: !el, checked: el?.disabled },
        SEP,
        {
          label: t('type'),
          items: [
            { label: t('typeMain'), checked: s.diagram.diagramType === 'program', action: () => actions.setType('program') },
            { label: t('typeSub'), checked: s.diagram.diagramType === 'sub', action: () => actions.setType('sub') },
            { label: t('typeIncl'), checked: s.diagram.diagramType === 'includable', action: () => actions.setType('includable') },
          ],
        },
        { label: t('unframed'), checked: !s.diagram.boxed, action: actions.toggleBoxed },
        { label: t('diagramProps'), action: actions.attributes },
      ],
    },
    {
      label: t('m.prefs'),
      items: [
        { label: t('prefsDialog'), action: actions.prefs },
        { label: t('language'), items: LANGS.map((l) => ({
          label: l.name, checked: p.lang === l.id, action: () => p.set({ lang: l.id }),
        })) },
        { label: t('theme'), items: (['system', 'light', 'dark'] as const).map((th) => ({
          label: t(th === 'system' ? 'themeSystem' : th === 'light' ? 'themeLight' : 'themeDark'), checked: p.theme === th, action: () => p.set({ theme: th }),
        })) },
        { label: t('simplifiedToolbar'), checked: p.simplifiedToolbar, action: () => p.toggle('simplifiedToolbar') },
        SEP,
        { label: t('prefsSave'), action: actions.savePrefs },
        { label: t('prefsLoad'), action: () => void actions.loadPrefs() },
      ],
    },
    {
      label: t('m.debug'),
      items: [
        { label: t('executor'), shortcut: 'Ctrl+R', checked: ex.open, action: actions.executor },
        { label: t('turtleizer'), shortcut: 'Ctrl+Shift+R', checked: ex.turtleOpen, action: actions.turtleizer },
        { label: t('breakpoint'), shortcut: 'Ctrl+B', checked: !!(el && ex.breakpoints.has(el.id)), action: actions.breakpoint, disabled: !el },
        { label: t('disable'), shortcut: 'Ctrl+7', action: actions.disable, disabled: !el },
        // desktop Executor: "Collect Run Data" and resetting it
        { label: t('coverage'), checked: ex.coverageOverlay, action: () => ex.toggleCoverage() },
        { label: t('coverageResetHint'), action: () => ex.resetCoverage(), disabled: !ex.coverageOverlay || ex.status === 'running' || ex.execState.execCounts.size === 0 },
      ],
    },
    {
      label: t('m.help'),
      items: [
        { label: t('userGuide'), shortcut: 'F1', action: () => actions.docs('#user-guide') },
        { label: t('docs'), action: () => actions.docs('') },
        { label: t('keyBindings'), shortcut: 'Alt+F1', action: actions.keys },
        SEP,
        { label: t('installMenu'), action: () => useStore.getState().setDialog('install') },
        { label: t('about'), shortcut: 'Shift+F1', action: actions.about },
      ],
    },
  ];
}

function MenuList({ items, close, depth = 0 }: { items: MenuItem[]; close: () => void; depth?: number }) {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <div className={'menu-list' + (depth ? ' sub' : '')} role="menu">
      {items.map((it, i) => {
        if (it.sep) return <hr key={i} />;
        if (it.items) {
          const isOpen = open === i;
          return (
            <div key={i} className="menu-group">
              <button type="button" role="menuitem" aria-haspopup="true" aria-expanded={isOpen} className="menu-item"
                onClick={() => setOpen(isOpen ? null : i)}>
                <span className="mi-check" />
                <span className="mi-label">{it.label}</span>
                <span className="mi-arrow" aria-hidden="true">{isOpen ? '▾' : '▸'}</span>
              </button>
              {isOpen && <MenuList items={it.items} close={close} depth={depth + 1} />}
            </div>
          );
        }
        return (
          <button key={i} type="button" className="menu-item" role={it.checked !== undefined ? 'menuitemcheckbox' : 'menuitem'}
            aria-checked={it.checked} disabled={it.disabled} title={it.note}
            onClick={() => { close(); it.action?.(); }}>
            <span className="mi-check" aria-hidden="true">{it.checked ? '✓' : it.kind ? <KindIcon kind={it.kind} /> : ''}</span>
            <span className="mi-label">{it.label}</span>
            {it.shortcut && <kbd>{it.shortcut}</kbd>}
          </button>
        );
      })}
    </div>
  );
}

export function MenuBar() {
  const menus = useMenus();
  const lang = usePrefs((p) => p.lang);
  const t = useTranslator(lang);
  const [open, setOpen] = useState<number | null>(null);
  const [sheet, setSheet] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = () => { setOpen(null); setSheet(false); };

  useEffect(() => {
    if (open === null && !sheet) return;
    const onDown = (e: PointerEvent) => { if (!(e.target instanceof Node) || !ref.current?.contains(e.target)) close(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('pointerdown', onDown); window.removeEventListener('keydown', onKey); };
  }, [open, sheet]);

  return (
    <div className="menubar" ref={ref}>
      <nav className="menubar-wide" aria-label={t('menu')}>
        {menus.map((m, i) => (
          <div key={m.label} className="menu-top">
            <button type="button" className={'menu-title' + (open === i ? ' on' : '')} aria-haspopup="true" aria-expanded={open === i}
              onClick={() => setOpen(open === i ? null : i)}
              onPointerEnter={(e) => { if (open !== null && open !== i && e.pointerType === 'mouse') setOpen(i); }}>
              {m.label}
            </button>
            {open === i && <div className="menu-drop"><MenuList items={m.items} close={close} /></div>}
          </div>
        ))}
      </nav>
      <div className="menubar-narrow">
        <button type="button" className="tool wide" aria-expanded={sheet} onClick={() => setSheet(!sheet)}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
          <span className="tool-label">{t('menu')}</span>
        </button>
        {sheet && (
          <div className="menu-sheet">
            <MenuList close={close} items={menus.map((m) => ({ label: m.label, items: m.items }))} />
          </div>
        )}
      </div>
    </div>
  );
}
