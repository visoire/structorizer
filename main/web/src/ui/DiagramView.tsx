// SPDX-License-Identifier: GPL-3.0-or-later
// Interactive diagram: tap selects, double tap edits, drag (mouse) or long press (touch) moves, pinch zooms.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createLayoutEngine, dropGap, hitBranchHead, hitTest, type Gap, type Hit, type Scene } from '../core/layout';
import { analyseDiagram, parseSignature } from '../core/lang';
import { DEFAULT_COLORS, findById, type ElementKind } from '../core/model';
import { isInside, sameRef } from '../core/model/tree';
import { sceneToSvg } from '../core/render/svg';
import { selectedIds, useStore, type Selection } from '../store/diagramStore';
import { useExecStore } from '../store/execStore';
import { useTranslator, type TKey } from '../i18n';
import { resolvedTheme, usePrefs } from '../store/prefsStore';
import { actions } from './actions';
import { measure, viewLayoutOptions } from './exporters';
import { Icon, KindIcon } from './icons';
import { DishGeometry, getCoalescedPoints, HardwareFeatureDetector, TouchArbitrator } from './ipad';

const LONG_PRESS_MS = 450;
const PEN_HOLD_MS = 220;
const DRAG_THRESHOLD = 6;
const DISH_KINDS: ElementKind[] = ['instruction', 'alternative', 'case', 'for', 'while', 'repeat', 'forever', 'call', 'jump', 'parallel', 'try'];

interface PressState {
  pointerId: number;
  type: string;
  x: number; y: number;
  hit: Hit | null;
  dragging: boolean;
  timer: number | null;
  cancelled: boolean;
  /** moved after the drag started (otherwise a long press opens the context menu) */
  movedInDrag?: boolean;
}

function selectionOf(hit: Hit | null): Selection {
  if (!hit) return null;
  if (hit.t === 'el') return { t: 'el', id: hit.id };
  if (hit.t === 'seq') return { t: 'seq', ref: hit.ref };
  return { t: 'root' };
}

function sameSelection(a: Selection, b: Selection): boolean {
  if (!a || !b || a.t !== b.t) return false;
  if (a.t === 'el' && b.t === 'el') return a.id === b.id;
  if (a.t === 'seq' && b.t === 'seq') return sameRef(a.ref, b.ref);
  return a.t === 'root';
}

