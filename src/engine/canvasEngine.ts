import type { Anchor, Dimension, Material, Note, Part, PartShape, Vec2 } from '../domain/types';
import { formatLength, mmToDisplay } from '../domain/format';
import type { Scene } from './scene';
import { dist, partContains, pointSegmentDistance, snap } from './geometry';
import { bytesToBase64, buildPdf } from './pdf';

export type Tool = 'select' | 'part' | 'dimension' | 'pan' | 'custom' | 'note';

export interface CustomPartSpec {
  label: string;
  materialId: string;
  length: number;
  width: number;
  thickness: number;
  quantity: number;
  shape?: PartShape;
  color?: string;
  customMaterial?: Material;
}

interface EngineOptions {
  onStatus?: (status: string) => void;
}

type Mode =
  | { kind: 'idle' }
  | { kind: 'pan'; startScreen: Vec2; startCam: Vec2 }
  | { kind: 'move'; partId: string; grab: Vec2 }
  | { kind: 'move-note'; noteId: string; grab: Vec2 }
  | { kind: 'resize'; partId: string }
  | { kind: 'draw'; start: Vec2; current: Vec2; shape: PartShape }
  | { kind: 'dim'; first: Anchor; hover: Vec2 };

const HANDLE = 10;
const MAX_SCALE = 4;
const MIN_SCALE = 0.02;

const NOTE_FONT = '12px system-ui, sans-serif';
const NOTE_MAX_W = 200;
const NOTE_LINE_H = 17;
const NOTE_TITLE_H = 20;
const NOTE_PAD_X = 10;
const NOTE_PAD_Y = 8;
const NOTE_BOX = 13;
const NOTE_GAP = 6;

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return { r: 247, g: 244, b: 236 };
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function svgNum(v: number): string {
  return String(Math.round(v * 100) / 100);
}

export class CanvasEngine {
  private ctx: CanvasRenderingContext2D;
  private cam = { x: -120, y: -80, scale: 0.32 };
  private mode: Mode = { kind: 'idle' };
  private tool: Tool = 'select';
  private partKindId: string;
  private partShape: PartShape | null = null;
  private customSpec: CustomPartSpec | null = null;
  private canvasColor = '#f7f4ec';
  private dirty = true;
  private raf = 0;
  private ro: ResizeObserver;
  private dpr = 1;
  private width = 0;
  private height = 0;
  private space = false;
  private unsubscribe: () => void;
  private gridVisible = true;
  private snapEnabled = true;
  private rulersVisible = false;
  private verticalLinesVisible = true;
  private horizontalLinesVisible = true;
  private gridOpacity = 100;

