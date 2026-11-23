// SPDX-License-Identifier: GPL-3.0-or-later
// Browser-only file helpers: open/save, picture and code export, clipboard, print,
// recent files and session autosave. Nothing here talks to a server.
import { formatArr, parseArr, readArrz, readNsd, writeArrz, writeNsd, suggestFileName, type ArrEntry, type ArrzBundle, type ReadResult } from '../core/io';
import { parseSignature } from '../core/lang/analyze';
import { createLayoutEngine, createCanvasMeasure, type LayoutOptions, type MeasureFn, type Scene } from '../core/layout';
import { generateCode, type LangId } from '../core/gen/generators';
import { sceneToSvg } from '../core/render/svg';
import { sceneToEmf } from '../core/render/emf';
import { buildPdf } from '../core/render/pdf';
import type { Diagram } from '../core/model';
import { usePrefs } from '../store/prefsStore';
import { applyDiagramFont } from './fonts';

declare const __APP_VERSION__: string;
export const APP_VERSION: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0';
/** Desktop version this web version corresponds to. */
export const STRUCTORIZER_VERSION = '3.32-35';

let measureFn: MeasureFn | null = null;
export const measure = (): MeasureFn => (measureFn ??= createCanvasMeasure());

export function viewLayoutOptions(): LayoutOptions {
  applyDiagramFont();
  const p = usePrefs.getState();
  return {
    cOperators: p.cOperators,
    highlight: p.highlightVars,
    showComments: p.showComments,
    textMode: p.switchTextComments ? 'comments' : p.commentsPlusText ? 'both' : 'text',
  };
}

/** Scene for exports: same view options as the screen, always the light theme. */
export function exportScene(d: Diagram): Scene {
  const scene = createLayoutEngine(measure(), viewLayoutOptions()).layout(d);
  return usePrefs.getState().exportColors ? scene : monochrome(scene);
}

/** Pictures without element colours (white boxes, black lines and text). */
function monochrome(scene: Scene): Scene {
  const keep = new Set(['#c0c0c0', '#d3d3d3', 'none']);
  return {
    ...scene,
    items: scene.items.map((it) => ((it.t === 'rect' || it.t === 'poly') && it.fill && !keep.has(it.fill.toLowerCase()) && !it.fill.startsWith('url(') ? { ...it, fill: '#ffffff' } : it)),
  };
}

const base = (d: Diagram) => suggestFileName(d).replace(/\.nsd$/, '');

export function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

// ------------------------------------------------------------------ .nsd files

type SaveHandle = { createWritable(): Promise<{ write(d: Blob | string): Promise<void>; close(): Promise<void> }>; name: string };
type PickerWindow = Window & { showSaveFilePicker?: (o: unknown) => Promise<SaveHandle> };

const handles = new WeakMap<object, SaveHandle>();
const nsdTypes = [{ description: 'Structorizer diagram', accept: { 'application/xml': ['.nsd'] } }];

/**
 * Save as .nsd. Uses the File System Access API when available (Chromium), else a download.
 * `key` identifies the document so "Save" reuses its file handle.
 */
export async function saveDiagram(d: Diagram, key: object, saveAs: boolean): Promise<string | null> {
  const stamped = { ...d, meta: { ...d.meta, changed: new Date().toISOString().slice(0, 10) } };
  const xml = writeNsd(stamped, APP_VERSION);
  const w = window as PickerWindow;
  if (w.showSaveFilePicker) {
    try {
      let h = handles.get(key);
      if (!h || saveAs) { h = await w.showSaveFilePicker({ suggestedName: suggestFileName(d), types: nsdTypes }); handles.set(key, h); }
      const writable = await h.createWritable();
      await writable.write(new Blob([xml], { type: 'application/xml' }));
      await writable.close();
      addRecent(h.name, xml);
      return h.name;
    } catch (e) {
      if ((e as DOMException)?.name === 'AbortError') return null;
    }
  }
  const name = suggestFileName(d);
  downloadBlob(new Blob([xml], { type: 'application/xml' }), name);
  addRecent(name, xml);
  return name;
}

export function moveSaveHandle(from: object, to: object): void {
  const h = handles.get(from);
  if (h) handles.set(to, h);
}

export async function readFile(file: File): Promise<ReadResult> {
  const text = await file.text();
  const res = readNsd(text);
  addRecent(file.name, text);
  return res;
}

export async function readArrzFile(file: File): Promise<ArrzBundle> {
  const buf = new Uint8Array(await file.arrayBuffer());
  return readArrz(buf);
}

export async function readArrFile(file: File): Promise<ArrEntry[]> {
  return parseArr(await file.text());
}

