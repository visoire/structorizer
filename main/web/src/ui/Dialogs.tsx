// SPDX-License-Identifier: GPL-3.0-or-later
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { LANGUAGES, type LangId } from '../core/gen/generators';
import { findById, KEYWORD_KEYS, updateElement, walk, type Element, type Keywords } from '../core/model';
import { LANGS, useTranslator, type Lang, type TKey } from '../i18n';
import { useStore } from '../store/diagramStore';
import { usePrefs, type ExecPosition, type PanelPosition, type Theme } from '../store/prefsStore';
import appIcon from '../assets/app-icon.png';
import { actions } from './actions';
import { APP_VERSION, STRUCTORIZER_VERSION, clearLocalData } from './exporters';
import { Modal } from './ElementEditor';
import { InstallDialog } from './InstallTip';
import { INSERT_KEYS, useMenus } from './MenuBar';
import { FONT_IDS, fontStack, type FontId } from './fonts';

const REPO_URL = 'https://github.com/visoire/Structorizer';

// ------------------------------------------------------------------ Preferences

function PrefsDialog() {
  const p = usePrefs();
  const s = useStore();
  const t = useTranslator(p.lang);
  const [tab, setTab] = useState<'general' | 'fonts' | 'view' | 'export' | 'parser' | 'data'>('general');
  const [kw, setKw] = useState<Keywords>({ ...s.diagram.keywords });
  const close = () => s.setDialog(null);
  const Check = ({ k, label }: { k: 'showComments' | 'highlightVars' | 'cOperators' | 'switchTextComments' | 'commentsPlusText' | 'analyserWarnings' | 'darkDiagram' | 'simplifiedToolbar' | 'involveSubroutines' | 'confirmDelete'; label: TKey }) => (
    <label className="check"><input type="checkbox" checked={p[k]} onChange={() => p.toggle(k)} /> {t(label)}</label>
  );
  const applyKeywords = () => {
    s.commit({ ...s.diagram, keywords: kw });
  };
  return (
    <Modal title={t('prefsDialog').replace(/\s*\.\.\.$/, '')} onClose={close} cancelLabel={t('close')} wide>
      <div className="tabs" role="tablist">
        {(['general', 'fonts', 'view', 'export', 'parser', 'data'] as const).map((x) => (
          <button key={x} type="button" role="tab" aria-selected={tab === x} onClick={() => setTab(x)}>
            {t(x === 'general' ? 'prefsGeneral' : x === 'fonts' ? 'prefsFonts' : x === 'view' ? 'prefsView' : x === 'export' ? 'prefsExport' : x === 'parser' ? 'prefsParser' : 'prefsData')}
          </button>
        ))}
      </div>
      {tab === 'general' && (
        <div className="form-grid">
          <label className="field"><span>{t('language')}</span>
            <select value={p.lang} onChange={(e) => p.set({ lang: e.target.value as Lang })}>
              {LANGS.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select></label>
          <fieldset className="radio-row"><legend>{t('theme')}</legend>
            {(['system', 'light', 'dark'] as Theme[]).map((th) => (
              <label key={th}><input type="radio" name="theme" checked={p.theme === th} onChange={() => p.set({ theme: th })} /> {t(th === 'system' ? 'themeSystem' : th === 'light' ? 'themeLight' : 'themeDark')}</label>
            ))}
          </fieldset>
          <Check k="darkDiagram" label="darkDiagram" />
          <Check k="simplifiedToolbar" label="simplifiedToolbar" />
          <Check k="confirmDelete" label="confirmDelete" />
        </div>
      )}
      {tab === 'fonts' && <FontsTab />}
      {tab === 'view' && (
        <div className="form-grid">
          <Check k="showComments" label="showComments" />
          <Check k="commentsPlusText" label="commentsPlusText" />
          <Check k="switchTextComments" label="switchTextComments" />
          <Check k="highlightVars" label="highlightVars" />
          <Check k="cOperators" label="cOperators" />
          <Check k="analyserWarnings" label="analyseStructogram" />
          <fieldset className="radio-row"><legend>{t('panelPos')}</legend>
            {(['right', 'left'] as PanelPosition[]).map((pos) => (
              <label key={pos}>
                <input type="radio" name="panelPos" checked={p.panelPosition === pos} onChange={() => p.set({ panelPosition: pos })} /> {t(pos === 'left' ? 'posLeft' : 'posRight')}
              </label>
            ))}
          </fieldset>
          <fieldset className="radio-row"><legend>{t('execPos')}</legend>
            {(['bottom', 'top', 'left', 'right'] as ExecPosition[]).map((pos) => (
              <label key={pos}>
                <input type="radio" name="execPos" checked={p.execPosition === pos} onChange={() => p.set({ execPosition: pos })} /> {t(pos === 'bottom' ? 'posBottom' : pos === 'top' ? 'posTop' : pos === 'left' ? 'posLeft' : 'posRight')}
              </label>
            ))}
          </fieldset>
        </div>
      )}
      {tab === 'export' && (
        <div className="form-grid">
          <label className="field"><span>{t('defaultLanguage')}</span>
            <select value={p.codeLang} onChange={(e) => p.set({ codeLang: e.target.value as LangId })}>
              {LANGUAGES.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select></label>
          <Check k="involveSubroutines" label="involveSubs" />
        </div>
      )}
      {tab === 'parser' && (
        <div>
          <p className="hint">{t('keywordsCurrent')}</p>
          <div className="kw-grid">
            {KEYWORD_KEYS.map((k) => (
              <label key={k} className="field compact"><span>{t(('kw.' + k) as TKey)}</span>
                <input type="text" value={kw[k]} spellCheck={false} onChange={(e) => setKw({ ...kw, [k]: e.target.value })} /></label>
            ))}
          </div>
          <label className="check"><input type="checkbox" checked={kw.ignoreCase} onChange={(e) => setKw({ ...kw, ignoreCase: e.target.checked })} /> {t('ignoreCase')}</label>
          <div className="row-actions">
            <button type="button" className="btn" onClick={() => { p.set({ defaultKeywords: kw }); }}>{t('keywordsDefault')}</button>
            <button type="button" className="btn primary" onClick={applyKeywords}>{t('apply')}</button>
          </div>
        </div>
      )}
      {tab === 'data' && (
        <div className="form-grid">
          <p>{t('dataLocal')}</p>
          <div className="row-actions">
            <button type="button" className="btn" onClick={actions.savePrefs}>{t('prefsSave')}</button>
            <button type="button" className="btn" onClick={() => void actions.loadPrefs()}>{t('prefsLoad')}</button>
            <button type="button" className="btn" onClick={() => p.reset()}>{t('prefsReset')}</button>
          </div>
          <button type="button" className="btn danger" onClick={() => {
            if (window.confirm(t('clearLocalConfirm'))) { clearLocalData(); location.reload(); }
          }}>{t('clearLocal')}</button>
        </div>
      )}
    </Modal>
  );
}


function FontsTab() {
  const p = usePrefs();
  const t = useTranslator(p.lang);
  const FontSelect = ({ value, custom, onFont, onCustom, label }: { value: FontId; custom: string; onFont: (f: FontId) => void; onCustom: (s: string) => void; label: TKey }) => (
    <div className="form-grid">
      <label className="field"><span>{t(label)}</span>
        <select value={value} onChange={(e) => onFont(e.target.value as FontId)}>
          {FONT_IDS.map((f) => <option key={f} value={f}>{t(('font.' + f) as TKey)}</option>)}
        </select></label>
      {value === 'custom' && (
        <label className="field compact"><span>{t('customFont')}</span>
          <input type="text" value={custom} placeholder="Segoe UI, Calibri, Comic Neue ..." spellCheck={false} onChange={(e) => onCustom(e.target.value)} /></label>
      )}
    </div>
  );
  return (
    <div className="form-grid">
      <FontSelect label="uiFont" value={p.uiFont} custom={p.customUiFont} onFont={(f) => p.set({ uiFont: f })} onCustom={(s) => p.set({ customUiFont: s })} />
      <FontSelect label="diagramFont" value={p.diagramFont} custom={p.customDiagramFont} onFont={(f) => p.set({ diagramFont: f })} onCustom={(s) => p.set({ customDiagramFont: s })} />
      <label className="field"><span>{t('fontSize')}: {p.diagramFontSize} px</span>
        <input type="range" min={10} max={22} step={1} value={p.diagramFontSize} onChange={(e) => p.set({ diagramFontSize: +e.target.value })} /></label>
      <div className="font-preview" style={{ fontFamily: fontStack(p.diagramFont, p.customDiagramFont), fontSize: p.diagramFontSize }}>
        x {'←'} (a + b) * 2 &nbsp; OUTPUT "Result: ", x &nbsp; while (i {'≤'} 10)
      </div>
      <p className="hint">{t('customFontHint')}</p>
      <h3>{t('exportLook')}</h3>
      <label className="check"><input type="checkbox" checked={p.exportColors} onChange={() => p.toggle('exportColors')} /> {t('exportColors')}</label>
      <label className="check"><input type="checkbox" checked={p.exportTransparent} onChange={() => p.toggle('exportTransparent')} /> {t('exportTransparent')}</label>
      <p className="hint">{t('exportLookHint')}</p>
    </div>
  );
}
// ------------------------------------------------------------------ Find / Replace

function FindDialog() {
  const s = useStore();
  const t = useTranslator(usePrefs((p) => p.lang));
  const [q, setQ] = useState('');
  const [rep, setRep] = useState('');
  const [caseSens, setCase] = useState(false);
  const [inComments, setInComments] = useState(true);
  const [pos, setPos] = useState(-1);

  const matcher = useMemo(() => {
    if (!q) return null;
    const esc = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(esc, caseSens ? 'g' : 'gi');
  }, [q, caseSens]);

  const matches = useMemo(() => {
    const out: Element[] = [];
    if (!matcher) return out;
    walk(s.diagram, (el) => {
      const hay = [...el.text, ...(inComments ? el.comment : [])].join('\n');
      matcher.lastIndex = 0;
      if (matcher.test(hay)) out.push(el);
    });
    return out;
  }, [s.diagram, matcher, inComments]);

  const go = (delta: number) => {
    if (matches.length === 0) return;
    const i = ((pos + delta) % matches.length + matches.length) % matches.length;
    setPos(i);
    s.select({ t: 'el', id: matches[i].id });
  };
  const replaceIn = (el: Element) => {
    if (!matcher) return el;
    const r = (l: string) => l.replace(matcher, rep);
    return { text: el.text.map(r), comment: inComments ? el.comment.map(r) : el.comment };
  };
  const replaceOne = () => {
    const sel = s.selection?.t === 'el' ? findById(s.diagram, s.selection.id)?.el : null;
    const target = sel && matches.includes(sel) ? sel : matches[0];
    if (!target) return;
    s.commit(updateElement(s.diagram, target.id, replaceIn(target) as { text: string[]; comment: string[] }));
  };
  const replaceAll = () => {
    let d = s.diagram;
    for (const m of matches) d = updateElement(d, m.id, replaceIn(m) as { text: string[]; comment: string[] });
    s.commit(d);
    s.notify(`${t('replacedN')}: ${matches.length}`);
  };

  return (
    <Modal title={t('findReplace').replace(/\s*\.\.\.$/, '')} onClose={() => s.setDialog(null)} cancelLabel={t('close')}>
      <label className="field"><span>{t('find')}</span>
        <input type="search" value={q} autoFocus onChange={(e) => { setQ(e.target.value); setPos(-1); }}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); go(e.shiftKey ? -1 : 1); } }} /></label>
      <label className="field"><span>{t('replaceWith')}</span>
        <input type="text" value={rep} onChange={(e) => setRep(e.target.value)} /></label>
      <label className="check"><input type="checkbox" checked={caseSens} onChange={(e) => setCase(e.target.checked)} /> {t('matchCase')}</label>
      <label className="check"><input type="checkbox" checked={inComments} onChange={(e) => setInComments(e.target.checked)} /> {t('inComments')}</label>
      <p className="hint" role="status">{q ? (matches.length ? `${pos >= 0 ? pos + 1 + ' / ' : ''}${matches.length} ${t('matches')}` : t('noMatches')) : ''}</p>
      <div className="row-actions">
        <button type="button" className="btn" disabled={!matches.length} onClick={() => go(-1)}>{t('findPrev')}</button>
        <button type="button" className="btn primary" disabled={!matches.length} onClick={() => go(1)}>{t('findNext')}</button>
        <button type="button" className="btn" disabled={!matches.length} onClick={replaceOne}>{t('replace')}</button>
        <button type="button" className="btn" disabled={!matches.length} onClick={replaceAll}>{t('replaceAll')}</button>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ PNG (multiple)