export function DiagramView() {
  const diagram = useStore((s) => s.diagram);
  const docs = useStore((s) => s.docs);
  const viewMode = useStore((s) => s.viewMode);
  const selection = useStore((s) => s.selection);
  const zoom = useStore((s) => s.zoom);
  const prefs = usePrefs();
  const t = useTranslator(prefs.lang);
  const optKey = [prefs.cOperators, prefs.highlightVars, prefs.showComments, prefs.switchTextComments, prefs.commentsPlusText, prefs.diagramFont, prefs.customDiagramFont, prefs.diagramFontSize].join();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const engine = useMemo(() => createLayoutEngine(measure(), viewLayoutOptions()), [optKey]);
  const scene: Scene = useMemo(() => engine.layout(diagram), [engine, diagram]);
  const pool = useMemo(() => [diagram, ...docs.map((d) => d.diagram)], [diagram, docs]);
  const findingsByEl = useMemo(() => {
    const map = new Map<string, string[]>();
    if (!prefs.analyserWarnings) return map;
    for (const f of analyseDiagram(diagram, pool)) {
      const list = map.get(f.elementId) ?? [];
      list.push(`[${f.code}] ${f.message}`);
      map.set(f.elementId, list);
    }
    return map;
  }, [prefs.analyserWarnings, diagram, pool]);
  const [sysDark, setSysDark] = useState(() => resolvedTheme('system') === 'dark');
  useEffect(() => {
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const on = () => setSysDark(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  const dark = (prefs.theme === 'dark' || (prefs.theme === 'system' && sysDark)) && prefs.darkDiagram;
  const svg = useMemo(() => sceneToSvg(scene, { scale: zoom, theme: dark ? 'dark' : 'light' }), [scene, zoom, dark]);

  const hostRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const press = useRef<PressState | null>(null);
  const lastTap = useRef<{ time: number; sel: Selection }>({ time: 0, sel: null });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; zoom: number } | null>(null);
  const arbitrator = useRef(new TouchArbitrator());
  const [dragId, setDragId] = useState<string | null>(null);
  const [gap, setGap] = useState<Gap | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const quickDish = useStore((s) => s.quickDish);
  const runningElementId = useExecStore((s) => s.runningElementId);
  const breakpoints = useExecStore((s) => s.breakpoints);
  const coverageOverlay = useExecStore((s) => s.coverageOverlay);
  const execState = useExecStore((s) => s.execState);
  // Subscribe to tick so coverage counts update live during execution
  useExecStore((s) => s.tick);

  const toScene = (clientX: number, clientY: number) => {
    const r = hostRef.current!.getBoundingClientRect();
    return { x: (clientX - r.left) / zoom, y: (clientY - r.top) / zoom };
  };

  // Block native scrolling while a touch drag is active (iOS ignores touch-action changes mid-gesture).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onTouchMove = (e: TouchEvent) => { if (press.current?.dragging || pinch.current) e.preventDefault(); };
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    return () => el.removeEventListener('touchmove', onTouchMove);
  }, []);

  const validGap = (g: Gap | null, id: string): Gap | null => {
    if (!g) return null;
    const d = useStore.getState().diagram;
    if (g.ref.owner !== 'root' && (g.ref.owner === id || isInside(d, id, g.ref.owner))) return null;
    // dropping right before or after itself changes nothing
    const own = findById(d, id);
    if (own && sameRef(own.parentSeq, g.ref) && (g.index === own.index || g.index === own.index + 1)) return null;
    return g;
  };

  // ---------- zoom that keeps the point under the pointer / pinch centre (or the view centre) in place
  const zoomAnchor = useRef<{ ax: number; ay: number } | null>(null);
  const prevZoom = useRef(zoom);
  const prevOff = useRef({ x: 0, y: 0 });
  const zoomAt = (z: number, clientX?: number, clientY?: number) => {
    const sc = scrollRef.current;
    if (sc && clientX !== undefined && clientY !== undefined) {
      const r = sc.getBoundingClientRect();
      zoomAnchor.current = { ax: clientX - r.left, ay: clientY - r.top };
    }
    useStore.getState().setZoom(z);
  };
  useLayoutEffect(() => {
    const sc = scrollRef.current;
    const host = hostRef.current;
    if (!sc || !host) return;
    if (prevZoom.current !== zoom) {
      const a = zoomAnchor.current ?? { ax: sc.clientWidth / 2, ay: sc.clientHeight / 2 };
      const sx = (sc.scrollLeft + a.ax - prevOff.current.x) / prevZoom.current;
      const sy = (sc.scrollTop + a.ay - prevOff.current.y) / prevZoom.current;
      sc.scrollLeft = host.offsetLeft + sx * zoom - a.ax;
      sc.scrollTop = host.offsetTop + sy * zoom - a.ay;
    }
    zoomAnchor.current = null;
    prevZoom.current = zoom;
    prevOff.current = { x: host.offsetLeft, y: host.offsetTop };
  });

  // Ctrl/Cmd + wheel and trackpad pinch (which Chromium/Safari report as ctrl+wheel) zoom at the pointer
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
      const factor = Math.exp(Math.max(-60, Math.min(60, -e.deltaY * unit)) * 0.006);
      zoomAt(useStore.getState().zoom * factor, e.clientX, e.clientY);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode]);

  // ---------- auto-scroll while dragging an element near the edges (long diagrams, small iPad views)
  const dragPt = useRef<{ x: number; y: number } | null>(null);
  const [ghost, setGhost] = useState<{ x: number; y: number } | null>(null);
  const sceneRef = useRef(scene);
  sceneRef.current = scene;
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  useEffect(() => {
    if (!dragId) return;
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const sc = scrollRef.current;
      const pt = dragPt.current;
      if (!sc || !pt) return;
      const r = sc.getBoundingClientRect();
      const EDGE = 48;
      const speed = (d: number) => (d < EDGE ? Math.ceil(((EDGE - d) / EDGE) * 18) : 0);
      const dy = speed(pt.y - r.top) > 0 ? -speed(pt.y - r.top) : speed(r.bottom - pt.y);
      const dx = speed(pt.x - r.left) > 0 ? -speed(pt.x - r.left) : speed(r.right - pt.x);
      if (!dx && !dy) return;
      const beforeL = sc.scrollLeft, beforeT = sc.scrollTop;
      sc.scrollLeft += dx;
      sc.scrollTop += dy;
      if (sc.scrollLeft === beforeL && sc.scrollTop === beforeT) return;
      const hr = hostRef.current!.getBoundingClientRect();
      const z = zoomRef.current;
      setGap(validGap(dropGap(sceneRef.current, (pt.x - hr.left) / z, (pt.y - hr.top) / z), dragId));
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragId]);

  // ---------- mouse panning: drag on the empty desk (left button) or anywhere (middle button)
  const pan = useRef<{ id: number; x: number; y: number; sl: number; st: number; moved: boolean } | null>(null);
  const [panning, setPanning] = useState(false);

  const startDrag = (p: PressState) => {
    if (!p.hit || p.hit.t !== 'el') return;
    p.dragging = true;
    // keep receiving moves when the finger/pencil leaves the diagram (auto-scroll at the edges)
    try { hostRef.current?.setPointerCapture(p.pointerId); } catch { /* ignore */ }
    setDragId(p.hit.id);
    useStore.getState().select({ t: 'el', id: p.hit.id });
    if (navigator.vibrate) { try { navigator.vibrate(15); } catch { /* ignore */ } }
  };

  // ---------- comment pop-up while hovering a commented element or the diagram frame
  // ("Show comments?" mode, like the desktop tooltip)
  const [commentTip, setCommentTip] = useState<{ key: string; x: number; y: number; lines: string[] } | null>(null);
  const tipTimer = useRef<number | null>(null);
  const tipKey = useRef<string | null>(null);
  const hideCommentTip = () => {
    if (tipTimer.current) { clearTimeout(tipTimer.current); tipTimer.current = null; }
    tipKey.current = null;
    setCommentTip(null);
  };
  const updateCommentTip = (h: Hit | null, x: number, y: number) => {
    const lines = !prefs.showComments || !h || h.t === 'seq' ? []
      : (h.t === 'el' ? h.comment : diagram.comment).map((c) => c.trimEnd()).filter((c) => c.trim() !== '');
    const key = lines.length === 0 || !h ? null : h.t === 'el' ? h.id : 'root';
    if (key !== tipKey.current) {
      hideCommentTip();
      if (!key) return;
      tipKey.current = key;
      tipTimer.current = window.setTimeout(() => setCommentTip({ key, x, y, lines }), 450);
      return;
    }
    if (key) setCommentTip((tip) => (tip ? { ...tip, x, y } : tip));
  };

  const onPointerDown = (e: React.PointerEvent) => {
    hideCommentTip();
    const arb = arbitrator.current.onPointerDown(e.nativeEvent);
    if (arb.reject) {
      e.preventDefault();
      return;
    }
    setHoverId(null);
    const hw = HardwareFeatureDetector.inspectPointerEvent(e.nativeEvent);
    if (hw.isSqueeze) {
      useStore.getState().openQuickDish({ x: e.clientX, y: e.clientY });
      return;
    }
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      // pinch zoom start: cancel any press
      if (press.current?.timer) clearTimeout(press.current.timer);
      press.current = null;
      const [a, b] = [...pointers.current.values()];
      pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), zoom };
      return;
    }
    if (pointers.current.size > 2) {
      if (press.current?.timer) clearTimeout(press.current.timer);
      press.current = null;
      pinch.current = null;
      return;
    }
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    const pt = toScene(e.clientX, e.clientY);
    const hit = hitTest(scene, pt.x, pt.y);
    const p: PressState = { pointerId: e.pointerId, type: e.pointerType, x: e.clientX, y: e.clientY, hit, dragging: false, timer: null, cancelled: false };
    if (e.pointerType !== 'mouse' && hit?.t === 'el') {
      const holdMs = e.pointerType === 'pen' ? PEN_HOLD_MS : LONG_PRESS_MS;
      p.timer = window.setTimeout(() => { if (press.current === p && !p.cancelled) startDrag(p); }, holdMs);
    }
    press.current = p;
  };

  const onPointerMove = (e: React.PointerEvent) => {
    arbitrator.current.onPointerMove(e.nativeEvent);
    if (e.buttons === 0 && !press.current && (e.pointerType === 'mouse' || e.pointerType === 'pen')) {
      const pt = toScene(e.clientX, e.clientY);
      const h = hitTest(scene, pt.x, pt.y);
      updateCommentTip(h, e.clientX, e.clientY);
      // Apple Pencil Hover (M2+ iPad Pro / Air): highlight target element before touching glass
      if (e.pointerType === 'pen') { setHoverId(h?.t === 'el' ? h.id : null); return; }
    }
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch.current && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch.current.dist > 0) zoomAt(pinch.current.zoom * (d / pinch.current.dist), (a.x + b.x) / 2, (a.y + b.y) / 2);
      return;
    }
    const p = press.current;
    if (!p || p.pointerId !== e.pointerId) return;
    const pts = getCoalescedPoints(e.nativeEvent);
    const lastPt = pts[pts.length - 1];
    const moved = Math.hypot(lastPt.x - p.x, lastPt.y - p.y);
    if (!p.dragging) {
      if ((p.type === 'mouse' || p.type === 'pen') && moved > DRAG_THRESHOLD && p.hit?.t === 'el') {
        if (p.timer) clearTimeout(p.timer);
        startDrag(p);
        p.movedInDrag = true;
        try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* ignore */ }
      } else if (p.type === 'touch' && moved > 10) {
        p.cancelled = true; // it is a scroll
        if (p.timer) clearTimeout(p.timer);
      }
      return;
    }
    if (moved > 8) p.movedInDrag = true;
    if (!p.movedInDrag) return;
    dragPt.current = { x: lastPt.x, y: lastPt.y };
    setGhost({ x: lastPt.x, y: lastPt.y });
    const pt = toScene(lastPt.x, lastPt.y);
    setGap(validGap(dropGap(scene, pt.x, pt.y), (p.hit as Extract<Hit, { t: 'el' }>).id));
  };

  const finish = (e: React.PointerEvent, cancelled: boolean) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    if (cancelled) {
      arbitrator.current.onPointerCancel(e.nativeEvent);
    } else {
      const multiAction = arbitrator.current.onPointerUp(e.nativeEvent);
      if (multiAction === 'undo') {
        if (press.current?.timer) clearTimeout(press.current.timer);
        press.current = null;
        actions.undo();
        return;
      }
      if (multiAction === 'redo') {
        if (press.current?.timer) clearTimeout(press.current.timer);
        press.current = null;
        actions.redo();
        return;
      }
    }
    const p = press.current;
    if (!p || p.pointerId !== e.pointerId) return;
    if (p.timer) clearTimeout(p.timer);
    press.current = null;
    const store = useStore.getState();
    if (p.dragging) {
      if (!cancelled && gap && p.hit?.t === 'el' && p.movedInDrag) store.move(p.hit.id, { seq: gap.ref, index: gap.index });
      else if (!cancelled && !p.movedInDrag && p.type !== 'mouse') store.openContextMenu({ x: e.clientX, y: e.clientY });
      setDragId(null);
      setGap(null);
      setGhost(null);
      dragPt.current = null;
      return;
    }
    if (cancelled || p.cancelled) return;
    const pt = toScene(e.clientX, e.clientY);
    const branchHead = hitBranchHead(p.hit, pt.x, pt.y);
    const sel: Selection = p.hit?.t === 'el' && branchHead >= 0
      ? { t: 'el', id: p.hit.id, branchHead }
      : selectionOf(p.hit);
    const now = Date.now();
    const isDouble = now - lastTap.current.time < 400 && sameSelection(lastTap.current.sel, sel);
    lastTap.current = { time: now, sel };
    if (e.shiftKey && sel?.t === 'el' && sel.branchHead === undefined) {
      store.selectRangeTo(sel.id);
    } else {
      store.select(sel);
    }
    if (isDouble) {
      if (sel?.t === 'el') store.openEditor({ t: 'el', id: sel.id, isNew: false });
      else if (e.pointerType === 'pen') store.openQuickDish({ x: e.clientX, y: e.clientY });
      else if (sel?.t === 'root') store.openEditor({ t: 'root' });
    }
  };

  // selection overlay geometry
  const selIds = useMemo(() => new Set(selectedIds(selection)), [selection]);
  const selHits = useMemo(() => {
    if (!selection || selection.t !== 'el') return [];
    return scene.hits.filter((h): h is Extract<Hit, { t: 'el' }> => h.t === 'el' && selIds.has(h.id));
  }, [scene, selection, selIds]);
  const selHit = useMemo(() => {
    if (!selection) return null;
    return scene.hits.find((h) =>
      (selection.t === 'el' && h.t === 'el' && h.id === selection.id) ||
      (selection.t === 'seq' && h.t === 'seq' && sameRef(h.ref, selection.ref)) ||
      (selection.t === 'root' && h.t === 'root')) ?? null;
  }, [scene, selection]);

  const activeBranchPoly = useMemo(() => {
    if (selection?.t !== 'el' || selection.branchHead === undefined || !selHit || selHit.t !== 'el') return null;
    return selHit.branchHeads?.[selection.branchHead] ?? null;
  }, [selection, selHit]);

  const activeBranchColor = useMemo(() => {
    if (selection?.t !== 'el' || selection.branchHead === undefined) return 'ffffff';
    const el = findById(diagram, selection.id)?.el;
    if (!el || (el.kind !== 'alternative' && el.kind !== 'case')) return 'ffffff';
    return el.branchHeadColors?.[selection.branchHead] || 'ffffff';
  }, [diagram, selection]);

  // fit to window on request
  const fitTick = useStore((s) => s.fitTick);
  useEffect(() => {
    if (fitTick === 0 || !scrollRef.current) return;
    const sc = scrollRef.current;
    const z = Math.min((sc.clientWidth - 64) / scene.width, (sc.clientHeight - 64) / scene.height);
    useStore.getState().setZoom(Math.max(0.3, Math.min(2, z)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitTick]);

  // keep the selection visible
  useEffect(() => {
    if (!selHit || !scrollRef.current || !hostRef.current) return;
    const sc = scrollRef.current;
    const host = hostRef.current;
    const top = host.offsetTop + selHit.y * zoom;
    const bottom = top + Math.min(selHit.h * zoom, sc.clientHeight - 40);
    if (top < sc.scrollTop) sc.scrollTop = top - 20;
    else if (bottom > sc.scrollTop + sc.clientHeight) sc.scrollTop = bottom - sc.clientHeight + 20;
    // only when the selection changes: zooming keeps the point under the pointer instead
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selHit]);

  const hoverHit = useMemo(() => {
    if (!hoverId || selIds.has(hoverId)) return null;
    return scene.hits.find((h): h is Extract<Hit, { t: 'el' }> => h.t === 'el' && h.id === hoverId) ?? null;
  }, [scene, hoverId, selIds]);

  const runHit = useMemo(() => {
    if (!runningElementId) return null;
    return scene.hits.find((h): h is Extract<Hit, { t: 'el' }> => h.t === 'el' && h.id === runningElementId) ?? null;
  }, [scene, runningElementId]);

  const dragHit = useMemo(() => {
    if (!dragId || !ghost) return null;
    return scene.hits.find((h): h is Extract<Hit, { t: 'el' }> => h.t === 'el' && h.id === dragId) ?? null;
  }, [scene, dragId, ghost]);

  const elHitsAll = useMemo(
    () => scene.hits.filter((h): h is Extract<Hit, { t: 'el' }> => h.t === 'el'),
    [scene],
  );

  const overlay = (
    <svg className="overlay" width={scene.width * zoom} height={scene.height * zoom} viewBox={`0 0 ${scene.width} ${scene.height}`} aria-hidden="true">
      {coverageOverlay && elHitsAll.map((h) => {
        const count = execState.execCounts.get(h.id) ?? 0;
        const cov = execState.covered.has(h.id);
        if (!cov && count === 0) return null;
        return (
          <g key={'cov-' + h.id}>
            <rect x={h.head.x + 1} y={h.head.y + 1} width={Math.max(0, h.head.w - 1)} height={Math.max(0, h.head.h - 1)} className="cov-fill" />
            {count > 0 && (
              <text x={h.x + h.w - 4} y={h.y + 12} textAnchor="end" className="cov-count">{count}×</text>
            )}
          </g>
        );
      })}
      {hoverHit && (
        <rect x={hoverHit.x + 1} y={hoverHit.y + 1} width={Math.max(0, hoverHit.w - 1)} height={Math.max(0, hoverHit.h - 1)} className="hover-outline" />
      )}
      {selHits.map((h) => (
        <g key={h.id}>
          {!activeBranchPoly && (
            <rect x={h.head.x + 1} y={h.head.y + 1} width={Math.max(0, h.head.w - 1)} height={Math.max(0, h.head.h - 1)} className="sel-fill" />
          )}
          <rect x={h.x + 1} y={h.y + 1} width={Math.max(0, h.w - 1)} height={Math.max(0, h.h - 1)} className="sel-outline" />
        </g>
      ))}
      {runHit && (
        <g>
          <rect x={runHit.head.x + 1} y={runHit.head.y + 1} width={Math.max(0, runHit.head.w - 1)} height={Math.max(0, runHit.head.h - 1)} className="run-fill" />
          <rect x={runHit.x + 1} y={runHit.y + 1} width={Math.max(0, runHit.w - 1)} height={Math.max(0, runHit.h - 1)} className="run-outline" />
        </g>
      )}
      {elHitsAll.map((h) => (
        breakpoints.has(h.id) ? (
          <line key={'bp-' + h.id} x1={h.x + 1} y1={h.y + 2} x2={h.x + h.w - 1} y2={h.y + 2} className="bp-bar" />
        ) : null
      ))}
      {elHitsAll.map((h) => {
        const msgs = findingsByEl.get(h.id);
        if (!msgs || msgs.length === 0) return null;
        return (
          <polygon key={'warn-' + h.id} points={`${h.x + 2},${h.y + 2} ${h.x + 13},${h.y + 2} ${h.x + 2},${h.y + 13}`} className="warn-tri">
            <title>{msgs.join('\n')}</title>
          </polygon>
        );
      })}
      {activeBranchPoly && (
        <polygon points={activeBranchPoly.map(([x, y]) => `${x},${y}`).join(' ')} className="sel-fill sel-outline" />
      )}
      {selHit && selHit.t === 'seq' && (
        <rect x={selHit.x + 1} y={selHit.y + 1} width={selHit.w - 1} height={selHit.h - 1} className="sel-fill sel-outline" />
      )}
      {selHit && selHit.t === 'root' && (
        <rect x={1.5} y={1.5} width={selHit.w - 2} height={selHit.h - 2} className="sel-outline" />
      )}
      {dragHit && (
        <rect x={dragHit.x + 1} y={dragHit.y + 1} width={Math.max(0, dragHit.w - 1)} height={Math.max(0, dragHit.h - 1)} className="drag-src" />
      )}
      {dragId && gap && (
        <g className="drop">
          <line x1={gap.x + 2} y1={gap.y} x2={gap.x + gap.w - 2} y2={gap.y} />
          <circle cx={gap.x + 4} cy={gap.y} r={4} />
        </g>
      )}
    </svg>
  );

  const branchPopoverPos = useMemo(() => {
    if (!activeBranchPoly) return null;
    const xs = activeBranchPoly.map((p) => p[0]);
    const ys = activeBranchPoly.map((p) => p[1]);
    return {
      left: ((Math.min(...xs) + Math.max(...xs)) / 2) * zoom,
      top: Math.max(...ys) * zoom + 6,
    };
  }, [activeBranchPoly, zoom]);

  if (viewMode === 'arranger') {
    return <ArrangerBoard engine={engine} dark={dark} />;
  }

  return (
    <div className={'diagram-scroll' + (panning ? ' panning' : '')} ref={scrollRef}
      onPointerDown={(e) => {
        const sc = scrollRef.current!;
        const onDesk = e.target === sc;
        const middle = e.pointerType === 'mouse' && e.button === 1;
        if (middle) e.preventDefault(); // no autoscroll cursor (Windows)
        if (e.pointerType === 'mouse' && ((onDesk && e.button === 0) || middle)) {
          pan.current = { id: e.pointerId, x: e.clientX, y: e.clientY, sl: sc.scrollLeft, st: sc.scrollTop, moved: false };
          try { sc.setPointerCapture(e.pointerId); } catch { /* ignore */ }
          return;
        }
        if (onDesk) useStore.getState().select(null);
      }}
      onPointerMove={(e) => {
        const pn = pan.current;
        if (!pn || pn.id !== e.pointerId) return;
        const dx = e.clientX - pn.x, dy = e.clientY - pn.y;
        if (!pn.moved && Math.hypot(dx, dy) < 4) return;
        if (!pn.moved) { pn.moved = true; setPanning(true); }
        const sc = scrollRef.current!;
        sc.scrollLeft = pn.sl - dx;
        sc.scrollTop = pn.st - dy;
      }}
      onPointerUp={(e) => {
        const pn = pan.current;
        if (!pn || pn.id !== e.pointerId) return;
        pan.current = null;
        setPanning(false);
        if (!pn.moved && e.target === scrollRef.current) useStore.getState().select(null);
      }}
      onPointerCancel={() => { pan.current = null; setPanning(false); }}
      onAuxClick={(e) => { if (e.button === 1) e.preventDefault(); }}>
      <div
        className={'diagram-host' + (dragId ? ' dragging' : '')}
        ref={hostRef}
        style={{ width: scene.width * zoom, height: scene.height * zoom }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(e) => finish(e, false)}
        onPointerCancel={(e) => finish(e, true)}
        onPointerLeave={() => { setHoverId(null); hideCommentTip(); }}
        onContextMenu={(e) => {
          e.preventDefault();
          if (press.current && press.current.type !== 'mouse') return;
          const pt = toScene(e.clientX, e.clientY);
          const sel = selectionOf(hitTest(scene, pt.x, pt.y));
          useStore.getState().select(sel);
          useStore.getState().openContextMenu({ x: e.clientX, y: e.clientY });
        }}
        role="application"
        aria-label={t('appName')}
      >
        <div className="diagram-svg" dangerouslySetInnerHTML={{ __html: svg }} />
        {overlay}
        {branchPopoverPos && (
          <div className="branch-color-bar" style={{ left: branchPopoverPos.left, top: branchPopoverPos.top }}
            onPointerDown={(e) => e.stopPropagation()}>
            {DEFAULT_COLORS.map((c) => (
              <button key={c} type="button" className={'swatch small' + (activeBranchColor === c ? ' on' : '')}
                style={{ background: '#' + c }} aria-label={'#' + c} aria-pressed={activeBranchColor === c}
                onClick={() => useStore.getState().setBranchColor(c)} />
            ))}
          </div>
        )}
      </div>
      {quickDish && <QuickDish point={quickDish} />}
      {commentTip && !dragId && (
        <div className="comment-tip" role="tooltip" style={{ left: commentTip.x, top: commentTip.y }}>
          {commentTip.lines.map((l, i) => <div key={i}>{l}</div>)}
        </div>
      )}
      {ghost && dragHit && (
        <div className={'drag-ghost' + (gap ? '' : ' no-drop')} style={{ left: ghost.x, top: ghost.y }} aria-hidden="true">
          <KindIcon kind={dragHit.kind} />
          <span>{t(('kind.' + dragHit.kind) as TKey)}</span>
        </div>
      )}
    </div>
  );
}

/**
 * OwlLuna-inspired radial tool dish (Editor/InkDish.swift) at the Apple Pencil tip:
 * 11 element wells around the rim + Undo/Redo/Edit/Delete in the center 2x2 grid.
 */
function QuickDish({ point }: { point: { x: number; y: number } }) {
  const s = useStore();
  const t = useTranslator(usePrefs((p) => p.lang));
  const close = () => s.openQuickDish(null);
  const centre = DishGeometry.centre(point, { width: window.innerWidth, height: window.innerHeight });
  const spots = DishGeometry.wells(DISH_KINDS.length);
  const hasEl = s.selection?.t === 'el';

  return (
    <div className="dish-backdrop" onPointerDown={close}>
      <div
        className="ink-dish"
        role="dialog"
        aria-label={t('elements')}
        style={{
          width: DishGeometry.diameter,
          height: DishGeometry.diameter,
          left: centre.x - DishGeometry.diameter / 2,
          top: centre.y - DishGeometry.diameter / 2,
        }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="dish-ring" aria-hidden="true" />
        {DISH_KINDS.map((k, idx) => (
          <button
            key={k}
            type="button"
            className="dish-well"
            title={t(('kind.' + k) as TKey)}
            aria-label={t(('kind.' + k) as TKey)}
            style={{
              left: DishGeometry.diameter / 2 + spots[idx].x - DishGeometry.well / 2,
              top: DishGeometry.diameter / 2 + spots[idx].y - DishGeometry.well / 2,
            }}
            onClick={(e) => {
              close();
              actions.insert(k, e.shiftKey);
            }}
          >
            <KindIcon kind={k} />
          </button>
        ))}
        <div className="dish-center">
          <button type="button" className="tool" title={t('undo')} aria-label={t('undo')} disabled={s.past.length === 0}
            onClick={() => { actions.undo(); }}><Icon name="undo" /></button>
          <button type="button" className="tool" title={t('redo')} aria-label={t('redo')} disabled={s.future.length === 0}
            onClick={() => { actions.redo(); }}><Icon name="redo" /></button>
          <button type="button" className="tool" title={t('edit')} aria-label={t('edit')}
            onClick={() => { close(); actions.editSelected(); }}><Icon name="edit" /></button>
          <button type="button" className="tool" title={t('delete')} aria-label={t('delete')} disabled={!hasEl}
            onClick={() => { close(); actions.remove(); }}><Icon name="delete" /></button>
        </div>
      </div>
    </div>
  );
}

/**
 * Interactive 2D Arranger Board (Phase 3b):
 * Displays all open diagrams as movable, pinnable cards on a free-form surface with .arrz/.arr export.
 */
function ArrangerBoard({ engine, dark }: { engine: ReturnType<typeof createLayoutEngine>; dark: boolean }) {
  const s = useStore();
  const t = useTranslator(usePrefs((p) => p.lang));
  const docs = s.allDocs();
  const dragRef = useRef<{ id: string; startX: number; startY: number; origX: number; origY: number } | null>(null);

  // one frame per arrangement group around its cards (desktop Group.draw), measured after layout
  const canvasRef = useRef<HTMLDivElement>(null);
  const [frames, setFrames] = useState<{ name: string; x: number; y: number; w: number; h: number }[]>([]);
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const box = new Map<string, { x0: number; y0: number; x1: number; y1: number }>();
    canvas.querySelectorAll<HTMLElement>('.arr-card[data-group]').forEach((el) => {
      const g = el.dataset.group!;
      const b = box.get(g) ?? { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
      b.x0 = Math.min(b.x0, el.offsetLeft); b.y0 = Math.min(b.y0, el.offsetTop);
      b.x1 = Math.max(b.x1, el.offsetLeft + el.offsetWidth); b.y1 = Math.max(b.y1, el.offsetTop + el.offsetHeight);
      box.set(g, b);
    });
    const PAD = 12;
    const next = [...box].map(([name, b]) => {
      const x = Math.max(0, b.x0 - PAD), y = Math.max(0, b.y0 - PAD - 18);
      return { name, x, y, w: b.x1 + PAD - x, h: b.y1 + PAD - y };
    });
    setFrames((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
  });

  return (
    <div
      className="arranger-board-wrap"
      onPointerMove={(e) => {
        const dr = dragRef.current;
        if (!dr) return;
        s.moveDocCard(dr.id, dr.origX + (e.clientX - dr.startX), dr.origY + (e.clientY - dr.startY));
      }}
      onPointerUp={() => { dragRef.current = null; }}
      onPointerCancel={() => { dragRef.current = null; }}
    >
      <div className="arranger-board-toolbar">
        <strong>{t('arrangerBoard')} ({docs.length})</strong>
        <button type="button" className="btn small" onClick={actions.newDiagram}>+ {t('newDiagram')}</button>
        <button type="button" className="btn small" onClick={() => void actions.open()}>{t('open')}</button>
        <button type="button" className="btn small" onClick={s.autoLayoutDocs}>{t('autoLayout')}</button>
        <button type="button" className="btn small" onClick={actions.exportArrz}>.arrz</button>
        <button type="button" className="btn small" onClick={actions.exportArr}>.arr</button>
        <button type="button" className="btn small primary" onClick={() => s.setViewMode('editor')}>{t('backToEditor')}</button>
      </div>
      <div className="arranger-board-canvas" ref={canvasRef}>
        {frames.map((f) => (
          <div key={'grp-' + f.name} className="arr-group-frame" style={{ left: f.x, top: f.y, width: f.w, height: f.h }} aria-hidden="true">
            <span>{f.name}</span>
          </div>
        ))}
        {docs.map((doc) => {
          const sig = parseSignature(doc.diagram);
          const sc = engine.layout(doc.diagram);
          const scale = Math.min(0.75, Math.max(0.35, 260 / Math.max(sc.width, 1)));
          const svg = sceneToSvg(sc, { scale, theme: dark ? 'dark' : 'light' });
          const x = doc.x ?? 32;
          const y = doc.y ?? 32;
          return (
            <div
              key={doc.id}
              className={'arr-card' + (doc.active ? ' active' : '') + (doc.pinned ? ' pinned' : '')}
              data-group={s.groups[doc.id]}
              style={{ left: x, top: y }}
              onClick={() => s.switchDoc(doc.id)}
              onDoubleClick={() => { s.switchDoc(doc.id); s.setViewMode('editor'); }}
            >
              <div
                className="arr-card-head"
                onPointerDown={(e) => {
                  if (doc.pinned) return;
                  e.stopPropagation();
                  dragRef.current = { id: doc.id, startX: e.clientX, startY: e.clientY, origX: x, origY: y };
                }}
              >
                <span className={'arr-icon ' + doc.diagram.diagramType} aria-hidden="true" />
                <span className="arr-card-title">{sig.name}{doc.dirty ? ' •' : ''}</span>
                <button
                  type="button"
                  className="btn small"
                  title={doc.pinned ? t('pinned') : t('pin')}
                  onClick={(e) => { e.stopPropagation(); s.togglePinDoc(doc.id); }}
                >
                  {doc.pinned ? t('pinned') : t('pin')}
                </button>
                <button
                  type="button"
                  className="btn small"
                  title={t('edit')}
                  onClick={(e) => { e.stopPropagation(); s.switchDoc(doc.id); s.setViewMode('editor'); }}
                >
                  {t('edit').replace(/\s*\.\.\.$/, '')}
                </button>
              </div>
              <div className="arr-card-body" dangerouslySetInnerHTML={{ __html: svg }} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