export function exportArrzFile(docs: { diagram: Diagram; fileName: string | null; x?: number; y?: number }[], name = 'arrangement'): void {
  const bytes = writeArrz(
    docs.map((d) => ({ diagram: d.diagram, fileName: d.fileName ?? suggestFileName(d.diagram), x: d.x, y: d.y })),
    name,
  );
  downloadBlob(new Blob([bytes.slice().buffer], { type: 'application/zip' }), `${name.replace(/\.arrz$/i, '')}.arrz`);
}

export function exportArrFile(docs: { diagram: Diagram; fileName: string | null; x?: number; y?: number }[], name = 'arrangement'): void {
  const entries: ArrEntry[] = docs.map((d, idx) => {
    const sig = parseSignature(d.diagram);
    return {
      x: d.x ?? (32 + (idx % 3) * 320),
      y: d.y ?? (32 + Math.floor(idx / 3) * 260),
      fileName: d.fileName ?? suggestFileName(d.diagram),
      name: sig.name,
      minArgs: d.diagram.diagramType === 'sub' ? sig.params.filter((p) => p.def === undefined).length : -1,
      maxArgs: d.diagram.diagramType === 'sub' ? sig.params.length : -1,
    };
  });
  downloadBlob(new Blob([formatArr(entries)], { type: 'text/plain;charset=utf-8' }), `${name.replace(/\.arr$/i, '')}.arr`);
}

export function pickFile(accept = '.nsd,.arrz,.arr,application/xml,text/xml,application/zip', multiple = false): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = multiple;
    input.onchange = () => resolve(input.files ? [...input.files] : []);
    input.oncancel = () => resolve([]);
    input.click();
  });
}

// ------------------------------------------------------------------ recent files (copies kept in this browser)

const RECENT_KEY = 'structorizer-web:recent';
export interface RecentFile { name: string; xml: string; ts: number }

export function getRecent(): RecentFile[] {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as RecentFile[]; } catch { return []; }
}

export function addRecent(name: string, xml: string): void {
  try {
    const list = getRecent().filter((r) => r.name !== name);
    list.unshift({ name, xml, ts: Date.now() });
    localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 10)));
  } catch { /* storage full or blocked */ }
}

// ------------------------------------------------------------------ session autosave

const SESSION_KEY = 'structorizer-web:session';
const OLD_KEY = 'structorizer-web:current';

export function saveSession(docs: { diagram: Diagram; fileName: string | null; group?: string; x?: number; y?: number; pinned?: boolean }[], active: number): boolean {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify({ active, docs: docs.map((d) => ({ xml: writeNsd(d.diagram, APP_VERSION), fileName: d.fileName, group: d.group, x: d.x, y: d.y, pinned: d.pinned || undefined })) }));
    return true;
  } catch {
    return false;
  }
}

export function loadSession(): { docs: { diagram: Diagram; fileName: string | null; group?: string; x?: number; y?: number; pinned?: boolean }[]; active: number } | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (raw) {
      const s = JSON.parse(raw) as { active: number; docs: { xml: string; fileName: string | null; group?: string; x?: number; y?: number; pinned?: boolean }[] };
      return { active: s.active, docs: s.docs.map((x) => ({ diagram: readNsd(x.xml).diagram, fileName: x.fileName, group: x.group, x: x.x, y: x.y, pinned: x.pinned })) };
    }
    const old = localStorage.getItem(OLD_KEY); // version 0.1.0
    if (old) {
      const s = JSON.parse(old) as { xml: string; fileName: string | null };
      return { active: 0, docs: [{ diagram: readNsd(s.xml).diagram, fileName: s.fileName }] };
    }
  } catch { /* ignore corrupt storage */ }
  return null;
}

export function clearLocalData(): void {
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith('structorizer-web:')) localStorage.removeItem(k);
  } catch { /* ignore */ }
}

// ------------------------------------------------------------------ pictures

async function svgToCanvas(svg: string, w: number, h: number, transparent = false): Promise<HTMLCanvasElement> {
  const img = new Image();
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error('SVG render failed')); img.src = url; });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(w);
    canvas.height = Math.ceil(h);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas not available');
    if (!transparent) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

const toBlob = (c: HTMLCanvasElement, type = 'image/png', q?: number) =>
  new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Encoding failed'))), type, q));

export async function diagramPng(d: Diagram, scale = 2): Promise<Blob> {
  const scene = exportScene(d);
  const canvas = await svgToCanvas(sceneToSvg(scene, { scale }), scene.width * scale, scene.height * scale, usePrefs.getState().exportTransparent);
  return toBlob(canvas);
}

export async function exportPng(d: Diagram): Promise<void> {
  downloadBlob(await diagramPng(d, 2), `${base(d)}.png`);
}