function PngMultiDialog() {
  const s = useStore();
  const t = useTranslator(usePrefs((p) => p.lang));
  const [cols, setCols] = useState(1);
  const [rows, setRows] = useState(2);
  const clamp = (v: number) => Math.min(10, Math.max(1, Math.round(v) || 1));
  return (
    <Modal title={t('pngMultiTitle')} onClose={() => s.setDialog(null)} cancelLabel={t('cancel')} okLabel={t('ok')}
      onOk={() => { s.setDialog(null); void actions.exportPngTiles(cols, rows); }}>
      <p className="hint">{t('pngMultiHint')}</p>
      <div className="form-row">
        <label className="field compact"><span>{t('columns')}</span><input type="number" min={1} max={10} value={cols} onChange={(e) => setCols(clamp(+e.target.value))} /></label>
        <label className="field compact"><span>{t('rows')}</span><input type="number" min={1} max={10} value={rows} onChange={(e) => setRows(clamp(+e.target.value))} /></label>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ Key bindings / About

function KeysDialog() {
  const s = useStore();
  const t = useTranslator(usePrefs((p) => p.lang));
  const menus = useMenus();
  const rows: [string, string][] = [];
  const visit = (items: ReturnType<typeof useMenus>[number]['items'], prefix: string) => {
    for (const it of items) {
      if (it.items) visit(it.items, `${prefix}${it.label} › `);
      else if (it.shortcut && !it.kind) rows.push([`${prefix}${it.label}`, it.shortcut]);
    }
  };
  for (const m of menus) visit(m.items, `${m.label} › `);
  return (
    <Modal title={t('keyBindings')} onClose={() => s.setDialog(null)} cancelLabel={t('close')} wide>
      <table className="keys">
        <thead><tr><th>{t('elements')}</th><th>{t('addAfter')}</th><th>{t('addBefore')}</th></tr></thead>
        <tbody>
          {INSERT_KEYS.map(([k, a, b]) => <tr key={k}><td>{t(('kind.' + k) as TKey)}</td><td><kbd>{a}</kbd></td><td><kbd>{b}</kbd></td></tr>)}
        </tbody>
      </table>
      <table className="keys">
        <tbody>
          {rows.map(([l, k]) => <tr key={l}><td>{l.replace(/\s*\.\.\.$/, '')}</td><td><kbd>{k}</kbd></td></tr>)}
          <tr><td>↑ ↓ ← →</td><td><kbd>Arrows</kbd></td></tr>
        </tbody>
      </table>
      <p className="hint small">{t('keysNote')}</p>
    </Modal>
  );
}

function AboutDialog() {
  const s = useStore();
  const t = useTranslator(usePrefs((p) => p.lang));
  return (
    <Modal title={`${t('appName')} ${STRUCTORIZER_VERSION}`} onClose={() => s.setDialog(null)} cancelLabel={t('close')}>
      <div className="about-head">
        <img src={appIcon} alt="" width={44} height={44} aria-hidden="true" />
        <p>{t('aboutText')}</p>
      </div>
      <p><strong>{t('privacy')}</strong></p>
      <p className="small">Web build {APP_VERSION} · GPL-3.0-or-later</p>
      <p>{t('sourceCode')}: <a href={REPO_URL} target="_blank" rel="noopener noreferrer">{REPO_URL}</a><br />
        Structorizer Desktop: <a href="https://github.com/fesch/Structorizer.Desktop" target="_blank" rel="noopener noreferrer">fesch/Structorizer.Desktop</a></p>
      <p><a href="./docs/" target="_blank" rel="noopener">{t('docs')}</a></p>
    </Modal>
  );
}

// ------------------------------------------------------------------ Arrangement group (assign / rename)

function GroupDialog() {
  const s = useStore();
  const t = useTranslator(usePrefs((p) => p.lang));
  const g = s.groupDialog!;
  const names = [...new Set(Object.values(s.groups))].sort((a, b) => a.localeCompare(b));
  const current = g.mode === 'assign' ? s.groups[g.docId] ?? '' : g.group;
  const [name, setName] = useState(current);
  const [error, setError] = useState('');
  const close = () => s.openGroupDialog(null);
  const apply = (value = name) => {
    const err = actions.checkGroupName(value, g.mode === 'rename' ? g.group : null);
    if (err !== null) { setError(err); return; }
    if (g.mode === 'assign') s.setDocGroup(g.docId, value);
    else if (value.trim()) s.renameGroup(g.group, value);
    close();
  };
  return (
    <Modal title={g.mode === 'assign' ? t('groupAssign').replace(/\s*\.\.\.$/, '') : t('groupRename')}
      onClose={close} cancelLabel={t('cancel')} okLabel={t('ok')} onOk={() => apply()}>
      {g.mode === 'assign' && (
        <div className="group-choices" role="radiogroup" aria-label={t('groupAssign')}>
          <button type="button" role="radio" aria-checked={current === ''} className={'btn' + (current === '' ? ' on' : '')}
            onClick={() => apply('')}>{t('groupNone')}</button>
          {names.map((n) => (
            <button key={n} type="button" role="radio" aria-checked={current === n} className={'btn' + (current === n ? ' on' : '')}
              onClick={() => apply(n)}>{n}</button>
          ))}
        </div>
      )}
      <label className="field"><span>{g.mode === 'assign' ? t('groupNew') : t('groupRenamePrompt')}</span>
        <input type="text" value={name} spellCheck={false} autoFocus={g.mode === 'rename'}
          onChange={(e) => { setName(e.target.value); setError(''); }}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); apply(); } }} /></label>
      {error && <p className="hint editor-warn" role="alert">{error}</p>}
      {g.mode === 'assign' && <p className="hint small">{t('groupPrompt')}</p>}
    </Modal>
  );
}

