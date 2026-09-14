import type { Anchor, Dimension, Material, Part, PartShape, Vec2 } from '../domain/types';
import { formatLength, mmToDisplay } from '../domain/format';
import type { Scene } from './scene';
import { partContains, pointSegmentDistance, snap } from './geometry';

export type Tool = 'select' | 'part' | 'dimension' | 'pan' | 'custom';

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
  | { kind: 'resize'; partId: string }
  | { kind: 'draw'; start: Vec2; current: Vec2; shape: PartShape }
  | { kind: 'dim'; first: Anchor; hover: Vec2 };

const HANDLE = 10;
const MAX_SCALE = 4;
const MIN_SCALE = 0.02;

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return { r: 247, g: 244, b: 236 };
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
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

  fit(): void {
    if (this.scene.parts.length === 0) return;
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
      this.scene.selectPart(null);
      return;
    }

    if (this.tool === 'part') {
      const p = { x: snap(w.x, this.scene.profile.gridSize), y: snap(w.y, this.scene.profile.gridSize) };
      const shape = this.partShape ?? this.scene.kind(this.partKindId)?.defaultShape ?? 'rect';
      this.mode = { kind: 'draw', start: p, current: p, shape };
      return;
    }

    if (this.tool === 'custom') {
      if (!this.customSpec) return;
      const p = { x: snap(w.x, this.scene.profile.gridSize), y: snap(w.y, this.scene.profile.gridSize) };
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
    const unit = this.scene.profile.displayUnit;
    this.opts.onStatus?.(
      `${Math.round(mmToDisplay(w.x, unit))} , ${Math.round(mmToDisplay(w.y, unit))} ${unit}`,
    );
    const grid = this.scene.profile.gridSize;

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
            position: { x: snap(w.x - this.mode.grab.x, grid), y: snap(w.y - this.mode.grab.y, grid) },
          });
        }
        break;
      }
      case 'resize': {
        const part = this.scene.partById(this.mode.partId);
        if (part) {
          const nw = Math.max(grid, snap(w.x - part.position.x, grid));
          const nh = Math.max(grid, snap(w.y - part.position.y, grid));
          this.scene.updatePart(part.id, {
            size: { x: nw, y: nh },
          });
        }
        break;
      }
      case 'draw': {
        this.mode.current = { x: snap(w.x, grid), y: snap(w.y, grid) };
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

    const wasDrag = this.mode.kind === 'move' || this.mode.kind === 'resize';

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
      this.dirty = true;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (this.scene.selectedPartId) this.scene.removePart(this.scene.selectedPartId);
      else if (this.scene.selectedDimensionId) this.scene.removeDimension(this.scene.selectedDimensionId);
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
    this.drawGrid(ctx);
    for (const part of this.scene.parts) this.drawPart(ctx, part);
    for (const dim of this.scene.dimensions) this.drawDimension(ctx, dim);
    if (this.mode.kind === 'draw') this.drawPendingPart(ctx, this.mode);
    if (this.mode.kind === 'dim') this.drawPendingDim(ctx, this.mode);
    const selected = this.scene.selectedPart();
    if (selected) this.drawHandles(ctx, selected);
  }

  private drawGrid(ctx: CanvasRenderingContext2D): void {
    const rgb = hexToRgb(this.canvasColor);
    const dark = rgb.r * 0.299 + rgb.g * 0.587 + rgb.b * 0.114 < 128;
    const minor = dark ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.09)';
    const major = dark ? 'rgba(255,255,255,0.28)' : 'rgba(0,0,0,0.22)';
    let step = this.scene.profile.gridSize;
    while (step * this.cam.scale < 7) step *= 5;
    const right = this.cam.x + this.width / this.cam.scale;
    const bottom = this.cam.y + this.height / this.cam.scale;
    const startX = Math.floor(this.cam.x / step) * step;
    const startY = Math.floor(this.cam.y / step) * step;
    const majorStep = step * 5;
    ctx.lineWidth = 1;
    for (let x = startX; x <= right; x += step) {
      const sx = Math.round((x - this.cam.x) * this.cam.scale) + 0.5;
      ctx.strokeStyle = Math.abs(x % majorStep) < step / 2 ? major : minor;
      ctx.beginPath();
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx, this.height);
      ctx.stroke();
    }
    for (let y = startY; y <= bottom; y += step) {
      const sy = Math.round((y - this.cam.y) * this.cam.scale) + 0.5;
      ctx.strokeStyle = Math.abs(y % majorStep) < step / 2 ? major : minor;
      ctx.beginPath();
      ctx.moveTo(0, sy);
      ctx.lineTo(this.width, sy);
      ctx.stroke();
    }
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
        this.label(ctx, formatLength(value, this.scene.profile.displayUnit, this.scene.profile.precision), (A.x + B.x) / 2, y - 12);
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
        this.label(ctx, formatLength(value, this.scene.profile.displayUnit, this.scene.profile.precision), x + 8, (A.y + B.y) / 2, 'left');
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
