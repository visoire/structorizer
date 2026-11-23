// SPDX-License-Identifier: GPL-3.0-or-later
// Resizable & dockable Executor control panel, variable watch, call stack, console, and interactive Turtleizer studio.
import { useEffect, useRef, useState } from 'react';
import { formatValue, parseInputString, turtleBounds, turtleToSvg, typeNameOf, type RuntimeVal } from '../core/exec';
import { parseSignature } from '../core/lang/analyze';
import { useTranslator } from '../i18n';
import { useStore } from '../store/diagramStore';
import { useExecStore } from '../store/execStore';
import { usePrefs, type ExecPosition } from '../store/prefsStore';
import { downloadBlob } from './exporters';
import { DockIcon } from './SidePanel';

const POS_CYCLE: ExecPosition[] = ['bottom', 'right', 'top', 'left'];
const POS_LABEL = { bottom: 'posBottom', top: 'posTop', left: 'posLeft', right: 'posRight' } as const;

export function ExecutorPanel({ placement }: { placement?: 'vertical' | 'horizontal' }) {
  const ex = useExecStore();
  const diagram = useStore((s) => s.diagram);
  const selection = useStore((s) => s.selection);
  const p = usePrefs();
  const t = useTranslator(p.lang);

  const [inputVal, setInputVal] = useState('');
  const [editingVar, setEditingVar] = useState<string | null>(null);
  const [editVal, setEditVal] = useState('');
  const [subArgs, setSubArgs] = useState<Record<string, string>>({});
  const [posMenu, setPosMenu] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const resizeDrag = useRef<{ start: number; size: number; max: number } | null>(null);

  const sig = parseSignature(diagram);
  const isSubWithParams = diagram.diagramType === 'sub' && sig.params.length > 0;

  useEffect(() => {
    if (ex.status === 'waitingInput') {
      setInputVal('');
      setTimeout(() => inputRef.current?.focus(), 20);
    }
  }, [ex.status, ex.inputRequest]);

  const isSide = p.execPosition === 'left' || p.execPosition === 'right';
  if (placement === 'vertical' && isSide) return <>{ex.turtleOpen && !p.turtleDocked && <TurtleizerPanel />}</>;
  if (placement === 'horizontal' && !isSide) return null;
  if (!ex.open && !ex.turtleOpen) return null;

  const frames = ex.execState.frames;
  const topFrame = frames[frames.length - 1];
  const vars = topFrame ? [...topFrame.vars.entries()] : [];

  const getDefaultSubArg = (name: string, idx: number): string => {
    if (subArgs[name] !== undefined) return subArgs[name];
    if (sig.name.toLowerCase() === 'hilbert') {
      return idx === 0 ? '12' : idx === 1 ? '4' : '1';
    }
    return sig.params[idx]?.def ?? '1';
  };

  const buildArgs = (): RuntimeVal[] | undefined => {
    if (!isSubWithParams) return undefined;
    return sig.params.map((param, i) => parseInputString(getDefaultSubArg(param.name, i), param.type, diagram.id));
  };

  const handleRun = () => {
    if (ex.status === 'paused') ex.resume();
    else ex.start('run', buildArgs());
  };

  const handleStep = () => {
    if (ex.status === 'idle' || ex.status === 'done' || ex.status === 'error') {
      ex.start('step', buildArgs());
    } else {
      ex.step();
    }
  };

  const selElId = selection?.t === 'el' ? selection.id : undefined;
  const hasBp = selElId ? ex.breakpoints.has(selElId) : false;

  const styleObj = isSide
    ? { ['--exec-w' as string]: `${p.execWidth}px` }
    : { ['--exec-h' as string]: `${p.execHeight}px` };

  return (
    <>
      {ex.open && (
        <section
          className={`exec-panel pos-${p.execPosition}`}
          style={styleObj}
          aria-label={t('executor')}
        >
          <div
            className="exec-resize"
            role="separator"
            aria-orientation={isSide ? 'vertical' : 'horizontal'}
            onPointerDown={(e) => {
              e.preventDefault();
              // the diagram keeps at least 140 px (height) / 240 px (width): the panel may never
              // push the menu bar and toolbar out of view
              const own = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect();
              const ws = document.querySelector('.workspace')?.getBoundingClientRect();
              const size = isSide ? own.width : own.height;
              const free = ws ? (isSide ? ws.width : ws.height) : 0;
              resizeDrag.current = {
                start: isSide ? e.clientX : e.clientY,
                size,
                max: Math.max(isSide ? 260 : 120, (isSide ? 0 : size) + free - (isSide ? 240 : 140)),
              };
              try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* ignore */ }
            }}
            onPointerMove={(e) => {
              const d = resizeDrag.current;
              if (!d) return;
              if (isSide) {
                const delta = p.execPosition === 'left' ? (e.clientX - d.start) : (d.start - e.clientX);
                const w = Math.min(Math.max(260, d.size + delta), d.max, 900);
                p.set({ execWidth: Math.round(w) });
              } else {
                const delta = p.execPosition === 'top' ? (e.clientY - d.start) : (d.start - e.clientY);
                const h = Math.min(Math.max(120, d.size + delta), d.max);
                p.set({ execHeight: Math.round(h) });
              }
            }}
            onPointerUp={() => { resizeDrag.current = null; }}
            onPointerCancel={() => { resizeDrag.current = null; }}
          />

          <div className="exec-bar">
            <div className="exec-controls">
            <strong className="exec-title">{t('executor').replace(/\s*\.\.\.$/, '')}</strong>
            <span className={'exec-badge ' + ex.status}>{ex.status.toUpperCase()}</span>
            <button
              type="button"
              className="btn small primary"
              disabled={ex.status === 'running' || ex.status === 'waitingInput'}
              onClick={handleRun}
            >
              ▶ {ex.status === 'paused' ? t('resume') : t('run')}
            </button>
            <button
              type="button"
              className="btn small"
              disabled={ex.status === 'waitingInput'}
              onClick={handleStep}
            >
              ⏭ {t('step')}
            </button>
            <button
              type="button"
              className="btn small"
              disabled={ex.status !== 'running'}
              onClick={ex.pause}
            >
              ⏸ {t('pause')}
            </button>
            <button
              type="button"
              className="btn small"
              disabled={ex.status === 'idle'}
              onClick={ex.stop}
            >
              ⏹ {t('stop')}
            </button>
            <label className="exec-speed" title={`${t('speed')} (ms)`}>
              <span>{t('speed')}</span>
              <input
                type="range"
                min={0}
                max={800}
                step={20}
                value={800 - Math.min(800, ex.speedMs)}
                onChange={(e) => ex.setSpeed(800 - +e.target.value)}
              />
              <small>{ex.speedMs} ms</small>
            </label>
            <button
              type="button"
              className={'btn small' + (hasBp ? ' bp-on' : '')}
              disabled={!selElId}
              title={`${t('breakpoint')} (Ctrl+B)`}
              onClick={() => ex.toggleBreakpoint(selElId)}
            >
              ● {t('breakpoint')}
            </button>
            <button
              type="button"
              className={'btn small' + (ex.coverageOverlay ? ' on' : '')}
              aria-pressed={ex.coverageOverlay}
              title={t('coverageHint')}
              onClick={ex.toggleCoverage}
            >
              ✓ {t('coverage')}
            </button>
            {ex.coverageOverlay && (
              <button
                type="button"
                className="btn small"
                disabled={ex.status === 'running' || ex.execState.execCounts.size === 0}
                title={t('coverageResetHint')}
                onClick={ex.resetCoverage}
              >
                ↺ {t('coverageReset')}
              </button>
            )}
            <button
              type="button"
              className={'btn small' + (ex.turtleOpen ? ' on' : '')}
              aria-pressed={ex.turtleOpen}
              onClick={() => ex.setTurtleOpen(!ex.turtleOpen)}
            >
              🐢 {t('turtleizer').replace(/\s*\.\.\.$/, '')}
            </button>
            </div>
            <div className="head-actions">
              <div className="pos-picker">
                <button
                  type="button"
                  className="icon-btn"
                  aria-haspopup="menu"
                  aria-expanded={posMenu}
                  aria-label={`${t('execPos')}: ${t(POS_LABEL[p.execPosition])}`}
                  title={`${t('execPos')}: ${t(POS_LABEL[p.execPosition])}`}
                  onClick={() => setPosMenu(!posMenu)}
                >
                  <DockIcon side={p.execPosition} />
                </button>
                {posMenu && (
                  <>
                    <div className="pos-backdrop" onPointerDown={() => setPosMenu(false)} />
                    <div className={'pos-menu menu-list at-' + p.execPosition} role="menu">
                      {POS_CYCLE.map((pos) => (
                        <button key={pos} type="button" role="menuitemradio" aria-checked={p.execPosition === pos}
                          className="menu-item" onClick={() => { p.set({ execPosition: pos }); setPosMenu(false); }}>
                          <span className="mi-check"><DockIcon side={pos} /></span>
                          <span className="mi-label">{t(POS_LABEL[pos])}</span>
                          {p.execPosition === pos && <span aria-hidden="true">✓</span>}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
              <button
                type="button"
                className="icon-btn close"
                aria-label={t('close')}
                title={t('close')}
                onClick={() => { ex.stop(); ex.setOpen(false); }}
              >
                <svg width="12" height="12" viewBox="0 0 14 14" aria-hidden="true">
                  <path d="M2 2l10 10M12 2L2 12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
              </button>
            </div>
          </div>

          {isSubWithParams && (ex.status === 'idle' || ex.status === 'done' || ex.status === 'error') && (
            <div className="exec-params">
              <span className="hint"><code>{sig.name}</code>:</span>
              {sig.params.map((param, i) => (
                <label key={param.name} className="exec-param">
                  <span>{param.name}:</span>
                  <input
                    type="text"
                    value={getDefaultSubArg(param.name, i)}
                    onChange={(e) => setSubArgs({ ...subArgs, [param.name]: e.target.value })}
                  />
                </label>
              ))}
            </div>
          )}

          {ex.status === 'waitingInput' && ex.inputRequest && (
            <form
              className="exec-input-bar"
              onSubmit={(e) => {
                e.preventDefault();
                ex.submitInput(inputVal);
              }}
            >
              <label>
                <strong>INPUT</strong> <span>{ex.inputRequest.prompt}</span>
              </label>
              <input
                ref={inputRef}
                type="text"
                value={inputVal}
                placeholder={ex.inputRequest.target}
                onChange={(e) => setInputVal(e.target.value)}
              />
              <button type="submit" className="btn small primary">{t('ok')}</button>
            </form>
          )}

          <div className={'exec-grid' + (ex.turtleOpen && p.turtleDocked ? ' with-turtle' : '')}>
            <div className="exec-vars">
              <div className="exec-sec-head">
                <span>{t('variables')} {topFrame ? `(${topFrame.name})` : ''}</span>
                {frames.length > 1 && (
                  <span className="exec-stack" title="Call stack">
                    {frames.map((f) => f.name).join(' → ')}
                  </span>
                )}
              </div>
              {vars.length === 0 ? (
                <p className="hint small exec-empty">{t('noVariables')}</p>
              ) : (
                <table className="keys exec-table">
                  <thead>
                    <tr><th>{t('varName')}</th><th>{t('varType')}</th><th>{t('varValue')}</th></tr>
                  </thead>
                  <tbody>
                    {vars.map(([name, val]) => {
                      const ty = typeNameOf(val, topFrame?.types.get(name));
                      const isEditing = editingVar === name;
                      return (
                        <tr key={name}>
                          <td><code>{name}</code></td>
                          <td className="hint">{ty}</td>
                          <td
                            onClick={() => {
                              if (ex.status === 'paused' || ex.status === 'done') {
                                setEditingVar(name);
                                setEditVal(formatValue(val));
                              }
                            }}
                          >
                            {isEditing ? (
                              <input
                                type="text"
                                className="watch-edit"
                                value={editVal}
                                autoFocus
                                onChange={(e) => setEditVal(e.target.value)}
                                onBlur={() => { ex.setWatchVar(name, editVal); setEditingVar(null); }}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') { ex.setWatchVar(name, editVal); setEditingVar(null); }
                                  else if (e.key === 'Escape') setEditingVar(null);
                                }}
                              />
                            ) : (
                              <code>{formatValue(val)}</code>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>

            <div className="exec-console">
              <div className="exec-sec-head">
                <span>{t('outputConsole')} ({ex.execState.outputs.length})</span>
                {ex.returnValue !== undefined && ex.returnValue !== null && (
                  <span className="exec-ret">{t('returnVal')}: <code>{formatValue(ex.returnValue)}</code></span>
                )}
              </div>
              <div className="exec-out-list">
                {ex.execState.outputs.map((line, i) => (
                  <div key={i} className="exec-out-line"><code>{line}</code></div>
                ))}
                {ex.error && (
                  <div
                    className="exec-error"
                    onClick={() => {
                      if (ex.error?.elementId) useStore.getState().select({ t: 'el', id: ex.error.elementId });
                    }}
                  >
                    ⚠ {ex.error.message}
                  </div>
                )}
                {ex.execState.outputs.length === 0 && !ex.error && (
                  <p className="hint small exec-empty">{t('noOutput')}</p>
                )}
              </div>
            </div>

            {ex.turtleOpen && p.turtleDocked && <TurtleizerPanel docked />}
          </div>
        </section>
      )}
      {ex.turtleOpen && (!p.turtleDocked || !ex.open) && <TurtleizerPanel />}
    </>
  );
}

function TurtleizerPanel({ docked = false }: { docked?: boolean }) {
  const ex = useExecStore();
  const p = usePrefs();
  const t = useTranslator(p.lang);
  const turtle = ex.execState.turtle;

  const [pos, setPos] = useState<{ x: number; y: number }>(() => ({
    x: Math.max(16, window.innerWidth - p.turtleWidth - 36),
    y: Math.max(64, window.innerHeight - p.turtleHeight - 96),
  }));
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [showCursor, setShowCursor] = useState(true);
  const [hoverPt, setHoverPt] = useState<{ x: number; y: number } | null>(null);

  const moveDrag = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);
  const sizeDrag = useRef<{ sx: number; sy: number; ow: number; oh: number } | null>(null);
  const panDrag = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const bounds = turtleBounds(turtle);
  const viewW = bounds.vw / zoom;
  const viewH = bounds.vh / zoom;
  const vx = bounds.minX + (bounds.vw - viewW) / 2 - pan.x;
  const vy = bounds.minY + (bounds.vh - viewH) / 2 - pan.y;

  const downloadSvg = () => {
    const svg = turtleToSvg(turtle);
    downloadBlob(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }), 'turtleizer.svg');
  };

  const downloadPng = async () => {
    const svg = turtleToSvg(turtle);
    const img = new Image();
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
    try {
      await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(); img.src = url; });
      const scale = 2;
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(bounds.vw * scale);
      canvas.height = Math.ceil(bounds.vh * scale);
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((b) => { if (b) downloadBlob(b, 'turtleizer.png'); }, 'image/png');
    } finally {
      URL.revokeObjectURL(url);
    }
  };

  const gridLines: React.ReactNode[] = [];
  if (p.turtleGrid) {
    const step = 50;
    const gx0 = Math.floor(bounds.minX / step) * step;
    const gx1 = bounds.minX + bounds.vw;
    const gy0 = Math.floor(bounds.minY / step) * step;
    const gy1 = bounds.minY + bounds.vh;
    for (let x = gx0; x <= gx1; x += step) {
      const isHome = x === turtle.homeX;
      gridLines.push(
        <line key={'gx-' + x} x1={x} y1={gy0} x2={x} y2={gy1}
          stroke={isHome ? 'rgba(37,99,235,0.28)' : 'rgba(128,128,128,0.16)'}
          strokeWidth={isHome ? 1.2 : 0.7} />,
      );
    }
    for (let y = gy0; y <= gy1; y += step) {
      const isHome = y === turtle.homeY;
      gridLines.push(
        <line key={'gy-' + y} x1={gx0} y1={y} x2={gx1} y2={y}
          stroke={isHome ? 'rgba(37,99,235,0.28)' : 'rgba(128,128,128,0.16)'}
          strokeWidth={isHome ? 1.2 : 0.7} />,
      );
    }
  }

  return (
    <div
      className={docked ? 'turtle-docked' : 'turtle-float'}
      role="dialog"
      aria-label={t('turtleizer')}
      style={
        docked
          ? undefined
          : { left: pos.x, top: pos.y, width: p.turtleWidth, height: p.turtleHeight }
      }
    >
      <div
        className="turtle-head"
        onPointerDown={(e) => {
          if (docked || (e.target as HTMLElement).closest('button')) return;
          e.preventDefault();
          moveDrag.current = { sx: e.clientX, sy: e.clientY, ox: pos.x, oy: pos.y };
          try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* ignore */ }
        }}
        onPointerMove={(e) => {
          const m = moveDrag.current;
          if (!m) return;
          setPos({
            x: Math.max(8, Math.min(window.innerWidth - 160, m.ox + (e.clientX - m.sx))),
            y: Math.max(8, Math.min(window.innerHeight - 100, m.oy + (e.clientY - m.sy))),
          });
        }}
        onPointerUp={() => { moveDrag.current = null; }}
        onPointerCancel={() => { moveDrag.current = null; }}
      >
        <strong>🐢 {t('turtleizer').replace(/\s*\.\.\.$/, '')}</strong>
        <span className="turtle-telemetry">
          <span className="turtle-swatch" style={{ background: turtle.penColor }} title={turtle.penColor} />
          {turtle.penDown ? '●' : '○'} ({Math.round(turtle.x)}, {Math.round(turtle.y)}) · {Math.round(turtle.orientation)}° · {turtle.segments.length} seg
          {hoverPt ? ` · [${hoverPt.x}, ${hoverPt.y}]` : ''}
        </span>
        <div className="turtle-tools">
          <button type="button" className={'btn small' + (p.turtleGrid ? ' on' : '')} onClick={() => p.toggle('turtleGrid')}>{t('turtleGrid')}</button>
          <button type="button" className={'btn small' + (showCursor ? ' on' : '')} onClick={() => setShowCursor(!showCursor)} title="Toggle turtle cursor">🐢</button>
          <button type="button" className="btn small" onClick={() => setZoom((z) => Math.min(8, +(z * 1.25).toFixed(2)))} title={t('zoomIn')}>+</button>
          <button type="button" className="btn small" onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }} title={t('zoomFit')}>{Math.round(zoom * 100)}%</button>
          <button type="button" className="btn small" onClick={() => setZoom((z) => Math.max(0.25, +(z / 1.25).toFixed(2)))} title={t('zoomOut')}>−</button>
          <button type="button" className="btn small" onClick={ex.clearTurtle}>{t('turtleClear')}</button>
          <button type="button" className="btn small" onClick={downloadSvg}>SVG</button>
          <button type="button" className="btn small" onClick={() => void downloadPng()}>PNG</button>
          {ex.open && (
            <button type="button" className="btn small" onClick={() => p.toggle('turtleDocked')}>
              {p.turtleDocked ? t('turtleFloat') : t('turtleDock')}
            </button>
          )}
          <button type="button" className="icon-btn close" aria-label={t('close')} onClick={() => ex.setTurtleOpen(false)}>
            <svg width="12" height="12" viewBox="0 0 14 14" aria-hidden="true">
              <path d="M2 2l10 10M12 2L2 12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </div>

      <div
        className="turtle-canvas-wrap"
        style={{ background: turtle.bgColor }}
        onWheel={(e) => {
          e.preventDefault();
          setZoom((z) => Math.min(8, Math.max(0.25, +(z * (e.deltaY < 0 ? 1.15 : 0.87)).toFixed(2))));
        }}
        onPointerDown={(e) => {
          e.preventDefault();
          panDrag.current = { sx: e.clientX, sy: e.clientY, ox: pan.x, oy: pan.y };
          try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* ignore */ }
        }}
        onPointerMove={(e) => {
          if (svgRef.current) {
            const r = svgRef.current.getBoundingClientRect();
            const gx = Math.round(vx + ((e.clientX - r.left) / Math.max(1, r.width)) * viewW);
            const gy = Math.round(vy + ((e.clientY - r.top) / Math.max(1, r.height)) * viewH);
            setHoverPt({ x: gx, y: gy });
          }
          const pd = panDrag.current;
          if (!pd || !svgRef.current) return;
          const r = svgRef.current.getBoundingClientRect();
          const scaleX = viewW / Math.max(1, r.width);
          const scaleY = viewH / Math.max(1, r.height);
          setPan({
            x: pd.ox + (e.clientX - pd.sx) * scaleX,
            y: pd.oy + (e.clientY - pd.sy) * scaleY,
          });
        }}
        onPointerUp={() => { panDrag.current = null; }}
        onPointerCancel={() => { panDrag.current = null; }}
        onPointerLeave={() => setHoverPt(null)}
      >
        <svg ref={svgRef} viewBox={`${vx} ${vy} ${viewW} ${viewH}`} className="turtle-svg">
          {gridLines}
          {turtle.segments.map((s, i) => (
            <line
              key={i}
              x1={s.x1}
              y1={s.y1}
              x2={s.x2}
              y2={s.y2}
              stroke={s.color}
              strokeWidth={s.width ?? 1.8}
              strokeLinecap="round"
            />
          ))}
          {turtle.labels.map((l, i) => (
            <text key={'lbl-' + i} x={l.x} y={l.y} fill={l.color} fontSize="12" fontFamily="sans-serif">
              {l.text}
            </text>
          ))}
          {turtle.visible && showCursor && (
            <g transform={`translate(${turtle.x}, ${turtle.y}) rotate(${turtle.orientation})`}>
              <polygon points="0,-10 7,8 0,4 -7,8" fill="#16a34a" stroke="#052e16" strokeWidth="1.2" />
              <circle cx="0" cy="0" r="2" fill={turtle.penColor} />
            </g>
          )}
        </svg>
      </div>

      {!docked && (
        <div
          className="turtle-resize-grip"
          title="Resize Turtleizer window"
          onPointerDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            sizeDrag.current = { sx: e.clientX, sy: e.clientY, ow: p.turtleWidth, oh: p.turtleHeight };
            try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* ignore */ }
          }}
          onPointerMove={(e) => {
            const sd = sizeDrag.current;
            if (!sd) return;
            const w = Math.min(Math.max(280, sd.ow + (e.clientX - sd.sx)), window.innerWidth - 24);
            const h = Math.min(Math.max(220, sd.oh + (e.clientY - sd.sy)), window.innerHeight - 48);
            p.set({ turtleWidth: Math.round(w), turtleHeight: Math.round(h) });
          }}
          onPointerUp={() => { sizeDrag.current = null; }}
          onPointerCancel={() => { sizeDrag.current = null; }}
        />
      )}
    </div>
  );
}