export function Dialogs() {
  const dialog = useStore((s) => s.dialog);
  const groupDialog = useStore((s) => s.groupDialog);
  if (groupDialog) return <GroupDialog key={JSON.stringify(groupDialog)} />;
  switch (dialog) {
    case 'prefs': return <PrefsDialog />;
    case 'find': return <FindDialog />;
    case 'pngMulti': return <PngMultiDialog />;
    case 'keys': return <KeysDialog />;
    case 'about': return <AboutDialog />;
    case 'install': return <InstallDialog />;
    default: return null;
  }
}

// ------------------------------------------------------------------ context menu

/**
 * Places a popup at the pointer so it always fits: it opens upwards/leftwards when there is no
 * room below/right and scrolls inside when even the full visual viewport is too short.
 */
function useFitPopup(anchor: { x: number; y: number } | null) {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ left: number; top: number; maxH: number } | null>(null);
  useLayoutEffect(() => {
    if (!anchor || !ref.current) { setBox(null); return; }
    const M = 8;
    const vv = window.visualViewport;
    const vw = vv?.width ?? window.innerWidth;
    const vh = vv?.height ?? window.innerHeight;
    const offX = vv?.offsetLeft ?? 0;
    const offY = vv?.offsetTop ?? 0;
    const el = ref.current;
    el.style.maxHeight = 'none';
    const w = el.offsetWidth;
    const h = el.scrollHeight;
    const maxH = Math.max(120, vh - 2 * M);
    const ax = anchor.x - offX;
    const ay = anchor.y - offY;
    const left = ax + w + M <= vw ? ax : Math.max(M, Math.min(ax - w, vw - w - M));
    let top: number;
    if (ay + Math.min(h, maxH) + M <= vh) top = ay; // fits below the pointer
    else if (ay - Math.min(h, maxH) >= M) top = ay - Math.min(h, maxH); // flip above
    else top = Math.max(M, vh - Math.min(h, maxH) - M); // pin to the bottom edge
    el.style.maxHeight = '';
    setBox({ left: left + offX, top: top + offY, maxH });
  }, [anchor]);
  return { ref, style: box ? { left: box.left, top: box.top, maxHeight: box.maxH } : { left: -9999, top: -9999, visibility: 'hidden' as const } };
}