/** Desktop "PNG (multiple)": cut the picture into columns x rows tiles. */
export async function exportPngMulti(d: Diagram, cols: number, rows: number): Promise<number> {
  const scale = 2;
  const scene = exportScene(d);
  const full = await svgToCanvas(sceneToSvg(scene, { scale }), scene.width * scale, scene.height * scale);
  const tw = Math.ceil(full.width / cols);
  const th = Math.ceil(full.height / rows);
  let n = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const tile = document.createElement('canvas');
      tile.width = Math.min(tw, full.width - c * tw);
      tile.height = Math.min(th, full.height - r * th);
      if (tile.width <= 0 || tile.height <= 0) continue;
      tile.getContext('2d')!.drawImage(full, c * tw, r * th, tile.width, tile.height, 0, 0, tile.width, tile.height);
      downloadBlob(await toBlob(tile), `${base(d)}-${r + 1}-${c + 1}.png`);
      n++;
      await new Promise((res) => setTimeout(res, 250)); // browsers throttle many downloads at once
    }
  }
  return n;
}

export function exportSvg(d: Diagram): void {
  const svg = sceneToSvg(exportScene(d), { standalone: true, title: d.text[0] });
  downloadBlob(new Blob([svg], { type: 'image/svg+xml' }), `${base(d)}.svg`);
}

export function exportEmf(d: Diagram): void {
  const emf = sceneToEmf(exportScene(d), measure());
  downloadBlob(new Blob([emf.slice().buffer], { type: 'image/emf' }), `${base(d)}.emf`);
}

async function deflate(data: Uint8Array): Promise<Uint8Array | null> {
  const CS = (globalThis as { CompressionStream?: new (f: string) => GenericTransformStream }).CompressionStream;
  if (!CS) return null;
  const stream = new Blob([data.slice().buffer]).stream().pipeThrough(new CS('deflate') as unknown as ReadableWritablePair<Uint8Array, Uint8Array>);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function exportPdf(d: Diagram): Promise<void> {
  const scene = exportScene(d);
  const scale = 3;
  const canvas = await svgToCanvas(sceneToSvg(scene, { scale }), scene.width * scale, scene.height * scale);
  const ctx = canvas.getContext('2d')!;
  const rgba = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const rgb = new Uint8Array(canvas.width * canvas.height * 3);
  for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) { rgb[j] = rgba[i]; rgb[j + 1] = rgba[i + 1]; rgb[j + 2] = rgba[i + 2]; }
  const packed = await deflate(rgb);
  const pageWidth = scene.width * 0.75; // px -> pt at 96 dpi
  const pageHeight = scene.height * 0.75;
  const data = packed ?? new Uint8Array(await (await toBlob(canvas, 'image/jpeg', 0.95)).arrayBuffer());
  const pdf = buildPdf({ width: canvas.width, height: canvas.height, pageWidth, pageHeight, data, filter: packed ? 'FlateDecode' : 'DCTDecode' }, d.text[0] ?? 'diagram');
  downloadBlob(new Blob([pdf.slice().buffer], { type: 'application/pdf' }), `${base(d)}.pdf`);
}

/** Desktop "Copy bitmap diagram to clipboard". */
export async function copyPngToClipboard(d: Diagram): Promise<boolean> {
  try {
    const CI = (window as unknown as { ClipboardItem?: new (i: Record<string, Promise<Blob> | Blob>) => ClipboardItem }).ClipboardItem;
    if (!CI || !navigator.clipboard?.write) return false;
    await navigator.clipboard.write([new CI({ 'image/png': diagramPng(d, 2) })]);
    return true;
  } catch {
    return false;
  }
}

/** Populate the hidden print container with a clean light-mode SVG of the diagram. */
export function preparePrintArea(d: Diagram): HTMLElement | null {
  const host = document.getElementById('print-area');
  if (!host) return null;
  host.innerHTML = sceneToSvg(exportScene(d), { title: d.text[0] });
  return host;
}

export function clearPrintArea(): void {
  const host = document.getElementById('print-area');
  if (host) host.innerHTML = '';
}

/** Print only the diagram (print stylesheet hides the app). */
export function printDiagram(d: Diagram): void {
  const host = preparePrintArea(d);
  if (!host) return;
  host.getBoundingClientRect();
  window.print();
}

// ------------------------------------------------------------------ code

export function exportCode(d: Diagram, lang: LangId, pool: Diagram[]): void {
  const r = generateCode(d, lang, { pool, involveSubroutines: usePrefs.getState().involveSubroutines, version: STRUCTORIZER_VERSION });
  downloadBlob(new Blob([r.code], { type: 'text/plain;charset=utf-8' }), r.fileName);
}

// ------------------------------------------------------------------ preferences file

export function savePrefsFile(json: string): void {
  downloadBlob(new Blob([json], { type: 'application/json' }), 'structorizer-web-preferences.json');
}
