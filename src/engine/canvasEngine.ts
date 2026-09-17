import type { Anchor, Dimension, LinearAxis, Material, MeasureMode, Note, Part, PartShape, Vec2 } from '../domain/types';
import { formatAngle, formatArea, formatLength, mmToDisplay } from '../domain/format';
import type { Scene } from './scene';
import {
  angleBetween,
  dist,
  partCenter,
  partContains,
  pointSegmentDistance,
  polygonArea,
  polygonPerimeter,
  rot,
  rotatedPoint,
  snap,
  toLocalFrame,
  worldAABB,
} from './geometry';
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
  | { kind: 'move'; grabs: { id: string; start: Vec2 }[]; grab: Vec2 }
  | { kind: 'move-note'; noteId: string; grab: Vec2 }
  | { kind: 'resize'; partId: string }
  | { kind: 'rotate'; partId: string; angle0: number; rot0: number }
  | { kind: 'draw'; start: Vec2; current: Vec2; shape: PartShape }
  | { kind: 'dim'; first: Anchor; hover: Vec2 }
  | { kind: 'dim-angle'; a: Anchor; b: Anchor | null; hover: Vec2 }
  | { kind: 'dim-radius'; center: Anchor; hover: Vec2 }
  | { kind: 'dim-area'; points: Anchor[]; hover: Vec2 }
  | { kind: 'quick'; start: Vec2; current: Vec2 }
  | { kind: 'marquee'; startScreen: Vec2; currentScreen: Vec2; additive: boolean }
  | { kind: 'dim-offset'; dimId: string; startWorld: Vec2 }
  | { kind: 'pinch'; dist0: number; scale0: number; mid0: Vec2; cam0: Vec2 };

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
  private pointers = new Map<number, Vec2>();

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

  private measureMode: MeasureMode = 'linear';
  private quick = false;

  setMeasureMode(mode: MeasureMode): void {
    this.measureMode = mode;
    this.dirty = true;
  }

  getMeasureMode(): MeasureMode {
    return this.measureMode;
  }

  setQuickMeasure(on: boolean): void {
    this.quick = on;
    if (!on && this.mode.kind === 'quick') this.mode = { kind: 'idle' };
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
    const parts = this.scene.renderOrderParts();
    if (parts.length === 0 && this.scene.notes.length === 0) return;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of parts) {
      const a = worldAABB(p);
      minX = Math.min(minX, a.minX);
      minY = Math.min(minY, a.minY);
      maxX = Math.max(maxX, a.maxX);
      maxY = Math.max(maxY, a.maxY);
    }
    for (const n of this.scene.notes) {
      if (!this.scene.isNoteVisible(n)) continue;
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

  focusPart(id: string): void {
    const p = this.scene.partById(id);
    if (!p) return;
    const a = worldAABB(p);
    const cx = (a.minX + a.maxX) / 2;
    const cy = (a.minY + a.maxY) / 2;
    const size = Math.max(a.maxX - a.minX, a.maxY - a.minY, 1);
    const ideal = Math.min(MAX_SCALE, Math.max(MIN_SCALE, 300 / size));
    this.cam.scale = Math.max(this.cam.scale, ideal);
    this.cam.x = cx - this.width / 2 / this.cam.scale;
    this.cam.y = cy - this.height / 2 / this.cam.scale;
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

    for (const part of this.scene.renderOrderParts()) this.svgPart(push, part);
    for (const dim of this.scene.dimensions) {
      if (this.scene.isDimensionVisible(dim)) this.svgDimension(push, dim, trim);
    }
    for (const note of this.scene.notes) {
      if (this.scene.isNoteVisible(note)) this.svgNote(push, note, trim);
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
    const selected = this.scene.isPartSelected(part.id);
    const fill = part.color ?? mat?.color ?? '#cfcfcf';
    const stroke = selected ? '#2f6df6' : 'rgba(60,50,35,0.55)';
    const sw = selected ? 2 : 1;
    const shape = part.shape ?? 'rect';
    const label = part.quantity > 1 ? `${part.label} x${part.quantity}` : part.label;
    const rotDeg = (rot(part) * 180) / Math.PI;
    if (rotDeg) {
      push(`<g transform="rotate(${svgNum(rotDeg)} ${svgNum(s.x + w / 2)} ${svgNum(s.y + h / 2)}">`);
    }
    if (shape === 'line') {
      push(
        `<line x1="${svgNum(s.x + h / 2)}" y1="${svgNum(s.y + h / 2)}" x2="${svgNum(s.x + w - h / 2)}" y2="${svgNum(s.y + h / 2)}" stroke="${fill}" stroke-width="${Math.max(2, h)}" stroke-linecap="round" opacity="0.92"/>`,
      );
      push(
        `<line x1="${svgNum(s.x + h / 2)}" y1="${svgNum(s.y + h / 2)}" x2="${svgNum(s.x + w - h / 2)}" y2="${svgNum(s.y + h / 2)}" stroke="${stroke}" stroke-width="${sw}" stroke-linecap="round"/>`,
      );
    } else if (shape === 'circle') {
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
    if (rotDeg) push('</g>');
  }

  private svgDimension(push: (line: string) => void, dim: Dimension, trim: (t: string, w: number) => string): void {
    const rgb = hexToRgb(this.canvasColor);
    const dark = rgb.r * 0.299 + rgb.g * 0.587 + rgb.b * 0.114 < 128;
    const color = this.scene.selectedDimensionIds.includes(dim.id) ? '#2f6df6' : '#b0442f';
    const fill = dark ? '#e0d9c8' : '#8a5a33';
    this.ctx.font = '11px system-ui, sans-serif';

    if (dim.kind === 'angle') {
      const a = this.scene.anchorPoint(dim.a);
      const b = this.scene.anchorPoint(dim.b!);
      const c = this.scene.anchorPoint(dim.c!);
      const A = this.toScreen(a);
      const B = this.toScreen(b);
      const C = this.toScreen(c);
      const arcR = Math.max(16, dim.offset);
      const ang1 = Math.atan2(B.y - A.y, B.x - A.x);
      const ang2 = Math.atan2(C.y - A.y, C.x - A.x);
      let d = (ang2 - ang1) % (2 * Math.PI);
      if (d < 0) d += 2 * Math.PI;
      push(`<path d="M${svgNum(A.x)},${svgNum(A.y)}L${svgNum(B.x)},${svgNum(B.y)}" fill="none" stroke="${color}" stroke-width="1"/>`);
      push(`<path d="M${svgNum(A.x)},${svgNum(A.y)}L${svgNum(C.x)},${svgNum(C.y)}" fill="none" stroke="${color}" stroke-width="1"/>`);
      push(`<path d="M${svgNum(A.x + arcR * Math.cos(ang1))},${svgNum(A.y + arcR * Math.sin(ang1))}A${arcR},${arcR} 0 ${d > Math.PI ? 1 : 0} ${d > Math.PI ? 0 : 1} ${svgNum(A.x + arcR * Math.cos(ang2))},${svgNum(A.y + arcR * Math.sin(ang2))}" fill="none" stroke="${color}" stroke-width="1"/>`);
      const mid = (ang1 + ang2) / 2;
      const lx = A.x + Math.cos(mid) * (arcR + 14);
      const ly = A.y + Math.sin(mid) * (arcR + 14);
      push(`<text x="${svgNum(lx)}" y="${svgNum(ly)}" font-size="11" fill="${fill}" text-anchor="middle" dominant-baseline="middle">${esc(trim(formatAngle(angleBetween(a, b, c), this.scene.displayPrecision), 120))}</text>`);
      return;
    }

    if (dim.kind === 'radius') {
      const center = this.scene.anchorPoint(dim.a);
      const rim = this.scene.anchorPoint(dim.b);
      const C = this.toScreen(center);
      const R = this.toScreen(rim);
      const value = dist(center, rim);
      const shown = dim.radiusMode === 'diameter' ? value * 2 : value;
      const text = dim.radiusMode === 'diameter' ? `⌀ ${formatLength(shown, this.scene.displayUnit, this.scene.displayPrecision)}` : `R ${formatLength(shown, this.scene.displayUnit, this.scene.displayPrecision)}`;
      const mx = (C.x + R.x) / 2;
      const my = (C.y + R.y) / 2;
      const dx = R.x - C.x;
      const dy = R.y - C.y;
      const len = Math.hypot(dx, dy) || 1;
      const off = dim.offset * this.cam.scale;
      push(`<path d="M${svgNum(C.x)},${svgNum(C.y)}L${svgNum(R.x)},${svgNum(R.y)}" fill="none" stroke="${color}" stroke-width="1"/>`);
      push(`<text x="${svgNum(mx + (-dy / len) * off)}" y="${svgNum(my + (dx / len) * off)}" font-size="11" fill="${fill}" text-anchor="middle" dominant-baseline="middle">${esc(trim(text, 120))}</text>`);
      return;
    }

    if (dim.kind === 'area' && dim.points) {
      const world = dim.points.map((p) => this.scene.anchorPoint(p));
      const pts = world.map((p) => this.toScreen(p));
      const path = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${svgNum(p.x)},${svgNum(p.y)}`).join('') + 'Z';
      push(`<path d="${path}" fill="${color}" fill-opacity="0.12" stroke="${color}" stroke-width="1"/>`);
      let cx = 0;
      let cy = 0;
      for (const p of pts) {
        cx += p.x;
        cy += p.y;
      }
      cx /= pts.length;
      cy /= pts.length;
      push(`<text x="${svgNum(cx)}" y="${svgNum(cy - 8)}" font-size="11" fill="${fill}" text-anchor="middle" dominant-baseline="middle">${esc(trim(formatArea(polygonArea(world), this.scene.displayUnit, this.scene.displayPrecision), 160))}</text>`);
      push(`<text x="${svgNum(cx)}" y="${svgNum(cy + 8)}" font-size="11" fill="${fill}" text-anchor="middle" dominant-baseline="middle">${esc(trim(`P ${formatLength(polygonPerimeter(world), this.scene.displayUnit, this.scene.displayPrecision)}`, 160))}</text>`);
      return;
    }

    const a = this.scene.anchorPoint(dim.a);
    const b = this.scene.anchorPoint(dim.b);
    const A = this.toScreen(a);
    const B = this.toScreen(b);
    const off = dim.offset * this.cam.scale;
    const value =
      dim.axis === 'free'
        ? dist(a, b)
        : dim.axis === 'x'
          ? Math.abs(b.x - a.x)
          : Math.abs(b.y - a.y);
    const label = trim(this.dimLabel(value, dim.target ?? null), 120);
    const lw = Math.floor(this.ctx.measureText(label).width) + 6;
    if (dim.axis === 'free') {
      const mx = (A.x + B.x) / 2;
      const my = (A.y + B.y) / 2;
      const dx = B.x - A.x;
      const dy = B.y - A.y;
      const len = Math.hypot(dx, dy) || 1;
      const lx = mx + (-dy / len) * off;
      const ly = my + (dx / len) * off;
      push(`<path d="M${svgNum(A.x)},${svgNum(A.y)}L${svgNum(B.x)},${svgNum(B.y)}" fill="none" stroke="${color}" stroke-width="1"/>`);
      this.svgEndArrow(push, A.x, A.y, B.x, B.y, color);
      this.svgEndArrow(push, B.x, B.y, A.x, A.y, color);
      push(`<rect x="${svgNum(lx - lw / 2)}" y="${svgNum(ly - 8)}" width="${lw}" height="16" fill="${this.canvasColor}"/>`);
      push(`<text x="${svgNum(lx)}" y="${svgNum(ly)}" font-size="11" fill="${fill}" text-anchor="middle" dominant-baseline="middle">${esc(label)}</text>`);
    } else if (dim.axis === 'x') {
      const y = svgNum(Math.max(A.y, B.y) + off);
      push(`<path d="M${svgNum(A.x)},${svgNum(A.y)}V${y}M${svgNum(B.x)},${svgNum(B.y)}V${y}M${svgNum(A.x)},${y}H${svgNum(B.x)}" fill="none" stroke="${color}" stroke-width="1"/>`);
      this.svgArrow(push, A.x, A.y + off, A.x < B.x ? 1 : -1, 'x', color);
      this.svgArrow(push, B.x, B.y + off, A.x < B.x ? -1 : 1, 'x', color);
      const cx = svgNum((A.x + B.x) / 2);
      const cy = svgNum(Math.max(A.y, B.y) + off - 12);
      push(`<rect x="${svgNum((A.x + B.x) / 2 - lw / 2)}" y="${svgNum(Math.max(A.y, B.y) + off - 21)}" width="${lw}" height="16" fill="${this.canvasColor}"/>`);
      push(`<text x="${cx}" y="${cy}" font-size="11" fill="${fill}" text-anchor="middle" dominant-baseline="middle">${esc(label)}</text>`);
    } else {
      const x = svgNum(Math.max(A.x, B.x) + off);
      push(`<path d="M${svgNum(A.x)},${svgNum(A.y)}H${x}M${svgNum(B.x)},${svgNum(B.y)}H${x}M${x},${svgNum(A.y)}V${svgNum(B.y)}" fill="none" stroke="${color}" stroke-width="1"/>`);
      this.svgArrow(push, A.x + off, A.y, A.y < B.y ? 1 : -1, 'y', color);
      this.svgArrow(push, B.x + off, B.y, A.y < B.y ? -1 : 1, 'y', color);
      const lx = svgNum(Math.max(A.x, B.x) + off + 8);
      const cy = svgNum((A.y + B.y) / 2);
      push(`<text x="${lx}" y="${cy}" font-size="11" fill="${fill}" text-anchor="start" dominant-baseline="middle">${esc(label)}</text>`);
    }
  }

  private svgEndArrow(
    push: (line: string) => void,
    tx: number,
    ty: number,
    fx: number,
    fy: number,
    color: string,
  ): void {
    const dx = tx - fx;
    const dy = ty - fy;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const s = 6;
    push(
      `<polygon points="${svgNum(tx)},${svgNum(ty)} ${svgNum(tx - ux * s - uy * s * 0.5)},${svgNum(ty - uy * s + ux * s * 0.5)} ${svgNum(tx - ux * s + uy * s * 0.5)},${svgNum(ty - uy * s - ux * s * 0.5)}" fill="${color}"/>`,
    );
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
            if (d.kind === 'angle') return this.toScreen(this.scene.anchorPoint(d.a));
            if (d.kind === 'area' && d.points) {
              let cx = 0;
              let cy = 0;
              for (const p of d.points) {
                const w = this.scene.anchorPoint(p);
                cx += w.x;
                cy += w.y;
              }
              return this.toScreen({ x: cx / d.points.length, y: cy / d.points.length });
            }
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

  private edgeSnap(
    size: Vec2,
    start: Vec2,
    off: Vec2,
    others: { minX: number; minY: number; maxX: number; maxY: number }[],
    thresh: number,
  ): Vec2 {
    const out = { x: off.x, y: off.y };
    let bx: number | null = null;
    let bdx = thresh;
    let by: number | null = null;
    let bdy = thresh;
    for (const o of others) {
      const lx = start.x + off.x;
      const rx = lx + size.x;
      const ty = start.y + off.y;
      const byY = ty + size.y;
      for (const line of [o.minX, o.maxX] as const) {
        const dl = Math.abs(lx - line);
        const dr = Math.abs(rx - line);
        if (dl < bdx) {
          bdx = dl;
          bx = line;
        }
        if (dr < bdx) {
          bdx = dr;
          bx = line - size.x;
        }
      }
      for (const line of [o.minY, o.maxY] as const) {
        const dt = Math.abs(ty - line);
        const db = Math.abs(byY - line);
        if (dt < bdy) {
          bdy = dt;
          by = line;
        }
        if (db < bdy) {
          bdy = db;
          by = line - size.y;
        }
      }
    }
    if (bx !== null && bdx <= thresh) out.x = bx - start.x;
    if (by !== null && bdy <= thresh) out.y = by - start.y;
    return out;
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

    this.pointers.set(e.pointerId, s);
    if (this.pointers.size > 1) {
      if (this.mode.kind !== 'pinch') {
        this.scene.end();
        const pts = [...this.pointers.values()];
        this.mode = {
          kind: 'pinch',
          dist0: Math.max(1, Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y)),
          scale0: this.cam.scale,
          mid0: { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 },
          cam0: { ...this.cam },
        };
      }
      this.dirty = true;
      return;
    }

    if (e.button === 1 || this.space || this.tool === 'pan') {
      this.mode = { kind: 'pan', startScreen: s, startCam: { x: this.cam.x, y: this.cam.y } };
      return;
    }
    if (e.button !== 0) return;

    if (this.quick && (this.tool === 'select' || this.tool === 'dimension') && !this.hitPart(w) && !this.hitDimension(s) && !this.hitNote(s)) {
      this.mode = { kind: 'quick', start: w, current: w };
      this.dirty = true;
      return;
    }

    if (this.tool === 'select') {
      const selection = this.scene.selectedParts();
      const primary = this.scene.selectedPart();
      if (selection.length === 1 && primary && !this.scene.isPartLocked(primary.id)) {
        if (this.hitRotateHandle(s, primary)) {
          const c = partCenter(primary);
          const w0 = this.toWorld(s);
          this.scene.begin();
          this.mode = {
            kind: 'rotate',
            partId: primary.id,
            angle0: Math.atan2(w0.y - c.y, w0.x - c.x),
            rot0: rot(primary),
          };
          return;
        }
        if (this.hitHandle(s, primary)) {
          this.scene.begin();
          this.mode = { kind: 'resize', partId: primary.id };
          return;
        }
      }
      const part = this.hitPart(w);
      if (part) {
        if (e.shiftKey) {
          this.scene.togglePartSelected(part.id);
          this.dirty = true;
          return;
        }
        if (this.scene.isPartSelected(part.id) && selection.length > 1) {
          this.scene.begin();
          this.mode = {
            kind: 'move',
            grabs: selection.filter((p) => !this.scene.isPartLocked(p.id)).map((p) => ({ id: p.id, start: { x: p.position.x, y: p.position.y } })),
            grab: { x: w.x - part.position.x, y: w.y - part.position.y },
          };
          return;
        }
        this.scene.selectPart(part.id);
        this.scene.begin();
        this.mode = { kind: 'move', grabs: [{ id: part.id, start: part.position }], grab: { x: w.x - part.position.x, y: w.y - part.position.y } };
        return;
      }
      const dim = this.hitDimension(s);
      if (dim) {
        if (e.shiftKey) this.scene.toggleDimensionSelected(dim.id);
        else this.scene.selectDimension(dim.id);
        this.scene.begin();
        this.mode = { kind: 'dim-offset', dimId: dim.id, startWorld: w };
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
      this.mode = { kind: 'marquee', startScreen: s, currentScreen: s, additive: e.shiftKey };
      this.dirty = true;
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
      this.onMeasureDown(w, e);
      return;
    }
  };

  private onMeasureDown(w: Vec2, e: PointerEvent): void {
    const tolerance = 12 / this.cam.scale;
    const anchor = this.scene.resolveAnchor(w, tolerance);

    if (this.measureMode === 'angle') {
      if (this.mode.kind === 'dim-angle') {
        if (this.mode.b) {
          const c = anchor;
          const a = this.scene.anchorPoint(this.mode.a);
          const b = this.scene.anchorPoint(this.mode.b);
          const cc = this.scene.anchorPoint(c);
          if (angleBetween(a, b, cc) > 0.01) {
            this.scene.addDimension({ kind: 'angle', a: this.mode.a, b: this.mode.b, c, offset: 60, axis: 'free' });
          }
          this.mode = { kind: 'idle' };
        } else {
          this.mode = { kind: 'dim-angle', a: this.mode.a, b: anchor, hover: w };
        }
      } else {
        this.mode = { kind: 'dim-angle', a: anchor, b: null, hover: w };
      }
      this.dirty = true;
      return;
    }

    if (this.measureMode === 'radius') {
      if (this.mode.kind === 'dim-radius') {
        const center = this.scene.anchorPoint(this.mode.center);
        const rim = this.scene.anchorPoint(anchor);
        if (dist(center, rim) > 0.5) {
          this.scene.addDimension({ kind: 'radius', a: this.mode.center, b: anchor, offset: 40, axis: 'free' });
        }
        this.mode = { kind: 'idle' };
      } else {
        this.mode = { kind: 'dim-radius', center: anchor, hover: w };
      }
      this.dirty = true;
      return;
    }

    if (this.measureMode === 'area') {
      if (this.mode.kind === 'dim-area') {
        if (e.detail === 2) {
          if (this.mode.points.length >= 3) {
            this.scene.addDimension({
              kind: 'area',
              a: this.mode.points[0],
              b: this.mode.points[this.mode.points.length - 1],
              points: this.mode.points,
              offset: 0,
              axis: 'free',
            });
            this.mode = { kind: 'idle' };
          }
          this.dirty = true;
          return;
        }
        const first = this.scene.anchorPoint(this.mode.points[0]);
        const p = this.scene.anchorPoint(anchor);
        const closeEnough = this.mode.points.length >= 3 && dist(first, p) <= 10 / this.cam.scale;
        if (closeEnough) {
          this.scene.addDimension({
            kind: 'area',
            a: this.mode.points[0],
            b: this.mode.points[this.mode.points.length - 1],
            points: this.mode.points,
            offset: 0,
            axis: 'free',
          });
          this.mode = { kind: 'idle' };
        } else {
          this.mode = { kind: 'dim-area', points: [...this.mode.points, anchor], hover: w };
        }
      } else {
        this.mode = { kind: 'dim-area', points: [anchor], hover: w };
      }
      this.dirty = true;
      return;
    }

    if (this.mode.kind === 'dim') {
      const a = this.scene.anchorPoint(this.mode.first);
      const b = this.scene.anchorPoint(anchor);
      const dx = Math.abs(b.x - a.x);
      const dy = Math.abs(b.y - a.y);
      if (dx > 0.5 || dy > 0.5) {
        const axis = this.measureMode === 'diagonal' ? 'free' : dx >= dy ? 'x' : 'y';
        this.scene.addDimension({ kind: 'linear', a: this.mode.first, b: anchor, offset: 60, axis });
      }
      this.mode = { kind: 'idle' };
    } else {
      this.mode = { kind: 'dim', first: anchor, hover: w };
    }
    this.dirty = true;
  }

  private onMove = (e: PointerEvent): void => {
    const s = this.screen(e);
    const w = this.toWorld(s);
    if (this.pointers.has(e.pointerId) || e.pointerType === 'touch') this.pointers.set(e.pointerId, s);
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
      case 'pinch': {
        const pts = [...this.pointers.values()];
        if (pts.length >= 2) {
          const dist = Math.max(1, Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y));
          const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
          const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, this.mode.scale0 * (dist / this.mode.dist0)));
          const wx = (this.mode.mid0.x - this.mode.cam0.x) / this.mode.scale0;
          const wy = (this.mode.mid0.y - this.mode.cam0.y) / this.mode.scale0;
          this.cam.scale = scale;
          this.cam.x = wx - mid.x / scale;
          this.cam.y = wy - mid.y / scale;
          this.dirty = true;
        }
        break;
      }
      case 'move': {
        const dx = w.x - this.mode.grab.x;
        const dy = w.y - this.mode.grab.y;
        const grabbed = this.mode.grabs[0];
        if (grabbed) {
          const part = this.scene.partById(grabbed.id);
          const ox = dx - grabbed.start.x;
          const oy = dy - grabbed.start.y;
          let offX = ox;
          let offY = oy;
          if (this.snapEnabled) {
            if (part) {
              const others = this.scene.parts
                .filter((p) => p.id !== grabbed.id && this.scene.isPartVisible(p.id) && !this.scene.isPartLocked(p.id))
                .map(worldAABB);
              const snapped = this.edgeSnap(part.size, grabbed.start, { x: ox, y: oy }, others, 6 / this.cam.scale);
              offX = snapped.x;
              offY = snapped.y;
              if (snapped.x === ox && snapped.y === oy) {
                offX = this.snapAxis(ox);
                offY = this.snapAxis(oy);
              }
            } else {
              offX = this.snapAxis(ox);
              offY = this.snapAxis(oy);
            }
          }
          for (const g of this.mode.grabs) {
            const p = this.scene.partById(g.id);
            if (p && !this.scene.isPartLocked(g.id)) {
              this.scene.updatePart(g.id, {
                position: { x: g.start.x + offX, y: g.start.y + offY },
              });
            }
          }
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
          const lp = toLocalFrame(part, w);
          const nw = Math.max(1, this.snapAxis(lp.x));
          const nh = Math.max(1, this.snapAxis(lp.y));
          this.scene.updatePart(part.id, {
            size: { x: nw, y: nh },
          });
        }
        break;
      }
      case 'rotate': {
        const part = this.scene.partById(this.mode.partId);
        if (part) {
          const c = partCenter(part);
          const angle = Math.atan2(w.y - c.y, w.x - c.x);
          let r = this.mode.rot0 + (angle - this.mode.angle0);
          if (e.shiftKey) r = Math.round(r / (Math.PI / 12)) * (Math.PI / 12);
          this.scene.updatePart(part.id, { rotation: r });
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
        this.measureReadout(this.scene.anchorPoint(this.mode.first), w);
        this.dirty = true;
        break;
      }
      case 'dim-angle': {
        this.mode.hover = w;
        const a = this.scene.anchorPoint(this.mode.a);
        if (this.mode.b) {
          const b = this.scene.anchorPoint(this.mode.b);
          this.opts.onStatus?.(`angle ${formatAngle(angleBetween(a, b, w), this.scene.displayPrecision)}`);
        } else {
          this.opts.onStatus?.(`vertex set — click the first arm`);
        }
        this.dirty = true;
        break;
      }
      case 'dim-radius': {
        this.mode.hover = w;
        const c = this.scene.anchorPoint(this.mode.center);
        this.measureReadout(c, w);
        this.dirty = true;
        break;
      }
      case 'dim-area': {
        this.mode.hover = w;
        this.opts.onStatus?.(`area — ${this.mode.points.length} point(s), click first to close`);
        this.dirty = true;
        break;
      }
      case 'quick': {
        this.mode.current = w;
        const d = dist(this.mode.start, w);
        const ang = Math.atan2(w.y - this.mode.start.y, w.x - this.mode.start.x);
        this.opts.onStatus?.(
          `${formatLength(d, unit, this.scene.displayPrecision)}  ∠ ${formatAngle(Math.abs(ang), this.scene.displayPrecision)}`,
        );
        this.dirty = true;
        break;
      }
      case 'marquee': {
        this.mode = { ...this.mode, currentScreen: s };
        this.dirty = true;
        break;
      }
      case 'dim-offset': {
        const mode = this.mode;
        const dim = this.scene.dimensions.find((d) => d.id === mode.dimId);
        if (dim) {
          const delta = dim.axis === 'x' ? w.y - mode.startWorld.y : w.x - mode.startWorld.x;
          this.scene.updateDimension(dim.id, { offset: Math.round((dim.offset + delta / this.cam.scale) * 100) / 100 });
          this.mode = { ...mode, startWorld: w };
        }
        break;
      }
      default:
        break;
    }
  };

  private onUp = (e: PointerEvent): void => {
    this.pointers.delete(e.pointerId);
    if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);

    const wasDrag =
      this.mode.kind === 'move' ||
      this.mode.kind === 'resize' ||
      this.mode.kind === 'rotate' ||
      this.mode.kind === 'move-note' ||
      this.mode.kind === 'dim-offset';

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

    if (this.mode.kind === 'marquee') {
      const m = this.mode;
      const dx = m.currentScreen.x - m.startScreen.x;
      const dy = m.currentScreen.y - m.startScreen.y;
      if (Math.hypot(dx, dy) < 3) {
        if (!m.additive) this.scene.selectParts([]);
      } else {
        const minX = Math.min(m.startScreen.x, m.currentScreen.x);
        const minY = Math.min(m.startScreen.y, m.currentScreen.y);
        const maxX = Math.max(m.startScreen.x, m.currentScreen.x);
        const maxY = Math.max(m.startScreen.y, m.currentScreen.y);
        const r0 = this.toWorld({ x: minX, y: minY });
        const r1 = this.toWorld({ x: maxX, y: maxY });
        const hit = new Set<string>();
        for (const part of this.scene.parts) {
          if (!this.scene.isPartVisible(part.id) || this.scene.isPartLocked(part.id)) continue;
          const a = worldAABB(part);
          if (a.minX <= r1.x && a.maxX >= r0.x && a.minY <= r1.y && a.maxY >= r0.y) hit.add(part.id);
        }
        this.scene.selectParts(m.additive ? [...new Set([...this.scene.selectedPartIds, ...hit])] : [...hit]);
      }
    }

    const pending =
      this.mode.kind === 'dim' ||
      this.mode.kind === 'dim-angle' ||
      this.mode.kind === 'dim-radius' ||
      this.mode.kind === 'dim-area';
    if (this.mode.kind !== 'quick' && !pending) this.mode = { kind: 'idle' };
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
    if (mod && key === 'c') {
      e.preventDefault();
      this.scene.copySelection();
      return;
    }
    if (mod && key === 'v') {
      e.preventDefault();
      this.scene.paste();
      this.dirty = true;
      return;
    }
    if (mod && key === 'd') {
      e.preventDefault();
      this.scene.duplicate();
      this.dirty = true;
      return;
    }
    if (e.code === 'Space') this.space = true;
    if (key === 'q') {
      this.setQuickMeasure(!this.quick);
      this.opts.onStatus?.(this.quick ? 'Quick measure ON — drag to measure' : 'Quick measure OFF');
      return;
    }
    if (key === 'enter' && this.mode.kind === 'dim-area' && this.mode.points.length >= 3) {
      this.scene.addDimension({
        kind: 'area',
        a: this.mode.points[0],
        b: this.mode.points[this.mode.points.length - 1],
        points: this.mode.points,
        offset: 0,
        axis: 'free',
      });
      this.mode = { kind: 'idle' };
      this.dirty = true;
      return;
    }
    if (e.key === 'Escape') {
      this.mode = { kind: 'idle' };
      this.scene.end();
      this.scene.selectParts([]);
      this.scene.selectDimension(null);
      this.scene.selectNote(null);
      this.dirty = true;
    }
    if (key === 'arrowup' || key === 'arrowdown' || key === 'arrowleft' || key === 'arrowright') {
      e.preventDefault();
      const step = (e.shiftKey ? 10 : 1) * (this.snapEnabled ? this.scene.profile.gridSize : 1);
      const dx = key === 'arrowleft' ? -step : key === 'arrowright' ? step : 0;
      const dy = key === 'arrowup' ? -step : key === 'arrowdown' ? step : 0;
      const ids = this.scene.selectedPartIds;
      if (ids.length) {
        this.scene.begin();
        for (const id of ids) {
          const p = this.scene.partById(id);
          if (p) this.scene.updatePart(id, { position: { x: p.position.x + dx, y: p.position.y + dy } });
        }
        this.scene.end();
        this.dirty = true;
      } else if (this.scene.selectedDimensionId) {
        const dim = this.scene.dimensions.find((d) => d.id === this.scene.selectedDimensionId);
        if (dim && dim.kind === 'linear') {
          this.scene.begin();
          const delta = dim.axis === 'x' ? dy : dim.axis === 'y' ? dx : (dx + dy) / 2;
          this.scene.updateDimension(dim.id, { offset: dim.offset + delta });
          this.scene.end();
          this.dirty = true;
        }
      } else if (this.scene.selectedNoteId) {
        const note = this.scene.noteById(this.scene.selectedNoteId);
        if (note && note.context.kind === 'general' && note.board) {
          const pos = note.position ?? { x: 0, y: 0 };
          this.scene.begin();
          this.scene.updateNote(note.id, { position: { x: pos.x + dx, y: pos.y + dy } });
          this.scene.end();
          this.dirty = true;
        }
      }
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (this.scene.selectedPartIds.length > 0) {
        for (const id of [...this.scene.selectedPartIds]) this.scene.removePart(id);
      } else if (this.scene.selectedDimensionId) this.scene.removeDimension(this.scene.selectedDimensionId);
      else if (this.scene.selectedNoteId) this.scene.removeNote(this.scene.selectedNoteId);
    }
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    if (e.code === 'Space') this.space = false;
  };

  private hitPart(w: Vec2): Part | undefined {
    const order = this.scene.renderOrderParts();
    for (let i = order.length - 1; i >= 0; i--) {
      const p = order[i];
      if (this.scene.isPartLocked(p.id)) continue;
      if (partContains(w, p)) return p;
    }
    return undefined;
  }

  private hitHandle(s: Vec2, part: Part): boolean {
    const corner = this.toScreen(rotatedPoint(part, { x: part.size.x, y: part.size.y }));
    return Math.abs(s.x - corner.x) <= HANDLE && Math.abs(s.y - corner.y) <= HANDLE;
  }

  private rotateHandleScreen(part: Part): Vec2 {
    const a = worldAABB(part);
    return this.toScreen({ x: (a.minX + a.maxX) / 2, y: a.minY - 22 / this.cam.scale });
  }

  private hitRotateHandle(s: Vec2, part: Part): boolean {
    const h = this.rotateHandleScreen(part);
    return Math.abs(s.x - h.x) <= HANDLE && Math.abs(s.y - h.y) <= HANDLE;
  }

  private hitDimension(s: Vec2): Dimension | undefined {
    for (const dim of this.scene.dimensions) {
      for (const seg of this.dimSegments(dim)) {
        if (pointSegmentDistance(s, seg.p1, seg.p2) <= 8) return dim;
      }
    }
    return undefined;
  }

  private dimSegments(dim: Dimension): { p1: Vec2; p2: Vec2 }[] {
    const color = dim.id === this.scene.selectedDimensionId ? '#2f6df6' : '#b0442f';
    void color;
    if (dim.kind === 'angle') {
      const a = this.toScreen(this.scene.anchorPoint(dim.a));
      const b = this.toScreen(this.scene.anchorPoint(dim.b!));
      const c = this.toScreen(this.scene.anchorPoint(dim.c!));
      return [
        { p1: a, p2: b },
        { p1: a, p2: c },
      ];
    }
    if (dim.kind === 'radius') {
      const a = this.toScreen(this.scene.anchorPoint(dim.a));
      const b = this.toScreen(this.scene.anchorPoint(dim.b));
      return [{ p1: a, p2: b }];
    }
    if (dim.kind === 'area' && dim.points) {
      const pts = dim.points.map((p) => this.toScreen(this.scene.anchorPoint(p)));
      const segs: { p1: Vec2; p2: Vec2 }[] = [];
      for (let i = 0; i < pts.length; i++) segs.push({ p1: pts[i], p2: pts[(i + 1) % pts.length] });
      return segs;
    }
    const a = this.toScreen(this.scene.anchorPoint(dim.a));
    const b = this.toScreen(this.scene.anchorPoint(dim.b));
    const off = dim.offset * this.cam.scale;
    if (dim.axis === 'x') {
      const y = Math.max(a.y, b.y) + off;
      return [{ p1: { x: a.x, y }, p2: { x: b.x, y } }];
    }
    if (dim.axis === 'y') {
      const x = Math.max(a.x, b.x) + off;
      return [{ p1: { x, y: a.y }, p2: { x, y: b.y } }];
    }
    return [{ p1: a, p2: b }];
  }

  private measureReadout(a: Vec2, b: Vec2): void {
    const unit = this.scene.displayUnit;
    const dx = Math.abs(b.x - a.x);
    const dy = Math.abs(b.y - a.y);
    const d = Math.hypot(dx, dy);
    this.opts.onStatus?.(
      `${formatLength(d, unit, this.scene.displayPrecision)}  (dx ${formatLength(dx, unit, this.scene.displayPrecision)}, dy ${formatLength(dy, unit, this.scene.displayPrecision)})`,
    );
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

  private render(): void {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = this.canvasColor;
    ctx.fillRect(0, 0, this.width, this.height);
    if (this.gridVisible) this.drawGrid(ctx);
    for (const part of this.scene.renderOrderParts()) this.drawPart(ctx, part);
    for (const dim of this.scene.dimensions) {
      if (this.scene.isDimensionVisible(dim)) this.drawDimension(ctx, dim);
    }
    for (const note of this.scene.notes) {
      if (this.scene.isNoteVisible(note)) this.drawNote(ctx, note);
    }
    if (this.mode.kind === 'draw') this.drawPendingPart(ctx, this.mode);
    if (
      this.mode.kind === 'dim' ||
      this.mode.kind === 'dim-angle' ||
      this.mode.kind === 'dim-radius' ||
      this.mode.kind === 'dim-area' ||
      this.mode.kind === 'quick'
    ) {
      this.drawPendingDim(ctx, this.mode);
    }
    if (this.mode.kind === 'marquee') this.drawMarquee(ctx, this.mode);
    if (this.scene.selectedPartIds.length === 1) {
      const selected = this.scene.selectedPart();
      if (selected) this.drawHandles(ctx, selected);
    }
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
    const selected = this.scene.isPartSelected(part.id);
    const fill = part.color ?? mat?.color ?? '#cfcfcf';
    const stroke = selected ? '#2f6df6' : 'rgba(60,50,35,0.55)';
    const shape = part.shape ?? 'rect';
    const angle = rot(part);
    ctx.save();
    ctx.translate(s.x, s.y);
    if (angle) {
      ctx.translate(w / 2, h / 2);
      ctx.rotate(angle);
      ctx.translate(-w / 2, -h / 2);
    }
    ctx.globalAlpha = selected ? 1 : 0.92;
    if (shape === 'line') {
      ctx.strokeStyle = fill;
      ctx.lineCap = 'round';
      ctx.lineWidth = Math.max(2, h);
      ctx.beginPath();
      ctx.moveTo(h / 2, h / 2);
      ctx.lineTo(w - h / 2, h / 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = stroke;
      ctx.lineWidth = selected ? 2 : 1;
      ctx.stroke();
    } else {
      this.traceShape(ctx, shape, 0, 0, w, h, true);
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.lineWidth = selected ? 2 : 1;
      ctx.strokeStyle = stroke;
      this.traceShape(ctx, shape, 0, 0, w, h, false);
      ctx.stroke();
    }
    if (w > 46 && h > 15) {
      ctx.fillStyle = 'rgba(35,28,18,0.85)';
      ctx.font = '11px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const label = part.quantity > 1 ? `${part.label} x${part.quantity}` : part.label;
      ctx.fillText(label, w / 2, h / 2, Math.max(10, w - 6));
    }
    ctx.restore();
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
    const corner = this.toScreen(rotatedPoint(part, { x: part.size.x, y: part.size.y }));
    ctx.fillStyle = '#2f6df6';
    ctx.fillRect(corner.x - 5, corner.y - 5, 10, 10);
    const a = worldAABB(part);
    const topC = this.toScreen({ x: (a.minX + a.maxX) / 2, y: a.minY });
    const h = this.rotateHandleScreen(part);
    ctx.strokeStyle = '#2f6df6';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(topC.x, topC.y);
    ctx.lineTo(h.x, h.y);
    ctx.stroke();
    ctx.fillStyle = '#2f6df6';
    ctx.beginPath();
    ctx.arc(h.x, h.y, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#2f6df6';
    ctx.font = '10.5px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    const deg = Math.round((rot(part) * 180) / Math.PI);
    ctx.fillText(`${deg}°`, h.x, h.y - 9);
  }

  private drawMarquee(ctx: CanvasRenderingContext2D, mode: Mode & { kind: 'marquee' }): void {
    const minX = Math.min(mode.startScreen.x, mode.currentScreen.x);
    const minY = Math.min(mode.startScreen.y, mode.currentScreen.y);
    const w = Math.abs(mode.currentScreen.x - mode.startScreen.x);
    const h = Math.abs(mode.currentScreen.y - mode.startScreen.y);
    ctx.fillStyle = mode.additive ? 'rgba(47,109,246,0.05)' : 'rgba(47,109,246,0.1)';
    ctx.strokeStyle = '#2f6df6';
    ctx.setLineDash([5, 4]);
    ctx.lineWidth = 1;
    ctx.fillRect(minX, minY, w, h);
    ctx.strokeRect(minX, minY, w, h);
    ctx.setLineDash([]);
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
    const highlight = this.scene.selectedDimensionIds.includes(dim.id);
    if (dim.kind === 'angle') {
      this.drawAngle(ctx, this.scene.anchorPoint(dim.a), this.scene.anchorPoint(dim.b!), this.scene.anchorPoint(dim.c!), dim.offset, highlight, false);
    } else if (dim.kind === 'radius') {
      this.drawRadius(ctx, this.scene.anchorPoint(dim.a), this.scene.anchorPoint(dim.b), dim.offset, dim.radiusMode ?? 'radius', highlight, false);
    } else if (dim.kind === 'area' && dim.points) {
      this.drawArea(ctx, dim.points, highlight, false);
    } else {
      this.drawLinear(ctx, this.scene.anchorPoint(dim.a), this.scene.anchorPoint(dim.b), dim.axis, dim.offset, highlight, false, dim.target ?? null);
    }
  }

  private dimLabel(value: number, target: number | null): string {
    const base = formatLength(value, this.scene.displayUnit, this.scene.displayPrecision);
    if (target == null) return base;
    const diff = value - target;
    const sign = diff >= 0 ? '+' : '−';
    return `${base}  (${sign}${formatLength(Math.abs(diff), this.scene.displayUnit, this.scene.displayPrecision)})`;
  }

  private drawLinear(
    ctx: CanvasRenderingContext2D,
    aA: Vec2,
    bB: Vec2,
    axis: LinearAxis,
    offset: number,
    highlight: boolean,
    dashed = false,
    target: number | null = null,
  ): void {
    const A = this.toScreen(aA);
    const B = this.toScreen(bB);
    const off = offset * this.cam.scale;
    const color = highlight ? '#2f6df6' : '#b0442f';
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 1;
    if (dashed) ctx.setLineDash([4, 4]);

    if (axis === 'free') {
      const mx = (A.x + B.x) / 2;
      const my = (A.y + B.y) / 2;
      const dx = B.x - A.x;
      const dy = B.y - A.y;
      const len = Math.hypot(dx, dy) || 1;
      const px = -dy / len;
      const py = dx / len;
      this.line(ctx, A.x, A.y, B.x, B.y);
      this.endArrow(ctx, A, B, color);
      this.endArrow(ctx, B, A, color);
      if (!dashed) this.label(ctx, this.dimLabel(dist(aA, bB), target), mx + px * off, my + py * off);
    } else if (axis === 'x') {
      const y = Math.max(A.y, B.y) + off;
      this.line(ctx, A.x, A.y, A.x, y);
      this.line(ctx, B.x, B.y, B.x, y);
      this.line(ctx, A.x, y, B.x, y);
      this.arrow(ctx, A.x, y, A.x < B.x ? 1 : -1, 'x');
      this.arrow(ctx, B.x, y, A.x < B.x ? -1 : 1, 'x');
      if (!dashed) this.label(ctx, this.dimLabel(Math.abs(bB.x - aA.x), target), (A.x + B.x) / 2, y - 12);
    } else {
      const x = Math.max(A.x, B.x) + off;
      this.line(ctx, A.x, A.y, x, A.y);
      this.line(ctx, B.x, B.y, x, B.y);
      this.line(ctx, x, A.y, x, B.y);
      this.arrow(ctx, x, A.y, A.y < B.y ? 1 : -1, 'y');
      this.arrow(ctx, x, B.y, A.y < B.y ? -1 : 1, 'y');
      if (!dashed) this.label(ctx, this.dimLabel(Math.abs(bB.y - aA.y), target), x + 8, (A.y + B.y) / 2, 'left');
    }
    ctx.setLineDash([]);
  }

  private drawAngle(
    ctx: CanvasRenderingContext2D,
    a: Vec2,
    b: Vec2,
    c: Vec2,
    offset: number,
    highlight: boolean,
    dashed = false,
  ): void {
    const A = this.toScreen(a);
    const B = this.toScreen(b);
    const C = this.toScreen(c);
    const color = highlight ? '#2f6df6' : '#b0442f';
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 1;
    if (dashed) ctx.setLineDash([4, 4]);
    this.line(ctx, A.x, A.y, B.x, B.y);
    this.line(ctx, A.x, A.y, C.x, C.y);
    const arcR = Math.max(16, offset);
    const ang1 = Math.atan2(B.y - A.y, B.x - A.x);
    const ang2 = Math.atan2(C.y - A.y, C.x - A.x);
    let d = (ang2 - ang1) % (2 * Math.PI);
    if (d < 0) d += 2 * Math.PI;
    ctx.beginPath();
    ctx.arc(A.x, A.y, arcR, ang1, ang2, d > Math.PI);
    ctx.stroke();
    const mid = (ang1 + ang2) / 2;
    this.label(ctx, formatAngle(angleBetween(a, b, c), this.scene.displayPrecision), A.x + Math.cos(mid) * (arcR + 14), A.y + Math.sin(mid) * (arcR + 14));
    ctx.setLineDash([]);
  }

  private drawRadius(
    ctx: CanvasRenderingContext2D,
    center: Vec2,
    rim: Vec2,
    offset: number,
    mode: 'radius' | 'diameter',
    highlight: boolean,
    dashed = false,
  ): void {
    const C = this.toScreen(center);
    const R = this.toScreen(rim);
    const color = highlight ? '#2f6df6' : '#b0442f';
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 1;
    if (dashed) ctx.setLineDash([4, 4]);
    this.line(ctx, C.x, C.y, R.x, R.y);
    ctx.beginPath();
    ctx.arc(C.x, C.y, 3, 0, 2 * Math.PI);
    ctx.stroke();
    const value = dist(center, rim);
    const shown = mode === 'diameter' ? value * 2 : value;
    const text = mode === 'diameter' ? `⌀ ${formatLength(shown, this.scene.displayUnit, this.scene.displayPrecision)}` : `R ${formatLength(shown, this.scene.displayUnit, this.scene.displayPrecision)}`;
    const mx = (C.x + R.x) / 2;
    const my = (C.y + R.y) / 2;
    const dx = R.x - C.x;
    const dy = R.y - C.y;
    const len = Math.hypot(dx, dy) || 1;
    const off = offset * this.cam.scale;
    this.label(ctx, text, mx + (-dy / len) * off, my + (dx / len) * off);
    ctx.setLineDash([]);
  }

  private drawArea(
    ctx: CanvasRenderingContext2D,
    points: Anchor[],
    highlight: boolean,
    dashed = false,
  ): void {
    const pts = points.map((p) => this.toScreen(this.scene.anchorPoint(p)));
    if (pts.length < 2) return;
    const color = highlight ? '#2f6df6' : '#b0442f';
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 1;
    if (dashed) ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.closePath();
    ctx.save();
    ctx.globalAlpha = 0.12;
    ctx.fill();
    ctx.restore();
    ctx.stroke();
    let cx = 0;
    let cy = 0;
    for (const p of pts) {
      cx += p.x;
      cy += p.y;
    }
    cx /= pts.length;
    cy /= pts.length;
    const world = points.map((p) => this.scene.anchorPoint(p));
    this.label(ctx, formatArea(polygonArea(world), this.scene.displayUnit, this.scene.displayPrecision), cx, cy - 8);
    this.label(ctx, `P ${formatLength(polygonPerimeter(world), this.scene.displayUnit, this.scene.displayPrecision)}`, cx, cy + 8);
    ctx.setLineDash([]);
  }

  private drawPendingDim(ctx: CanvasRenderingContext2D, mode: Mode): void {
    if (mode.kind === 'dim') {
      const a = this.scene.anchorPoint(mode.first);
      const b = mode.hover;
      const dx = Math.abs(b.x - a.x);
      const dy = Math.abs(b.y - a.y);
      const axis: LinearAxis = this.measureMode === 'diagonal' ? 'free' : dx >= dy ? 'x' : 'y';
      this.drawLinear(ctx, a, b, axis, 60, false, true, null);
    } else if (mode.kind === 'dim-angle') {
      const a = this.scene.anchorPoint(mode.a);
      const A = this.toScreen(a);
      if (mode.b) {
        const b = this.scene.anchorPoint(mode.b);
        this.drawAngle(ctx, a, b, mode.hover, 60, false, true);
      } else {
        const H = this.toScreen(mode.hover);
        ctx.strokeStyle = '#2f6df6';
        ctx.setLineDash([4, 4]);
        this.line(ctx, A.x, A.y, H.x, H.y);
        ctx.setLineDash([]);
      }
    } else if (mode.kind === 'dim-radius') {
      this.drawRadius(ctx, this.scene.anchorPoint(mode.center), mode.hover, 40, 'radius', false, true);
    } else if (mode.kind === 'dim-area') {
      const pts: Anchor[] = [...mode.points, { kind: 'free', p: mode.hover }];
      this.drawArea(ctx, pts, false, true);
    } else if (mode.kind === 'quick') {
      const A = this.toScreen(mode.start);
      const B = this.toScreen(mode.current);
      const color = '#2f6df6';
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      this.line(ctx, A.x, A.y, B.x, B.y);
      this.endArrow(ctx, A, B, color);
      this.endArrow(ctx, B, A, color);
      ctx.setLineDash([]);
      const d = dist(mode.start, mode.current);
      const ang = Math.atan2(mode.current.y - mode.start.y, mode.current.x - mode.start.x);
      const mx = (A.x + B.x) / 2;
      const my = (A.y + B.y) / 2;
      this.label(
        ctx,
        `${formatLength(d, this.scene.displayUnit, this.scene.displayPrecision)}  ∠ ${formatAngle(Math.abs(ang), this.scene.displayPrecision)}`,
        mx,
        my - 14,
        'center',
        color,
      );
    }
  }

  private endArrow(ctx: CanvasRenderingContext2D, tip: Vec2, away: Vec2, color: string): void {
    const dx = tip.x - away.x;
    const dy = tip.y - away.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const s = 6;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(tip.x, tip.y);
    ctx.lineTo(tip.x - ux * s - uy * s * 0.5, tip.y - uy * s + ux * s * 0.5);
    ctx.lineTo(tip.x - ux * s + uy * s * 0.5, tip.y - uy * s - ux * s * 0.5);
    ctx.closePath();
    ctx.fill();
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
    color?: string,
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
    ctx.fillStyle = color ?? (dark ? '#e0d9c8' : '#8a5a33');
    ctx.fillText(text, align === 'center' ? x : x + pad, y);
  }
}