export function ContextMenu() {
  const s = useStore();
  const t = useTranslator(usePrefs((p) => p.lang));
  const pos = s.contextMenu;
  const popup = useFitPopup(pos);
  if (!pos) return null;
  const el = s.selection?.t === 'el' ? findById(s.diagram, s.selection.id)?.el ?? null : null;
  const close = () => s.openContextMenu(null);
  const item = (label: string, fn: () => void, disabled = false) => (
    <button type="button" role="menuitem" className="menu-item" disabled={disabled} onClick={() => { close(); fn(); }}>
      <span className="mi-label">{label}</span>
    </button>
  );
  return (
    <div className="ctx-backdrop" onPointerDown={close} onContextMenu={(e) => { e.preventDefault(); close(); }}
      onWheel={close}>
      <div className="ctx-menu menu-list" role="menu" ref={popup.ref} style={popup.style}
        onPointerDown={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()}>
        {item(t('edit'), actions.editSelected)}
        {item(t('cut'), actions.cut, !el)}
        {item(t('copy'), actions.copy, !el)}
        {item(t('paste'), actions.paste, !s.clipboard)}
        {item(t('duplicate'), actions.duplicate, !el)}
        {item(t('delete'), actions.remove, !el)}
        <hr />
        {item(t('moveUp'), actions.moveUp, !el)}
        {item(t('moveDown'), actions.moveDown, !el)}
        {item(t('transmute'), actions.transmute, !el)}
        {item(t('outsource'), actions.outsource, !el)}
        {item(el?.collapsed ? t('expand') : t('collapse'), actions.toggleCollapse, !el)}
        {item(t('disable'), actions.disable, !el)}
        {item(t('breakpoint'), actions.breakpoint, !el)}
      </div>
    </div>
  );
}