  constructor(
    private canvas: HTMLCanvasElement,
    private scene: Scene,
    private opts: EngineOptions = {},
  ) {
    this.ctx = canvas.getContext('2d')!;
    this.partKindId = scene.profile.partKinds[0]?.id ?? '';
    this.unsubscribe = scene.subscribe(() => {
      this.dirty = true;
    });
    canvas.addEventListener('pointerdown', this.onDown);
    canvas.addEventListener('pointermove', this.onMove);
    canvas.addEventListener('pointerup', this.onUp);
    canvas.addEventListener('pointercancel', this.onUp);
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
    canvas.addEventListener('contextmenu', this.onContext);
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('keyup', this.onKeyUp);
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas);
    this.resize();
    this.raf = requestAnimationFrame(this.loop);
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.unsubscribe();
    this.canvas.removeEventListener('pointerdown', this.onDown);
    this.canvas.removeEventListener('pointermove', this.onMove);
    this.canvas.removeEventListener('pointerup', this.onUp);
    this.canvas.removeEventListener('pointercancel', this.onUp);
    this.canvas.removeEventListener('wheel', this.onWheel);
    this.canvas.removeEventListener('contextmenu', this.onContext);
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('keyup', this.onKeyUp);
  }

  setTool(tool: Tool): void {
    this.tool = tool;
    this.scene.end();
    this.mode = { kind: 'idle' };
    this.canvas.style.cursor =
      tool === 'pan' ? 'grab' : tool === 'select' || tool === 'custom' ? 'default' : 'crosshair';
    this.dirty = true;
  }

  setPartKind(id: string): void {
    this.partKindId = id;
  }

  setPartShape(shape: PartShape | null): void {
    this.partShape = shape;
    this.dirty = true;
  }

  setCustomSpec(spec: CustomPartSpec | null): void {
    this.customSpec = spec;
    this.dirty = true;
  }

  setCanvasColor(color: string): void {
    this.canvasColor = color;
    this.dirty = true;
  }

  setGridVisible(v: boolean): void {
    this.gridVisible = v;
    this.dirty = true;
  }

  setSnapEnabled(v: boolean): void {
    this.snapEnabled = v;
    this.dirty = true;
  }

  setRulersVisible(v: boolean): void {
    this.rulersVisible = v;
    this.dirty = true;
  }

  setVerticalLinesVisible(v: boolean): void {
    this.verticalLinesVisible = v;
    this.dirty = true;
  }

  setHorizontalLinesVisible(v: boolean): void {
    this.horizontalLinesVisible = v;
    this.dirty = true;
  }

  setGridOpacity(v: number): void {
    this.gridOpacity = Math.max(0, Math.min(100, v));
    this.dirty = true;
  }

  fit(): void {
    if (this.scene.parts.length === 0 && this.scene.notes.length === 0) return;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of this.scene.parts) {
      minX = Math.min(minX, p.position.x);
      minY = Math.min(minY, p.position.y);
      maxX = Math.max(maxX, p.position.x + p.size.x);
      maxY = Math.max(maxY, p.position.y + p.size.y);
    }
    for (const n of this.scene.notes) {
      const a = this.scene.noteAnchorWorld(n);
      if (!a) continue;
      minX = Math.min(minX, a.x);
      minY = Math.min(minY, a.y);
      maxX = Math.max(maxX, a.x + NOTE_MAX_W / this.cam.scale + NOTE_PAD_X);
      maxY = Math.max(maxY, a.y + 70 / this.cam.scale);
    }
    const pad = 90;
    const bw = Math.max(1, maxX - minX);
    const bh = Math.max(1, maxY - minY);
    const sx = (this.width - pad * 2) / bw;
    const sy = (this.height - pad * 2) / bh;
    this.cam.scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.min(sx, sy)));
    this.cam.x = minX - (this.width / this.cam.scale - bw) / 2;
    this.cam.y = minY - (this.height / this.cam.scale - bh) / 2;
    this.dirty = true;
  }

  home(): void {
    this.cam = { x: -120, y: -80, scale: 0.32 };
    this.dirty = true;
  }

  exportPng(): string {
    return this.canvas.toDataURL('image/png');
  }

  async exportPdf(): Promise<string | null> {
    const blob = await new Promise<Blob | null>((res) => this.canvas.toBlob(res, 'image/jpeg', 0.92));
    if (!blob) return null;
    const pdf = buildPdf({
      jpeg: new Uint8Array(await blob.arrayBuffer()),
      imageWidth: this.canvas.width,
      imageHeight: this.canvas.height,
      pageWidth: (this.width * 72) / 96,
      pageHeight: (this.height * 72) / 96,
    });
    return `data:application/pdf;base64,${bytesToBase64(pdf)}`;
  }

  exportSvg(): string {
    const W = Math.round(this.width);
    const H = Math.round(this.height);
    const s: string[] = [];
    const push = (line: string): void => void s.push(line);
    const rgb = hexToRgb(this.canvasColor);
    const dark = rgb.r * 0.299 + rgb.g * 0.587 + rgb.b * 0.114 < 128;
    const trim = (t: string, maxW: number): string => (t.length * 6 <= maxW ? t : `${t.slice(0, Math.max(1, Math.floor(maxW / 6) - 1))}…`);

    push(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="system-ui, sans-serif">`,
    );
    push(`<rect width="${W}" height="${H}" fill="${this.canvasColor}"/>`);

    if (this.gridVisible) {
      const k = this.gridOpacity / 100;
      const minor = dark ? `rgba(255,255,255,${0.14 * k})` : `rgba(0,0,0,${0.09 * k})`;
      const major = dark ? `rgba(255,255,255,${0.28 * k})` : `rgba(0,0,0,${0.22 * k})`;
      let step = this.scene.profile.gridSize;
      while (step * this.cam.scale < 7) step *= 5;
      const right = this.cam.x + W / this.cam.scale;
      const bottom = this.cam.y + H / this.cam.scale;
      const majorStep = step * 5;
      if (this.verticalLinesVisible) {
        const vert: string[] = [];
        for (let x = Math.floor(this.cam.x / step) * step; x <= right; x += step) {
          const sx = svgNum((x - this.cam.x) * this.cam.scale);
          const color = Math.abs(x % majorStep) < step / 2 ? major : minor;
          vert.push(`<line x1="${sx}" y1="0" x2="${sx}" y2="${H}" stroke="${color}" stroke-width="1"/>`);
        }
        vert.forEach((l) => push(l));
      }
      if (this.horizontalLinesVisible) {
        for (let y = Math.floor(this.cam.y / step) * step; y <= bottom; y += step) {
          const sy = svgNum((y - this.cam.y) * this.cam.scale);
          const color = Math.abs(y % majorStep) < step / 2 ? major : minor;
          push(`<line x1="0" y1="${sy}" x2="${W}" y2="${sy}" stroke="${color}" stroke-width="1"/>`);
        }
      }
    }

    for (const part of this.scene.parts) this.svgPart(push, part);
    for (const dim of this.scene.dimensions) this.svgDimension(push, dim, trim);
    for (const note of this.scene.notes) {
      if (this.scene.isBoardNote(note)) this.svgNote(push, note, trim);
    }

    push('</svg>');
    return s.join('\n');
  }

  private svgPart(push: (line: string) => void, part: Part): void {
    const s = this.toScreen(part.position);
    const w = part.size.x * this.cam.scale;
    const h = part.size.y * this.cam.scale;
    const x = svgNum(s.x);
    const y = svgNum(s.y);
    const wpx = svgNum(w);
    const hpx = svgNum(h);
    const mat = this.scene.material(part.materialId);
    const selected = part.id === this.scene.selectedPartId;
    const fill = part.color ?? mat?.color ?? '#cfcfcf';
    const stroke = selected ? '#2f6df6' : 'rgba(60,50,35,0.55)';
    const sw = selected ? 2 : 1;
    const shape = part.shape ?? 'rect';
    const label = part.quantity > 1 ? `${part.label} x${part.quantity}` : part.label;
    if (shape === 'line') {
      push(
        `<line x1="${svgNum(s.x + h / 2)}" y1="${svgNum(s.y + h / 2)}" x2="${svgNum(s.x + w - h / 2)}" y2="${svgNum(s.y + h / 2)}" stroke="${fill}" stroke-width="${Math.max(2, h)}" stroke-linecap="round" opacity="0.92"/>`,
      );
      push(
        `<line x1="${svgNum(s.x + h / 2)}" y1="${svgNum(s.y + h / 2)}" x2="${svgNum(s.x + w - h / 2)}" y2="${svgNum(s.y + h / 2)}" stroke="${stroke}" stroke-width="${sw}" stroke-linecap="round"/>`,
      );
      return;
    }
    if (shape === 'circle') {
      push(
        `<ellipse cx="${svgNum(s.x + w / 2)}" cy="${svgNum(s.y + h / 2)}" rx="${svgNum(w / 2)}" ry="${svgNum(h / 2)}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" opacity="0.92"/>`,
      );
    } else if (shape === 'triangle') {
      push(
        `<polygon points="${svgNum(s.x + w / 2)},${y} ${x},${svgNum(s.y + h)} ${svgNum(s.x + w)},${svgNum(s.y + h)}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" opacity="0.92"/>`,
      );
    } else {
      push(`<rect x="${x}" y="${y}" width="${wpx}" height="${hpx}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" opacity="0.92"/>`);
    }
    if (w > 46 && h > 15) {
      push(
        `<text x="${svgNum(s.x + w / 2)}" y="${svgNum(s.y + h / 2)}" font-size="11" fill="rgba(35,28,18,0.85)" text-anchor="middle" dominant-baseline="middle">${esc(label)}</text>`,
      );
    }
  }

  private svgDimension(push: (line: string) => void, dim: Dimension, trim: (t: string, w: number) => string): void {
    const a = this.scene.anchorPoint(dim.a);
    const b = this.scene.anchorPoint(dim.b);
    const A = this.toScreen(a);
    const B = this.toScreen(b);
    const rgb = hexToRgb(this.canvasColor);
    const dark = rgb.r * 0.299 + rgb.g * 0.587 + rgb.b * 0.114 < 128;
    const off = dim.offset * this.cam.scale;
    const color = dim.id === this.scene.selectedDimensionId ? '#2f6df6' : '#b0442f';
    const value = formatLength(dim.axis === 'x' ? Math.abs(b.x - a.x) : Math.abs(b.y - a.y), this.scene.displayUnit, this.scene.displayPrecision);
    const label = trim(value, 120);
    this.ctx.font = '11px system-ui, sans-serif';
    const lw = Math.floor(this.ctx.measureText(label).width) + 6;
    if (dim.axis === 'x') {
      const y = svgNum(Math.max(A.y, B.y) + off);
      push(`<path d="M${svgNum(A.x)},${svgNum(A.y)}V${y}M${svgNum(B.x)},${svgNum(B.y)}V${y}M${svgNum(A.x)},${y}H${svgNum(B.x)}" fill="none" stroke="${color}" stroke-width="1"/>`);
      this.svgArrow(push, A.x, A.y + off, A.x < B.x ? 1 : -1, 'x', color);
      this.svgArrow(push, B.x, B.y + off, A.x < B.x ? -1 : 1, 'x', color);
      const cx = svgNum((A.x + B.x) / 2);
      const cy = svgNum(Math.max(A.y, B.y) + off - 12);
      push(`<rect x="${svgNum((A.x + B.x) / 2 - lw / 2)}" y="${svgNum(Math.max(A.y, B.y) + off - 21)}" width="${lw}" height="16" fill="${this.canvasColor}"/>`);
      push(`<text x="${cx}" y="${cy}" font-size="11" fill="${dark ? '#e0d9c8' : '#8a5a33'}" text-anchor="middle" dominant-baseline="middle">${esc(label)}</text>`);
    } else {
      const x = svgNum(Math.max(A.x, B.x) + off);
      push(`<path d="M${svgNum(A.x)},${svgNum(A.y)}H${x}M${svgNum(B.x)},${svgNum(B.y)}H${x}M${x},${svgNum(A.y)}V${svgNum(B.y)}" fill="none" stroke="${color}" stroke-width="1"/>`);
      this.svgArrow(push, A.x + off, A.y, A.y < B.y ? 1 : -1, 'y', color);
      this.svgArrow(push, B.x + off, B.y, A.y < B.y ? -1 : 1, 'y', color);
      const lx = svgNum(Math.max(A.x, B.x) + off + 8);
      const cy = svgNum((A.y + B.y) / 2);
      push(`<text x="${lx}" y="${cy}" font-size="11" fill="${dark ? '#e0d9c8' : '#8a5a33'}" text-anchor="start" dominant-baseline="middle">${esc(label)}</text>`);
    }
  }

  private svgArrow(
    push: (line: string) => void,
    x: number,
    y: number,
    dir: number,
    axis: 'x' | 'y',
    color: string,
  ): void {
    const s = 5;
    if (axis === 'x') {
      push(`<polygon points="${svgNum(x)},${svgNum(y)} ${svgNum(x + dir * s)},${svgNum(y - s * 0.6)} ${svgNum(x + dir * s)},${svgNum(y + s * 0.6)}" fill="${color}"/>`);
    } else {
      push(`<polygon points="${svgNum(x)},${svgNum(y)} ${svgNum(x - s * 0.6)},${svgNum(y + dir * s)} ${svgNum(x + s * 0.6)},${svgNum(y + dir * s)}" fill="${color}"/>`);
    }
  }

  private svgNote(push: (line: string) => void, note: Note, trim: (t: string, w: number) => string): void {
    const anchor = this.scene.noteAnchorWorld(note) ?? { x: 0, y: 0 };
    const p = this.toScreen(anchor);
    const r = { x: p.x, y: p.y, w: NOTE_MAX_W, h: NOTE_PAD_Y * 2 + NOTE_TITLE_H + Math.max(note.items.length, 1) * NOTE_LINE_H + 2 };
    const ctxKind = note.context.kind;

    if (ctxKind === 'part' || ctxKind === 'measure') {
      const target = ctxKind === 'part'
        ? this.toScreen(this.scene.partById(note.context.partId ?? '')?.position ?? anchor)
        : (() => {
            const d = this.scene.dimensions.find((dm) => dm.id === note.context.dimensionId);
            if (!d) return anchor;
            const a = this.scene.anchorPoint(d.a);
            const b = this.scene.anchorPoint(d.b);
            return this.toScreen({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
          })();
      const start = this.nearestEdgePoint(target, r);
      push(`<line x1="${svgNum(start.x)}" y1="${svgNum(start.y)}" x2="${svgNum(target.x)}" y2="${svgNum(target.y)}" stroke="rgba(138,130,114,0.9)" stroke-width="1.5"/>`);
      const angle = Math.atan2(target.y - start.y, target.x - start.x);
      const s = 6;
      push(
        `<polygon points="${svgNum(target.x)},${svgNum(target.y)} ${svgNum(target.x - s * Math.cos(angle - 0.42))},${svgNum(target.y - s * Math.sin(angle - 0.42))} ${svgNum(target.x - s * Math.cos(angle + 0.42))},${svgNum(target.y - s * Math.sin(angle + 0.42))}" fill="rgba(138,130,114,0.9)"/>`,
      );
    }

    const selected = note.id === this.scene.selectedNoteId;
    const border = selected ? '#2f6df6' : ctxKind === 'general' ? '#d9d1c0' : '#b9a98a';
    push(
      `<rect x="${svgNum(r.x)}" y="${svgNum(r.y)}" width="${svgNum(r.w)}" height="${svgNum(r.h)}" rx="8" fill="${selected ? '#e9efff' : '#fffdf9'}" stroke="${border}" stroke-width="${selected ? 2 : 1}"/>`,
    );
    const title = trim(note.title.trim() || this.noteDefaultTitle(note), r.w - NOTE_PAD_X * 2);
    push(
      `<text x="${svgNum(r.x + NOTE_PAD_X)}" y="${svgNum(r.y + NOTE_PAD_Y + 1)}" font-size="12.5" font-weight="600" fill="#6a5d45" text-anchor="start" dominant-baseline="hanging">${esc(title)}</text>`,
    );
    const items = note.items.length ? note.items : [{ id: '', text: '', checked: false }];
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const by = r.y + NOTE_PAD_Y + NOTE_TITLE_H + i * NOTE_LINE_H + (NOTE_LINE_H - NOTE_BOX) / 2;
      const bx = r.x + NOTE_PAD_X;
      if (it.checked) {
        push(`<rect x="${svgNum(bx)}" y="${svgNum(by)}" width="${NOTE_BOX}" height="${NOTE_BOX}" rx="3" fill="#2f6df6"/>`);
        push(
          `<polyline points="${svgNum(bx + 3.4)},${svgNum(by + NOTE_BOX / 2)} ${svgNum(bx + 5.6)},${svgNum(by + NOTE_BOX - 2.8)} ${svgNum(bx + NOTE_BOX - 2)},${svgNum(by + 3.4)}" fill="none" stroke="#fff" stroke-width="1.6"/>`,
        );
      } else {
        push(`<rect x="${svgNum(bx)}" y="${svgNum(by)}" width="${NOTE_BOX}" height="${NOTE_BOX}" rx="3" fill="#fff" stroke="#bdb3a0"/>`);
      }
      const x0 = bx + NOTE_BOX + NOTE_GAP;
      const textW = r.w - x0 - NOTE_PAD_X;
      const text = it.text || (note.items.length ? '' : 'Empty note');
      push(
        `<text x="${svgNum(x0)}" y="${svgNum(r.y + NOTE_PAD_Y + NOTE_TITLE_H + i * NOTE_LINE_H + 2)}" font-size="12" fill="${it.checked ? 'rgba(120,112,96,0.6)' : '#241f17'}" text-anchor="start" dominant-baseline="hanging">${esc(trim(text, textW))}</text>`,
      );
    }
  }

  private resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    this.dpr = window.devicePixelRatio || 1;
    this.width = rect.width;
    this.height = rect.height;
    this.canvas.width = Math.max(1, Math.round(rect.width * this.dpr));
    this.canvas.height = Math.max(1, Math.round(rect.height * this.dpr));
    this.dirty = true;
  }

  private screen(e: { clientX: number; clientY: number }): Vec2 {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private toWorld(s: Vec2): Vec2 {
    return { x: s.x / this.cam.scale + this.cam.x, y: s.y / this.cam.scale + this.cam.y };
  }

  private toScreen(w: Vec2): Vec2 {
    return { x: (w.x - this.cam.x) * this.cam.scale, y: (w.y - this.cam.y) * this.cam.scale };
  }

  private snapAxis(v: number): number {
    return this.snapEnabled ? snap(v, this.scene.profile.gridSize) : v;
  }

  private gridSnap(w: Vec2): Vec2 {
    return { x: this.snapAxis(w.x), y: this.snapAxis(w.y) };
  }

  private loop = (): void => {
    if (this.dirty) {
      this.dirty = false;
      this.render();
    }
    this.raf = requestAnimationFrame(this.loop);
  };

  private onContext = (e: MouseEvent): void => {
    e.preventDefault();
  };

  private onDown = (e: PointerEvent): void => {
    this.canvas.setPointerCapture(e.pointerId);
    const s = this.screen(e);
    const w = this.toWorld(s);

    if (e.button === 1 || this.space || this.tool === 'pan') {
      this.mode = { kind: 'pan', startScreen: s, startCam: { x: this.cam.x, y: this.cam.y } };
      return;
    }
    if (e.button !== 0) return;

    if (this.tool === 'select') {
      const sel = this.scene.selectedPart();
      if (sel && this.hitHandle(s, sel)) {
        this.scene.begin();
        this.mode = { kind: 'resize', partId: sel.id };
        return;
      }
      const part = this.hitPart(w);
      if (part) {
        this.scene.selectPart(part.id);
        this.scene.begin();
        this.mode = { kind: 'move', partId: part.id, grab: { x: w.x - part.position.x, y: w.y - part.position.y } };
        return;
      }
      const dim = this.hitDimension(s);
      if (dim) {
        this.scene.selectDimension(dim.id);
        return;
      }
      const note = this.hitNote(s);
      if (note) {
        this.scene.selectNote(note.id);
        const movable = note.context.kind === 'general' && note.board;
        if (movable) {
          this.scene.begin();
          this.mode = {
            kind: 'move-note',
            noteId: note.id,
            grab: { x: w.x - (note.position?.x ?? 0), y: w.y - (note.position?.y ?? 0) },
          };
        }
        return;
      }
      this.scene.selectPart(null);
      return;
    }

    if (this.tool === 'note') {
      const hit = this.hitNote(s);
      if (hit) {
        this.scene.selectNote(hit.id);
        this.dirty = true;
        return;
      }
      const p = this.gridSnap(w);
      const dim = this.hitDimension(s);
      const part = this.hitPart(w);
      let note: Note;
      if (dim) {
        note = this.scene.addNote({ title: '', context: { kind: 'measure', dimensionId: dim.id }, items: [], board: true });
      } else if (part) {
        note = this.scene.addNote({ title: '', context: { kind: 'part', partId: part.id }, items: [], board: true });
      } else {
        note = this.scene.addNote({ title: '', context: { kind: 'general' }, items: [], board: true, position: p });
      }
      this.scene.selectNote(note.id);
      this.dirty = true;
      return;
    }

    if (this.tool === 'part') {
      const p = this.gridSnap(w);
      const shape = this.partShape ?? this.scene.kind(this.partKindId)?.defaultShape ?? 'rect';
      this.mode = { kind: 'draw', start: p, current: p, shape };
      return;
    }

    if (this.tool === 'custom') {
      if (!this.customSpec) return;
      const p = this.gridSnap(w);
      this.mode = { kind: 'draw', start: p, current: p, shape: this.customSpec.shape ?? 'rect' };
      this.dirty = true;
      return;
    }

    if (this.tool === 'dimension') {
      const tolerance = 12 / this.cam.scale;
      const anchor = this.scene.resolveAnchor(w, tolerance);
      if (this.mode.kind === 'dim') {
        const a = this.scene.anchorPoint(this.mode.first);
        const b = this.scene.anchorPoint(anchor);
        const dx = Math.abs(b.x - a.x);
        const dy = Math.abs(b.y - a.y);
        if (dx > 0.5 || dy > 0.5) {
          this.scene.addDimension({ a: this.mode.first, b: anchor, offset: 60, axis: dx >= dy ? 'x' : 'y' });
        }
        this.mode = { kind: 'idle' };
      } else {
        this.mode = { kind: 'dim', first: anchor, hover: w };
      }
      this.dirty = true;
    }
  };

  private onMove = (e: PointerEvent): void => {
    const s = this.screen(e);
    const w = this.toWorld(s);
    const unit = this.scene.displayUnit;
    this.opts.onStatus?.(
      `${Math.round(mmToDisplay(w.x, unit))} , ${Math.round(mmToDisplay(w.y, unit))} ${unit}`,
    );

    switch (this.mode.kind) {
      case 'pan': {
        this.cam.x = this.mode.startCam.x - (s.x - this.mode.startScreen.x) / this.cam.scale;
        this.cam.y = this.mode.startCam.y - (s.y - this.mode.startScreen.y) / this.cam.scale;
        this.dirty = true;
        break;
      }
      case 'move': {
        const part = this.scene.partById(this.mode.partId);
        if (part) {
          this.scene.updatePart(part.id, {
            position: { x: this.snapAxis(w.x - this.mode.grab.x), y: this.snapAxis(w.y - this.mode.grab.y) },
          });
        }
        break;
      }
      case 'move-note': {
        const note = this.scene.noteById(this.mode.noteId);
        if (note && note.context.kind === 'general' && note.board) {
          this.scene.updateNote(note.id, {
            position: { x: this.snapAxis(w.x - this.mode.grab.x), y: this.snapAxis(w.y - this.mode.grab.y) },
          });
        }
        break;
      }
      case 'resize': {
        const part = this.scene.partById(this.mode.partId);
        if (part) {
          const nw = Math.max(1, this.snapAxis(w.x - part.position.x));
          const nh = Math.max(1, this.snapAxis(w.y - part.position.y));
          this.scene.updatePart(part.id, {
            size: { x: nw, y: nh },
          });
        }
        break;
      }
      case 'draw': {
        this.mode.current = this.gridSnap(w);
        this.dirty = true;
        break;
      }
      case 'dim': {
        this.mode.hover = w;
        this.dirty = true;
        break;
      }
      default:
        break;
    }
  };

  private onUp = (e: PointerEvent): void => {
    if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);

    const wasDrag = this.mode.kind === 'move' || this.mode.kind === 'resize' || this.mode.kind === 'move-note';

    if (this.mode.kind === 'draw') {
      const start = this.mode.start;
      const current = this.mode.current;
      let w = Math.abs(current.x - start.x);
      let h = Math.abs(current.y - start.y);
      const pos = { x: Math.min(start.x, current.x), y: Math.min(start.y, current.y) };
      if (this.tool === 'custom') {
        const spec = this.customSpec;
        if (spec) {
          const materialId = spec.customMaterial ? (this.scene.setCustomMaterial(spec.customMaterial), spec.customMaterial.id) : spec.materialId;
          if (w < 15) {
            w = spec.length;
            pos.x = start.x;
          }
          if (h < 15) {
            h = spec.width;
            pos.y = start.y;
          }
          const part = this.scene.addPart({
            kindId: 'custom',
            materialId,
            label: spec.label,
            position: pos,
            size: { x: w, y: h },
            rotation: 0,
            quantity: spec.quantity,
            dimensions: { length: w, width: h, thickness: spec.thickness },
            shape: spec.shape,
            color: spec.color,
          });
          this.scene.selectPart(part.id);
        }
      } else {
        const kind = this.scene.kind(this.partKindId);
        if (kind) {
          if (w < 15) {
            w = kind.defaultLength;
            pos.x = start.x;
          }
          if (h < 15) {
            h = kind.defaultWidth;
            pos.y = start.y;
          }
          const part = this.scene.addPart({
            kindId: kind.id,
            materialId: kind.defaultMaterialId,
            label: kind.label,
            position: pos,
            size: { x: w, y: h },
            rotation: 0,
            quantity: 1,
            dimensions: { length: w, width: h, thickness: kind.defaultThickness },
            shape: this.partShape ?? kind.defaultShape,
          });
          this.scene.selectPart(part.id);
        }
      }
    }

    if (this.mode.kind !== 'dim') this.mode = { kind: 'idle' };
    if (wasDrag) this.scene.end();
    this.dirty = true;
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const s = this.screen(e);
    const before = this.toWorld(s);
    const factor = Math.exp(-e.deltaY * 0.0015);
    this.cam.scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, this.cam.scale * factor));
    const after = this.toWorld(s);
    this.cam.x += before.x - after.x;
    this.cam.y += before.y - after.y;
    this.dirty = true;
  };

  private onKey = (e: KeyboardEvent): void => {
    const t = document.activeElement;
    if (
      t instanceof HTMLElement &&
      (t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')
    ) {
      return;
    }
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    if (mod && key === 'z') {
      e.preventDefault();
      if (e.shiftKey) this.scene.redo();
      else this.scene.undo();
      return;
    }
    if (mod && key === 'y') {
      e.preventDefault();
      this.scene.redo();
      return;
    }
    if (e.code === 'Space') this.space = true;
    if (e.key === 'Escape') {
      this.mode = { kind: 'idle' };
      this.scene.end();
      this.scene.selectPart(null);
      this.scene.selectDimension(null);
      this.scene.selectNote(null);
      this.dirty = true;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (this.scene.selectedPartId) this.scene.removePart(this.scene.selectedPartId);
      else if (this.scene.selectedDimensionId) this.scene.removeDimension(this.scene.selectedDimensionId);
      else if (this.scene.selectedNoteId) this.scene.removeNote(this.scene.selectedNoteId);
    }
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    if (e.code === 'Space') this.space = false;
  };

  private hitPart(w: Vec2): Part | undefined {
    for (let i = this.scene.parts.length - 1; i >= 0; i--) {
      if (partContains(w, this.scene.parts[i])) return this.scene.parts[i];
    }
    return undefined;
  }

  private hitHandle(s: Vec2, part: Part): boolean {
    const br = this.toScreen({ x: part.position.x + part.size.x, y: part.position.y + part.size.y });
    return Math.abs(s.x - br.x) <= HANDLE && Math.abs(s.y - br.y) <= HANDLE;
  }

  private hitDimension(s: Vec2): Dimension | undefined {
    for (const dim of this.scene.dimensions) {
      const line = this.dimLineScreen(dim);
      if (pointSegmentDistance(s, line.p1, line.p2) <= 8) return dim;
    }
    return undefined;
  }

  private hitNote(s: Vec2): Note | undefined {
    for (let i = this.scene.notes.length - 1; i >= 0; i--) {
      const note = this.scene.notes[i];
      if (!this.scene.isBoardNote(note)) continue;
      const r = this.noteRect(note);
      if (s.x >= r.x && s.x <= r.x + r.w && s.y >= r.y && s.y <= r.y + r.h) return note;
    }
    return undefined;
  }

  private dimLineScreen(dim: Dimension): { p1: Vec2; p2: Vec2 } {
    const a = this.toScreen(this.scene.anchorPoint(dim.a));
    const b = this.toScreen(this.scene.anchorPoint(dim.b));
    const off = dim.offset * this.cam.scale;
    if (dim.axis === 'x') {
      const y = Math.max(a.y, b.y) + off;
      return { p1: { x: a.x, y }, p2: { x: b.x, y } };
    }
    const x = Math.max(a.x, b.x) + off;
    return { p1: { x, y: a.y }, p2: { x, y: b.y } };
  }

  private render(): void {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = this.canvasColor;
    ctx.fillRect(0, 0, this.width, this.height);
    if (this.gridVisible) this.drawGrid(ctx);
    for (const part of this.scene.parts) this.drawPart(ctx, part);
    for (const dim of this.scene.dimensions) this.drawDimension(ctx, dim);
    for (const note of this.scene.notes) {
      if (this.scene.isBoardNote(note)) this.drawNote(ctx, note);
    }
    if (this.mode.kind === 'draw') this.drawPendingPart(ctx, this.mode);
    if (this.mode.kind === 'dim') this.drawPendingDim(ctx, this.mode);
    const selected = this.scene.selectedPart();
    if (selected) this.drawHandles(ctx, selected);
    if (this.rulersVisible) this.drawRulers(ctx);
  }

  private drawGrid(ctx: CanvasRenderingContext2D): void {
    const rgb = hexToRgb(this.canvasColor);
    const dark = rgb.r * 0.299 + rgb.g * 0.587 + rgb.b * 0.114 < 128;
    const k = this.gridOpacity / 100;
    const minor = dark ? `rgba(255,255,255,${0.14 * k})` : `rgba(0,0,0,${0.09 * k})`;
    const major = dark ? `rgba(255,255,255,${0.28 * k})` : `rgba(0,0,0,${0.22 * k})`;
    let step = this.scene.profile.gridSize;
    while (step * this.cam.scale < 7) step *= 5;
    const right = this.cam.x + this.width / this.cam.scale;
    const bottom = this.cam.y + this.height / this.cam.scale;
    const startX = Math.floor(this.cam.x / step) * step;
    const startY = Math.floor(this.cam.y / step) * step;
    const majorStep = step * 5;
    ctx.lineWidth = 1;
    if (this.verticalLinesVisible) {
      for (let x = startX; x <= right; x += step) {
        const sx = Math.round((x - this.cam.x) * this.cam.scale) + 0.5;
        ctx.strokeStyle = Math.abs(x % majorStep) < step / 2 ? major : minor;
        ctx.beginPath();
        ctx.moveTo(sx, 0);
        ctx.lineTo(sx, this.height);
        ctx.stroke();
      }
    }
    if (this.horizontalLinesVisible) {
      for (let y = startY; y <= bottom; y += step) {
        const sy = Math.round((y - this.cam.y) * this.cam.scale) + 0.5;
        ctx.strokeStyle = Math.abs(y % majorStep) < step / 2 ? major : minor;
        ctx.beginPath();
        ctx.moveTo(0, sy);
        ctx.lineTo(this.width, sy);
        ctx.stroke();
      }
    }
  }

  private ruleStep(): number {
    let step = this.scene.profile.gridSize;
    while (step * this.cam.scale < 36) step *= 5;
    return step;
  }

  private rulerText(v: number): string {
    const r = Math.round(v * 10) / 10;
    return Math.abs(r - Math.round(r)) < 0.05 ? String(Math.round(r)) : String(r);
  }

  private drawRulers(ctx: CanvasRenderingContext2D): void {
    const R = 22;
    const rgb = hexToRgb(this.canvasColor);
    const dark = rgb.r * 0.299 + rgb.g * 0.587 + rgb.b * 0.114 < 128;
    const bg = dark ? 'rgba(40,40,40,0.94)' : 'rgba(255,255,250,0.94)';
    const line = dark ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.6)';
    const minor = dark ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.3)';
    const unit = this.scene.displayUnit;
    const step = this.ruleStep();
    const right = this.cam.x + this.width / this.cam.scale;
    const bottom = this.cam.y + this.height / this.cam.scale;
    const startX = Math.floor(this.cam.x / step) * step;
    const startY = Math.floor(this.cam.y / step) * step;

    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, this.width, R);
    ctx.fillRect(0, R, R, this.height - R);
    ctx.strokeStyle = line;
    ctx.lineWidth = 1;
    ctx.font = '9.5px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = line;
    for (let x = startX; x <= right; x += step) {
      const px = Math.round((x - this.cam.x) * this.cam.scale) + 0.5;
      const major = Math.round(x / step) % 5 === 0;
      for (let k = 0; k < 5; k++) {
        const pxs = px + (step * this.cam.scale * k) / 5;
        ctx.strokeStyle = k === 0 && major ? line : minor;
        ctx.beginPath();
        ctx.moveTo(pxs, R - (k === 0 ? (major ? 0 : 5) : 9));
        ctx.lineTo(pxs, R);
        ctx.stroke();
      }
      if (major && px > R + 18) ctx.fillText(this.rulerText(mmToDisplay(x, unit)), px + 3, 3);
    }
    for (let y = startY; y <= bottom; y += step) {
      const py = Math.round((y - this.cam.y) * this.cam.scale) + 0.5;
      const major = Math.round(y / step) % 5 === 0;
      for (let k = 0; k < 5; k++) {
        const pys = py + (step * this.cam.scale * k) / 5;
        ctx.strokeStyle = k === 0 && major ? line : minor;
        ctx.beginPath();
        ctx.moveTo(R - (k === 0 ? (major ? 0 : 5) : 9), pys);
        ctx.lineTo(R, pys);
        ctx.stroke();
      }
      if (major && py > R + 18) {
        ctx.save();
        ctx.translate(3, py + 1);
        ctx.rotate(-Math.PI / 2);
        ctx.fillText(this.rulerText(mmToDisplay(y, unit)), 0, 0);
        ctx.restore();
      }
    }
    ctx.fillStyle = line;
    ctx.fillText(unit, R + 4, R + 2);
  }

  private drawPart(ctx: CanvasRenderingContext2D, part: Part): void {
    const s = this.toScreen(part.position);
    const w = part.size.x * this.cam.scale;
    const h = part.size.y * this.cam.scale;
    const mat = this.scene.material(part.materialId);
    const selected = part.id === this.scene.selectedPartId;
    const fill = part.color ?? mat?.color ?? '#cfcfcf';
    const stroke = selected ? '#2f6df6' : 'rgba(60,50,35,0.55)';
    const shape = part.shape ?? 'rect';
    ctx.globalAlpha = selected ? 1 : 0.92;
    if (shape === 'line') {
      ctx.strokeStyle = fill;
      ctx.lineCap = 'round';
      ctx.lineWidth = Math.max(2, h);
      ctx.beginPath();
      ctx.moveTo(s.x + h / 2, s.y + h / 2);
      ctx.lineTo(s.x + w - h / 2, s.y + h / 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = stroke;
      ctx.lineWidth = selected ? 2 : 1;
      ctx.stroke();
    } else {
      this.traceShape(ctx, shape, s.x, s.y, w, h, true);
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.lineWidth = selected ? 2 : 1;
      ctx.strokeStyle = stroke;
      this.traceShape(ctx, shape, s.x, s.y, w, h, false);
      ctx.stroke();
    }
    if (w > 46 && h > 15) {
      ctx.fillStyle = 'rgba(35,28,18,0.85)';
      ctx.font = '11px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const label = part.quantity > 1 ? `${part.label} x${part.quantity}` : part.label;
      ctx.fillText(label, s.x + w / 2, s.y + h / 2, Math.max(10, w - 6));
    }
  }

  private traceShape(
    ctx: CanvasRenderingContext2D,
    shape: PartShape,
    x: number,
    y: number,
    w: number,
    h: number,
    pad: boolean,
  ): void {
    const px = pad ? 0.5 : 0;
    if (shape === 'circle') {
      ctx.beginPath();
      ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
      return;
    }
    if (shape === 'triangle') {
      ctx.beginPath();
      ctx.moveTo(x + w / 2 + px, y + px);
      ctx.lineTo(x + px, y + h + px);
      ctx.lineTo(x + w + px, y + h + px);
      ctx.closePath();
      return;
    }
    ctx.beginPath();
    ctx.rect(x + px, y + px, w, h);
  }

  private drawHandles(ctx: CanvasRenderingContext2D, part: Part): void {
    const br = this.toScreen({ x: part.position.x + part.size.x, y: part.position.y + part.size.y });
    ctx.fillStyle = '#2f6df6';
    ctx.fillRect(br.x - 5, br.y - 5, 10, 10);
  }

  private noteRect(note: Note): { x: number; y: number; w: number; h: number } {
    const a = this.scene.noteAnchorWorld(note) ?? { x: 0, y: 0 };
    const p = this.toScreen(a);
    const rowCount = Math.max(note.items.length, 1);
    const h = NOTE_PAD_Y * 2 + NOTE_TITLE_H + rowCount * NOTE_LINE_H + 2;
    return { x: p.x, y: p.y, w: NOTE_MAX_W, h };
  }

  private noteDefaultTitle(note: Note): string {
    if (note.context.kind === 'part') {
      const p = this.scene.partById(note.context.partId ?? '');
      return p ? (p.quantity > 1 ? `${p.label} x${p.quantity}` : p.label) : 'Part note';
    }
    if (note.context.kind === 'measure') {
      const d = this.scene.dimensions.find((dm) => dm.id === note.context.dimensionId);
      if (!d) return 'Measure note';
      const a = this.scene.anchorPoint(d.a);
      const b = this.scene.anchorPoint(d.b);
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      return formatLength(len, this.scene.displayUnit, this.scene.displayPrecision);
    }
    return 'Note';
  }

  private rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
  }

  private nearestEdgePoint(s: Vec2, r: { x: number; y: number; w: number; h: number }): Vec2 {
    const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
    const cands: Vec2[] = [
      { x: clamp(s.x, r.x, r.x + r.w), y: r.y },
      { x: clamp(s.x, r.x, r.x + r.w), y: r.y + r.h },
      { x: r.x, y: clamp(s.y, r.y, r.y + r.h) },
      { x: r.x + r.w, y: clamp(s.y, r.y, r.y + r.h) },
    ];
    let best = cands[0];
    let bd = dist(s, best);
    for (const c of cands) {
      const d = dist(s, c);
      if (d < bd) {
        bd = d;
        best = c;
      }
    }
    return best;
  }

  private drawNote(ctx: CanvasRenderingContext2D, note: Note): void {
    const anchor = this.scene.noteAnchorWorld(note) ?? { x: 0, y: 0 };
    const r = this.noteRect(note);
    const selected = note.id === this.scene.selectedNoteId;
    const ctxKind = note.context.kind;

    if (ctxKind === 'part' || ctxKind === 'measure') {
      const target = ctxKind === 'part'
        ? this.toScreen(this.scene.partById(note.context.partId ?? '')?.position ?? anchor)
        : (() => {
            const d = this.scene.dimensions.find((dm) => dm.id === note.context.dimensionId);
            if (!d) return anchor;
            const a = this.scene.anchorPoint(d.a);
            const b = this.scene.anchorPoint(d.b);
            return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
          })();
      const ts = this.toScreen(target);
      const start = this.nearestEdgePoint(ts, r);
      ctx.strokeStyle = 'rgba(138,130,114,0.9)';
      ctx.fillStyle = 'rgba(138,130,114,0.9)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      ctx.lineTo(ts.x, ts.y);
      ctx.stroke();
      const angle = Math.atan2(ts.y - start.y, ts.x - start.x);
      const s = 6;
      ctx.beginPath();
      ctx.moveTo(ts.x, ts.y);
      ctx.lineTo(ts.x - s * Math.cos(angle - 0.42), ts.y - s * Math.sin(angle - 0.42));
      ctx.lineTo(ts.x - s * Math.cos(angle + 0.42), ts.y - s * Math.sin(angle + 0.42));
      ctx.closePath();
      ctx.fill();
    }

    ctx.fillStyle = selected ? '#e9efff' : '#fffdf9';
    this.rr(ctx, r.x, r.y, r.w, r.h, 8);
    ctx.fill();
    ctx.lineWidth = selected ? 2 : 1;
    ctx.strokeStyle = selected ? '#2f6df6' : ctxKind === 'general' ? '#d9d1c0' : '#b9a98a';
    this.rr(ctx, r.x, r.y, r.w, r.h, 8);
    ctx.stroke();

    ctx.font = '600 12px system-ui, sans-serif';
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#6a5d45';
    const title = note.title.trim() || this.noteDefaultTitle(note);
    ctx.fillText(title, r.x + NOTE_PAD_X, r.y + NOTE_PAD_Y, r.w - NOTE_PAD_X * 2);

    ctx.font = NOTE_FONT;
    const items = note.items.length ? note.items : [{ id: '', text: '', checked: false }];
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const by = r.y + NOTE_PAD_Y + NOTE_TITLE_H + i * NOTE_LINE_H + (NOTE_LINE_H - NOTE_BOX) / 2;
      const bx = r.x + NOTE_PAD_X;
      ctx.fillStyle = it.checked ? '#2f6df6' : '#fff';
      this.rr(ctx, bx, by, NOTE_BOX, NOTE_BOX, 3);
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = it.checked ? '#2f6df6' : '#bdb3a0';
      this.rr(ctx, bx, by, NOTE_BOX, NOTE_BOX, 3);
      ctx.stroke();
      if (it.checked) {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(bx + 3.4, by + NOTE_BOX / 2);
        ctx.lineTo(bx + 5.6, by + NOTE_BOX - 2.8);
        ctx.lineTo(bx + NOTE_BOX - 2, by + 3.4);
        ctx.stroke();
      }
      const x0 = bx + NOTE_BOX + NOTE_GAP;
      const textW = r.w - x0 - NOTE_PAD_X;
      ctx.fillStyle = it.checked ? 'rgba(120,112,96,0.6)' : '#241f17';
      const text = it.text || (note.items.length ? '' : 'Empty note');
      ctx.fillText(this.truncate(text, textW), x0, r.y + NOTE_PAD_Y + NOTE_TITLE_H + i * NOTE_LINE_H, textW);
    }
  }

  private truncate(text: string, maxWidth: number): string {
    if (this.ctx.measureText(text).width <= maxWidth) return text;
    let s = text;
    while (s.length > 1 && this.ctx.measureText(`${s}…`).width > maxWidth) s = s.slice(0, -1);
    return `${s}…`;
  }

  private drawPendingPart(ctx: CanvasRenderingContext2D, mode: Mode & { kind: 'draw' }): void {
    const s = this.toScreen(mode.start);
    const e = this.toScreen(mode.current);
    const x = Math.min(s.x, e.x);
    const y = Math.min(s.y, e.y);
    const w = Math.abs(e.x - s.x);
    const h = Math.abs(e.y - s.y);
    ctx.fillStyle = 'rgba(47,109,246,0.12)';
    ctx.strokeStyle = '#2f6df6';
    ctx.setLineDash([5, 4]);
    ctx.lineWidth = 1;
    if (mode.shape === 'line') {
      ctx.beginPath();
      ctx.moveTo(x, y + h / 2);
      ctx.lineTo(x + w, y + h / 2);
      ctx.stroke();
    } else {
      this.traceShape(ctx, mode.shape, x, y, w, h, true);
      ctx.fill();
      this.traceShape(ctx, mode.shape, x, y, w, h, false);
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  private drawDimension(ctx: CanvasRenderingContext2D, dim: Dimension): void {
    const a = this.scene.anchorPoint(dim.a);
    const b = this.scene.anchorPoint(dim.b);
    this.drawDimGeometry(ctx, a, b, dim.axis, dim.offset, dim.id === this.scene.selectedDimensionId);
  }

  private drawPendingDim(ctx: CanvasRenderingContext2D, mode: Mode & { kind: 'dim' }): void {
    const a = this.scene.anchorPoint(mode.first);
    const b = mode.hover;
    const dx = Math.abs(b.x - a.x);
    const dy = Math.abs(b.y - a.y);
    this.drawDimGeometry(ctx, a, b, dx >= dy ? 'x' : 'y', 60, false, true);
  }

  private drawDimGeometry(
    ctx: CanvasRenderingContext2D,
    a: Vec2,
    b: Vec2,
    axis: 'x' | 'y',
    offset: number,
    highlight: boolean,
    dashed = false,
  ): void {
    const A = this.toScreen(a);
    const B = this.toScreen(b);
    const off = offset * this.cam.scale;
    const color = highlight ? '#2f6df6' : '#b0442f';
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 1;
    if (dashed) ctx.setLineDash([4, 4]);

    let value: number;
    if (axis === 'x') {
      const y = Math.max(A.y, B.y) + off;
      this.line(ctx, A.x, A.y, A.x, y);
      this.line(ctx, B.x, B.y, B.x, y);
      this.line(ctx, A.x, y, B.x, y);
      this.arrow(ctx, A.x, y, A.x < B.x ? 1 : -1, 'x');
      this.arrow(ctx, B.x, y, A.x < B.x ? -1 : 1, 'x');
      value = Math.abs(b.x - a.x);
      if (!dashed) {
        this.label(ctx, formatLength(value, this.scene.displayUnit, this.scene.displayPrecision), (A.x + B.x) / 2, y - 12);
      }
    } else {
      const x = Math.max(A.x, B.x) + off;
      this.line(ctx, A.x, A.y, x, A.y);
      this.line(ctx, B.x, B.y, x, B.y);
      this.line(ctx, x, A.y, x, B.y);
      this.arrow(ctx, x, A.y, A.y < B.y ? 1 : -1, 'y');
      this.arrow(ctx, x, B.y, A.y < B.y ? -1 : 1, 'y');
      value = Math.abs(b.y - a.y);
      if (!dashed) {
        this.label(ctx, formatLength(value, this.scene.displayUnit, this.scene.displayPrecision), x + 8, (A.y + B.y) / 2, 'left');
      }
    }
    ctx.setLineDash([]);
  }

  private line(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number): void {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }

  private arrow(ctx: CanvasRenderingContext2D, x: number, y: number, dir: number, axis: 'x' | 'y'): void {
    const s = 5;
    ctx.beginPath();
    if (axis === 'x') {
      ctx.moveTo(x, y);
      ctx.lineTo(x + dir * s, y - s * 0.6);
      ctx.lineTo(x + dir * s, y + s * 0.6);
    } else {
      ctx.moveTo(x, y);
      ctx.lineTo(x - s * 0.6, y + dir * s);
      ctx.lineTo(x + s * 0.6, y + dir * s);
    }
    ctx.closePath();
    ctx.fill();
  }

  private label(
    ctx: CanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
    align: CanvasTextAlign = 'center',
  ): void {
    ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    const metrics = ctx.measureText(text);
    const pad = 3;
    const w = metrics.width + pad * 2;
    const left = align === 'center' ? x - w / 2 : x;
    const rgb = hexToRgb(this.canvasColor);
    const dark = rgb.r * 0.299 + rgb.g * 0.587 + rgb.b * 0.114 < 128;
    ctx.fillStyle = this.canvasColor;
    ctx.fillRect(left, y - 8, w, 16);
    ctx.fillStyle = dark ? '#e0d9c8' : '#8a5a33';
    ctx.fillText(text, align === 'center' ? x : x + pad, y);
  }
}
