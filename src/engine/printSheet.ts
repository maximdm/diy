import type { Dimension, LinearAxis, Material, Note, Part, PartShape, Unit, Vec2 } from '../domain/types';
import { formatAngle, formatArea, formatCurrency, formatLength, formatQty, mmToDisplay, roundTo } from '../domain/format';
import {
  materialCategories,
  purchaseTotal,
  type BomLine,
  type CutLine,
  type StockLine,
} from '../domain/bom';
import type { TaskLine } from '../domain/tasks';
import { angleBetween, dist, partCenter, polygonArea, polygonPerimeter, rotatedPoint, worldAABB } from './geometry';
import { approxTextWidth, buildPdfDoc, pdfEscape, winEncode, type PdfPage } from './pdf';
import { A4_H, A4_W, Flow, MUTED, USABLE, type Col, type Row } from './pdfFlow';
import type { Scene } from './scene';

const MARGIN = 40;
const FRAME_TOP = A4_H - 64;
const FRAME_H = 300;
const INK = '0.14 0.12 0.09';
const DIM = '0.69 0.27 0.18';
const PART_STROKE = '0.24 0.2 0.14';
const GRID_MINOR = '0.82 0.81 0.79';
const GRID_MAJOR = '0.68 0.67 0.65';

const NOTE_W_MM = 150;
const NOTE_PAD = 5;
const NOTE_TITLE = 7;
const NOTE_LINE = 8.5;
const NOTE_BOX = 5;
const NOTE_GAP = 4;

const fmt = (n: number): string => (Math.round(n * 1000) / 1000).toString();

interface Pt {
  x: number;
  y: number;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return { r: 247, g: 244, b: 236 };
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function rgbOp(hex: string): string {
  const { r, g, b } = hexToRgb(hex);
  return `${(r / 255).toFixed(3)} ${(g / 255).toFixed(3)} ${(b / 255).toFixed(3)}`;
}

function trim(s: string, maxW: number, size: number): string {
  return approxTextWidth(s, size) <= maxW ? s : `${s}…`;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

class Sheet {
  private ops: string[] = [];
  constructor(
    private scale: number,
    private ox: number,
    private oy: number,
  ) {}

  scaleFactor(): number {
    return this.scale;
  }

  toPt(w: Vec2): Pt {
    return { x: this.ox + w.x * this.scale, y: this.oy - w.y * this.scale };
  }

  line(a: Vec2, b: Vec2, color = INK, w = 0.4, dash = false): void {
    const A = this.toPt(a);
    const B = this.toPt(b);
    this.ops.push('q');
    if (dash) this.ops.push('[3 2] 0 d');
    this.ops.push(`${color} RG`);
    this.ops.push(`${fmt(w)} w`);
    this.ops.push(`${fmt(A.x)} ${fmt(A.y)} m`);
    this.ops.push(`${fmt(B.x)} ${fmt(B.y)} l`);
    this.ops.push('S');
    this.ops.push('Q');
  }

  polyPath(points: Vec2[], fill?: string, stroke?: string, w = 0.4, closed = true): void {
    if (points.length < 2) return;
    this.ops.push('q');
    if (fill) this.ops.push(`${fill} rg`);
    if (stroke) this.ops.push(`${stroke} RG`);
    if (stroke) this.ops.push(`${fmt(w)} w`);
    points.forEach((p, i) => {
      const P = this.toPt(p);
      this.ops.push(i === 0 ? `${fmt(P.x)} ${fmt(P.y)} m` : `${fmt(P.x)} ${fmt(P.y)} l`);
    });
    if (closed) this.ops.push('h');
    if (fill) this.ops.push('f');
    if (stroke) this.ops.push('S');
    this.ops.push('Q');
  }

  rectAt(w: Vec2, ww: number, hh: number, fill?: string, stroke?: string, sw = 0.4): void {
    const P = this.toPt(w);
    this.ops.push('q');
    if (fill) this.ops.push(`${fill} rg`);
    if (stroke) this.ops.push(`${stroke} RG`);
    if (stroke) this.ops.push(`${fmt(sw)} w`);
    this.ops.push(`${fmt(P.x)} ${fmt(P.y - hh * this.scale)} ${fmt(ww * this.scale)} ${fmt(hh * this.scale)} re`);
    if (fill) this.ops.push('f');
    if (stroke) this.ops.push('S');
    this.ops.push('Q');
  }

  ellipse(cx: number, cy: number, rx: number, ry: number, rot: number, fill?: string, stroke?: string, w = 0.4): void {
    const steps = 48;
    const cos = Math.cos(rot);
    const sin = Math.sin(rot);
    this.ops.push('q');
    if (fill) this.ops.push(`${fill} rg`);
    if (stroke) this.ops.push(`${stroke} RG`);
    if (stroke) this.ops.push(`${fmt(w)} w`);
    for (let i = 0; i <= steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      const lx = Math.cos(a) * rx;
      const ly = Math.sin(a) * ry;
      const P = this.toPt({ x: cx + lx * cos - ly * sin, y: cy + lx * sin + ly * cos });
      this.ops.push(i === 0 ? `${fmt(P.x)} ${fmt(P.y)} m` : `${fmt(P.x)} ${fmt(P.y)} l`);
    }
    if (fill) this.ops.push('f');
    if (stroke) this.ops.push('S');
    this.ops.push('Q');
  }

  arc(c: Vec2, r: number, ang1: number, ang2: number, color = DIM, w = 0.4): void {
    const C = this.toPt(c);
    const sweep = (ang2 - ang1) % (Math.PI * 2);
    const steps = Math.max(8, Math.min(64, Math.ceil((Math.abs(sweep) / (Math.PI / 2)) * 12)));
    this.ops.push('q');
    this.ops.push(`${color} RG`);
    this.ops.push(`${fmt(w)} w`);
    for (let i = 0; i <= steps; i++) {
      const a = ang1 + (sweep * i) / steps;
      const x = C.x + Math.cos(a) * r;
      const y = C.y + Math.sin(a) * r;
      this.ops.push(i === 0 ? `${fmt(x)} ${fmt(y)} m` : `${fmt(x)} ${fmt(y)} l`);
    }
    this.ops.push('S');
    this.ops.push('Q');
  }

  arrowHead(tip: Pt, from: Pt, fill: string): void {
    const dx = tip.x - from.x;
    const dy = tip.y - from.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const s = 1.8;
    this.filledPoly(
      [
        tip,
        { x: tip.x - ux * s - uy * s * 0.5, y: tip.y - uy * s + ux * s * 0.5 },
        { x: tip.x - ux * s + uy * s * 0.5, y: tip.y - uy * s - ux * s * 0.5 },
      ],
      fill,
    );
  }

  arrow(a: Vec2, b: Vec2, color = DIM, w = 0.4): void {
    this.line(a, b, color, w);
    this.arrowHead(this.toPt(b), this.toPt(a), color);
  }

  filledPoly(points: Pt[], fill: string): void {
    if (points.length < 3) return;
    this.ops.push('q');
    this.ops.push(`${fill} rg`);
    points.forEach((p, i) => this.ops.push(i === 0 ? `${fmt(p.x)} ${fmt(p.y)} m` : `${fmt(p.x)} ${fmt(p.y)} l`));
    this.ops.push('h');
    this.ops.push('f');
    this.ops.push('Q');
  }

  text(x: number, y: number, size: number, s: string, opts: { bold?: boolean; align?: 'left' | 'center' | 'right'; color?: string } = {}): void {
    const font = opts.bold ? 'F2' : 'F1';
    const color = opts.color ?? INK;
    const align = opts.align ?? 'left';
    const w = approxTextWidth(s, size);
    let xx = x;
    if (align === 'center') xx = x - w / 2;
    else if (align === 'right') xx = x - w;
    this.ops.push('BT');
    this.ops.push(`${color} rg`);
    this.ops.push(`/${font} ${fmt(size)} Tf`);
    this.ops.push(`${fmt(xx)} ${fmt(y)} Td`);
    this.ops.push(`(${pdfEscape(winEncode(s))}) Tj`);
    this.ops.push('ET');
  }

  textWorld(w: Vec2, size: number, s: string, opts: { bold?: boolean; align?: 'left' | 'center' | 'right'; color?: string } = {}): void {
    const P = this.toPt(w);
    this.text(P.x, P.y, size, s, opts);
  }

  bag(x: number, y: number, size: number, s: string, opts: { bold?: boolean; align?: 'left' | 'center' | 'right'; color?: string } = {}): void {
    const w = approxTextWidth(s, size);
    const pad = 1.6;
    const align = opts.align ?? 'center';
    const left = align === 'center' ? x - w / 2 - pad : align === 'right' ? x - w - pad : x - pad;
    this.ops.push('q');
    this.ops.push('1 1 1 rg');
    this.ops.push(`${fmt(left)} ${fmt(y - size - 1)} ${fmt(w + pad * 2)} ${fmt(size + 2)} re`);
    this.ops.push('f');
    this.ops.push('Q');
    this.text(x, y, size, s, opts);
  }

  bagWorld(w: Vec2, size: number, s: string, opts: { bold?: boolean; align?: 'left' | 'center' | 'right'; color?: string } = {}): void {
    const P = this.toPt(w);
    this.bag(P.x, P.y, size, s, opts);
  }

  page(): PdfPage {
    return { width: A4_W, height: A4_H, ops: this.ops.join('\n'), footer: null };
  }
}

export interface PrintSheetArgs {
  materials: Material[];
  bom: BomLine[];
  cuts: CutLine[];
  stock: StockLine[];
  tasks: TaskLine[];
  unit: Unit;
  precision: number;
  title: string;
  profileName: string;
}

function dimsLabel(length: number, width: number, thickness: number, unit: Unit, precision: number): string {
  return `${roundTo(mmToDisplay(length, unit), precision)} x ${roundTo(mmToDisplay(width, unit), precision)} x ${roundTo(mmToDisplay(thickness, unit), precision)} ${unit}`;
}

function stockSize(l: StockLine, unit: Unit, precision: number): string {
  const L = roundTo(mmToDisplay(l.optionLength, unit), precision);
  if (l.optionWidth != null) return `${L} x ${roundTo(mmToDisplay(l.optionWidth, unit), precision)} ${unit}`;
  return `${L} ${unit}`;
}

function lengthLabel(mm: number, unit: Unit, precision: number): string {
  return `${roundTo(mmToDisplay(mm, unit), precision)} ${unit}`;
}

function dimLabel(value: number, target: number | null, unit: Unit, precision: number): string {
  const base = formatLength(value, unit, precision);
  if (target == null) return base;
  const diff = value - target;
  const sign = diff >= 0 ? '+' : '\u2212';
  return `${base}  (${sign}${formatLength(Math.abs(diff), unit, precision)})`;
}

function sketchPage(scene: Scene, args: PrintSheetArgs): PdfPage {
  const { unit, precision, title, profileName } = args;
  const parts = scene.renderOrderParts();
  const dims = scene.dimensions.filter((d) => scene.isDimensionVisible(d));
  const notes = scene.notes.filter((n) => scene.isNoteVisible(n) && scene.noteAnchorWorld(n) != null);

  const page = new Sheet(1, 0, 0);
  page.text(MARGIN, A4_H - 42, 17, title, { bold: true });
  page.text(MARGIN + 1, A4_H - 57, 9.5, `${profileName} - generated by Draw-Try`, { color: MUTED });

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const noteBoxes: { anchor: Vec2; w: number; h: number }[] = [];
  for (const p of parts) {
    const a = worldAABB(p);
    minX = Math.min(minX, a.minX);
    minY = Math.min(minY, a.minY);
    maxX = Math.max(maxX, a.maxX);
    maxY = Math.max(maxY, a.maxY);
  }
  for (const n of notes) {
    const anchor = scene.noteAnchorWorld(n);
    if (!anchor) continue;
    const h = NOTE_PAD * 2 + NOTE_TITLE + Math.max(n.items.length, 1) * NOTE_LINE;
    noteBoxes.push({ anchor, w: NOTE_W_MM, h });
    minX = Math.min(minX, anchor.x);
    minY = Math.min(minY, anchor.y);
    maxX = Math.max(maxX, anchor.x + NOTE_W_MM);
    maxY = Math.max(maxY, anchor.y + h);
  }

  const frameBotY = FRAME_TOP - FRAME_H;

  if (parts.length === 0 && noteBoxes.length === 0) {
    page.rectAt({ x: MARGIN, y: FRAME_TOP }, USABLE, FRAME_H, undefined, '0.62 0.6 0.55', 0.7);
    page.text(A4_W / 2, frameBotY + FRAME_H / 2, 11, 'Empty board - draw parts or add notes first.', {
      align: 'center',
      color: MUTED,
    });
    return page.page();
  }

  const pad = unit === 'in' ? 14 : 50;
  minX -= pad;
  minY -= pad;
  maxX += pad;
  maxY += pad;
  const bw = Math.max(1, maxX - minX);
  const bh = Math.max(1, maxY - minY);
  const scale = Math.min(2, Math.min(USABLE / bw, FRAME_H / bh));
  const ox = MARGIN + (USABLE - bw * scale) / 2 - minX * scale;
  const oy = frameBotY + (FRAME_H - bh * scale) / 2 + maxY * scale;

  const s = new Sheet(scale, ox, oy);

  const grid = scene.profile.gridSize;
  if (grid * scale >= 2.2) {
    const majorStep = grid * 5;
    for (let x = Math.floor(minX / grid) * grid; x <= maxX + grid; x += grid) {
      const color = Math.abs(x % majorStep) < grid / 2 ? GRID_MAJOR : GRID_MINOR;
      s.line({ x, y: minY }, { x, y: maxY }, color, 0.25);
    }
    for (let y = Math.floor(minY / grid) * grid; y <= maxY + grid; y += grid) {
      const color = Math.abs(y % majorStep) < grid / 2 ? GRID_MAJOR : GRID_MINOR;
      s.line({ x: minX, y }, { x: maxX, y }, color, 0.25);
    }
  }

  for (const p of parts) drawPart(s, scene, p);
  for (const d of dims) drawDimension(s, scene, d, unit, precision);
  for (const n of notes) drawNote(s, scene, n, unit, precision);

  page.rectAt({ x: MARGIN, y: FRAME_TOP }, USABLE, FRAME_H, undefined, '0.62 0.6 0.55', 0.7);
  page.text(MARGIN, frameBotY - 12, 7.5, 'Board sketch - grid in mm; parts, dimensions and notes below.', {
    color: '0.45 0.42 0.38',
  });

  const ops = [...page.page().ops.split('\n'), ...s.page().ops.split('\n')];
  return { width: A4_W, height: A4_H, ops: ops.join('\n'), footer: null };
}

function drawPart(sheet: Sheet, scene: Scene, part: Part): void {
  const mat = scene.material(part.materialId);
  const fill = rgbOp(part.color ?? mat?.color ?? '#cfcfcf');
  const shape: PartShape = part.shape ?? 'rect';
  const w = part.size.x;
  const h = part.size.y;
  const angle = part.rotation ?? 0;
  const c = partCenter(part);

  if (shape === 'line') {
    const a = rotatedPoint(part, { x: 0, y: h / 2 });
    const b = rotatedPoint(part, { x: w, y: h / 2 });
    const thickness = Math.max(0.3, h * sheet.scaleFactor());
    sheet.line(a, b, fill, thickness);
    sheet.line(a, b, PART_STROKE, Math.min(0.35, thickness / 2));
    return;
  }

  if (shape === 'circle') {
    sheet.ellipse(c.x, c.y, (w / 2) * sheet.scaleFactor(), (h / 2) * sheet.scaleFactor(), angle, fill, PART_STROKE, 0.4);
  } else if (shape === 'triangle') {
    const a = rotatedPoint(part, { x: w / 2, y: 0 });
    const b = rotatedPoint(part, { x: 0, y: h });
    const bb = rotatedPoint(part, { x: w, y: h });
    sheet.polyPath([a, b, bb], fill, PART_STROKE, 0.4);
  } else {
    sheet.polyPath(
      [
        rotatedPoint(part, { x: 0, y: 0 }),
        rotatedPoint(part, { x: w, y: 0 }),
        rotatedPoint(part, { x: w, y: h }),
        rotatedPoint(part, { x: 0, y: h }),
      ],
      fill,
      PART_STROKE,
      0.4,
    );
  }

  if (w * sheet.scaleFactor() > 22 && h * sheet.scaleFactor() > 8) {
    const label = part.quantity > 1 ? `${part.label} x${part.quantity}` : part.label;
    sheet.textWorld(c, 5.2, trim(label, w * sheet.scaleFactor(), 5.2), { align: 'center', color: '0.2 0.15 0.1' });
  }
}

function drawDimension(sheet: Sheet, scene: Scene, dim: Dimension, unit: Unit, precision: number): void {
  if (dim.kind === 'angle') {
    const a = scene.anchorPoint(dim.a);
    const b = scene.anchorPoint(dim.b!);
    const c = scene.anchorPoint(dim.c!);
    const arcR = Math.max(6, dim.offset * sheet.scaleFactor());
    sheet.line(a, b, DIM);
    sheet.line(a, c, DIM);
    const ang1 = Math.atan2(b.y - a.y, b.x - a.x);
    const ang2 = Math.atan2(c.y - a.y, c.x - a.x);
    sheet.arc(a, arcR, ang1, ang2, DIM);
    const mid = (ang1 + ang2) / 2;
    const lo = (arcR + 10) / sheet.scaleFactor();
    const lx = a.x + Math.cos(mid) * lo;
    const ly = a.y + Math.sin(mid) * lo;
    sheet.bagWorld({ x: lx, y: ly }, 6.5, formatAngle(angleBetween(a, b, c), precision));
    return;
  }

  if (dim.kind === 'radius') {
    const center = scene.anchorPoint(dim.a);
    const rim = scene.anchorPoint(dim.b);
    const value = dist(center, rim);
    const shown = dim.radiusMode === 'diameter' ? value * 2 : value;
    const label = dim.radiusMode === 'diameter' ? `\u00d8 ${formatLength(shown, unit, precision)}` : `R ${formatLength(shown, unit, precision)}`;
    sheet.line(center, rim, DIM);
    const rp = (1.5 / sheet.scaleFactor()) as number;
    sheet.ellipse(center.x, center.y, rp, rp, 0, undefined, DIM, 0.3);
    const mx = (center.x + rim.x) / 2;
    const my = (center.y + rim.y) / 2;
    const dx = rim.x - center.x;
    const dy = rim.y - center.y;
    const len = Math.hypot(dx, dy) || 1;
    sheet.bagWorld({ x: mx + (-dy / len) * dim.offset, y: my + (dx / len) * dim.offset }, 6.5, label);
    return;
  }

  if (dim.kind === 'area' && dim.points && dim.points.length >= 3) {
    const world = dim.points.map((p) => scene.anchorPoint(p));
    sheet.polyPath(world, undefined, DIM, 0.35);
    const cx = world.reduce((s, p) => s + p.x, 0) / world.length;
    const cy = world.reduce((s, p) => s + p.y, 0) / world.length;
    const lo = 9 / sheet.scaleFactor();
    sheet.bagWorld({ x: cx, y: cy + lo }, 6.5, formatArea(polygonArea(world), unit, precision));
    sheet.bagWorld({ x: cx, y: cy - lo }, 6.5, `P ${formatLength(polygonPerimeter(world), unit, precision)}`);
    return;
  }

  drawLinearDim(sheet, scene, dim, unit, precision);
}

function drawLinearDim(sheet: Sheet, scene: Scene, dim: Dimension, unit: Unit, precision: number): void {
  const a = scene.anchorPoint(dim.a);
  const b = scene.anchorPoint(dim.b);
  const axis: LinearAxis = dim.axis ?? 'x';
  const off = dim.offset;
  const value = axis === 'free' ? dist(a, b) : axis === 'x' ? Math.abs(b.x - a.x) : Math.abs(b.y - a.y);
  const label = dimLabel(value, dim.target ?? null, unit, precision);
  const size = 6.5;
  const lo = 12 / sheet.scaleFactor();
  const lox = 9 / sheet.scaleFactor();

  if (axis === 'free') {
    sheet.arrow(a, b, DIM);
    sheet.bagWorld({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, size, trim(label, 90, size));
    return;
  }

  if (axis === 'x') {
    const y = Math.max(a.y, b.y) + off;
    sheet.line({ x: a.x, y: a.y }, { x: a.x, y }, DIM);
    sheet.line({ x: b.x, y: b.y }, { x: b.x, y }, DIM);
    sheet.line({ x: a.x, y }, { x: b.x, y }, DIM);
    const tA = sheet.toPt({ x: a.x, y });
    const tB = sheet.toPt({ x: b.x, y });
    const s2 = Math.min(1.6, Math.abs(tB.x - tA.x) / 4);
    sheet.filledPoly([{ x: tA.x, y: tA.y - s2 }, { x: tA.x, y: tA.y + s2 }, { x: tA.x - 2.4, y: tA.y }], DIM);
    sheet.filledPoly([{ x: tB.x, y: tB.y - s2 }, { x: tB.x, y: tB.y + s2 }, { x: tB.x + 2.4, y: tB.y }], DIM);
    sheet.bagWorld({ x: (a.x + b.x) / 2, y: y + lo }, size, trim(label, 90, size));
    return;
  }

  const x = Math.max(a.x, b.x) + off;
  sheet.line({ x: a.x, y: a.y }, { x, y: a.y }, DIM);
  sheet.line({ x: b.x, y: b.y }, { x, y: b.y }, DIM);
  sheet.line({ x, y: a.y }, { x, y: b.y }, DIM);
  const tA = sheet.toPt({ x, y: a.y });
  const tB = sheet.toPt({ x, y: b.y });
  const s2 = Math.min(1.6, Math.abs(tB.y - tA.y) / 4);
  sheet.filledPoly([{ x: tA.x - s2, y: tA.y }, { x: tA.x + s2, y: tA.y }, { x: tA.x, y: tA.y - 2.4 }], DIM);
  sheet.filledPoly([{ x: tB.x - s2, y: tB.y }, { x: tB.x + s2, y: tB.y }, { x: tB.x, y: tB.y + 2.4 }], DIM);
  sheet.bagWorld({ x: x + lox, y: (a.y + b.y) / 2 }, size, trim(label, 90, size), { align: 'left' });
}

function noteHeight(note: Note): number {
  return NOTE_PAD * 2 + NOTE_TITLE + Math.max(note.items.length, 1) * NOTE_LINE;
}

function defaultNoteTitle(scene: Scene, note: Note, unit: Unit, precision: number): string {
  if (note.context.kind === 'part') {
    const p = scene.partById(note.context.partId ?? '');
    return p ? (p.quantity > 1 ? `${p.label} x${p.quantity}` : p.label) : 'Part note';
  }
  if (note.context.kind === 'measure') {
    const d = scene.dimensions.find((dm) => dm.id === note.context.dimensionId);
    if (!d) return 'Measure note';
    const a = scene.anchorPoint(d.a);
    const b = scene.anchorPoint(d.b);
    return formatLength(dist(a, b), unit, precision);
  }
  return 'Note';
}

function nearestEdge(origin: Vec2, w: number, h: number, target: Vec2): Vec2 {
  const cands: Vec2[] = [
    { x: clamp(target.x, origin.x, origin.x + w), y: origin.y },
    { x: clamp(target.x, origin.x, origin.x + w), y: origin.y - h },
    { x: origin.x, y: clamp(target.y, origin.y - h, origin.y) },
    { x: origin.x + w, y: clamp(target.y, origin.y - h, origin.y) },
  ];
  let best = cands[0];
  let bd = dist(target, best);
  for (const c of cands) {
    const d = dist(target, c);
    if (d < bd) {
      bd = d;
      best = c;
    }
  }
  return best;
}

function drawNote(sheet: Sheet, scene: Scene, note: Note, unit: Unit, precision: number): void {
  const anchor = scene.noteAnchorWorld(note);
  if (!anchor) return;
  const ctxKind = note.context.kind;

  if (ctxKind === 'part' || ctxKind === 'measure') {
    const target =
      ctxKind === 'part'
        ? scene.partById(note.context.partId ?? '')?.position ?? anchor
        : (() => {
            const d = scene.dimensions.find((dm) => dm.id === note.context.dimensionId);
            if (!d) return anchor;
            const a = scene.anchorPoint(d.a);
            const b = scene.anchorPoint(d.b);
            return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
          })();
    const start = nearestEdge(anchor, NOTE_W_MM, noteHeight(note), target);
    sheet.line(start, target, '0.54 0.51 0.45', 0.3);
  }

  const bh = noteHeight(note);
  sheet.rectAt(anchor, NOTE_W_MM, bh, '1 0.992 0.973', '0.73 0.66 0.54', 0.35);

  const title = note.title.trim() || defaultNoteTitle(scene, note, unit, precision);
  sheet.textWorld({ x: anchor.x + NOTE_PAD, y: anchor.y - NOTE_PAD - 1.2 }, 6.6, trim(title, (NOTE_W_MM - NOTE_PAD * 2) * sheet.scaleFactor(), 6.6), {
    bold: true,
    color: '0.42 0.36 0.27',
  });

  for (let i = 0; i < note.items.length; i++) {
    const it = note.items[i];
    const iy = anchor.y - NOTE_PAD - NOTE_TITLE - i * NOTE_LINE;
    const boxX = anchor.x + NOTE_PAD;
    const boxC = { x: boxX + NOTE_BOX / 2, y: iy - 1.5 + NOTE_BOX / 2 };
    if (it.checked) {
      sheet.rectAt({ x: boxX, y: iy - 1.5 }, NOTE_BOX, NOTE_BOX, '0.18 0.43 0.96');
      sheet.polyPath(
        [
          { x: boxC.x - 1.3, y: boxC.y + 0.3 },
          { x: boxC.x - 0.2, y: boxC.y - 0.7 },
          { x: boxC.x + 1.5, y: boxC.y + 1 },
        ],
        undefined,
        '1 1 1',
        0.5,
        false,
      );
    } else {
      sheet.rectAt({ x: boxX, y: iy - 1.5 }, NOTE_BOX, NOTE_BOX, '1 1 1', '0.7 0.68 0.63', 0.3);
    }
    const x0 = boxX + NOTE_BOX + NOTE_GAP;
    const avail = (NOTE_W_MM - x0 - NOTE_PAD) * sheet.scaleFactor();
    const text = it.text;
    if (text) {
      sheet.textWorld({ x: x0, y: iy }, 6, trim(text, avail, 6), { color: it.checked ? '0.5 0.47 0.42' : INK });
    }
  }
}

export function buildPrintSheetPdf(scene: Scene, args: PrintSheetArgs): Uint8Array {
  const { materials, bom, cuts, stock, tasks, unit, precision, title } = args;
  const pages: PdfPage[] = [sketchPage(scene, args)];

  const flow = new Flow(title);
  flow.title(`${title} - lists continue from the sketch`);

  flow.section('Bill of materials');
  if (bom.length === 0) {
    flow.paragraph('No parts on the board yet - add parts to build these lists.');
  } else {
    const rows: Row[] = [];
    for (const cat of materialCategories(materials)) {
      const group = bom.filter((l) => l.category === cat);
      if (group.length === 0) continue;
      rows.push({ kind: 'cat', cells: [[{ t: cat, b: true }], [], [], []] });
      for (const l of group) {
        rows.push({
          kind: 'data',
          cells: [
            [{ t: l.name }],
            [{ t: formatQty(l.qty, l.unitLabel) }],
            [{ t: formatCurrency(l.unitCost) }],
            [{ t: formatCurrency(l.cost), b: true }],
          ],
        });
      }
    }
    flow.table(
      [
        { header: 'Material', width: 255, align: 'left' },
        { header: 'Qty', width: 80, align: 'right' },
        { header: 'Unit cost', width: 90, align: 'right' },
        { header: 'Cost', width: 90, align: 'right' },
      ],
      rows,
      { kind: 'total', cells: [[{ t: 'Total', b: true }], [], [], [{ t: formatCurrency(purchaseTotal(bom, stock)), b: true }]] },
    );
  }

  flow.section('Stock plan (what to buy)');
  if (stock.length === 0) {
    flow.paragraph('No stock sizes set on materials - add standard stock sizes to see what to buy.', true);
  } else {
    const rows: Row[] = [];
    for (const cat of materialCategories(materials)) {
      const group = stock.filter((l) => l.category === cat);
      if (group.length === 0) continue;
      rows.push({ kind: 'cat', cells: [[{ t: cat, b: true }], [], [], []] });
      for (const l of group) {
        rows.push({
          kind: 'data',
          cells: [
            [{ t: l.name }, { t: stockSize(l, unit, precision), sm: true }],
            [{ t: String(l.pieces) }],
            [{ t: `${roundTo(l.wastePct, 0)}%` }],
            [{ t: formatCurrency(l.cost), b: true }],
          ],
        });
      }
    }
    flow.table(
      [
        { header: 'Buy', width: 235, align: 'left' },
        { header: 'Pieces', width: 95, align: 'right' },
        { header: 'Waste', width: 90, align: 'right' },
        { header: 'Cost', width: 95, align: 'right' },
      ],
      rows,
    );
    for (const l of stock) {
      if (l.sheets) flow.figSheets(l, unit, precision);
      if (l.linear) flow.figLinear(l, unit, precision);
    }
  }

  flow.section('Cut list');
  if (cuts.length === 0) {
    flow.paragraph('Timber and panel cuts appear here.', true);
  } else {
    const rows: Row[] = [];
    for (const cat of materialCategories(materials)) {
      const group = cuts.filter((c) => c.category === cat);
      if (group.length === 0) continue;
      rows.push({ kind: 'cat', cells: [[{ t: cat, b: true }], [], []] });
      for (const c of group) {
        rows.push({
          kind: 'data',
          cells: [
            [{ t: c.name }, { t: dimsLabel(c.length, c.width, c.thickness, unit, precision), sm: true }],
            [{ t: lengthLabel(c.length, unit, precision) }],
            [{ t: String(c.count), b: true }],
          ],
        });
      }
    }
    flow.table(
      [
        { header: 'Piece', width: 260, align: 'left' },
        { header: 'Length', width: 130, align: 'right' },
        { header: 'Qty', width: 125, align: 'right' },
      ],
      rows,
    );
  }

  flow.section('Tasks (to-do)');
  if (tasks.length === 0) {
    flow.paragraph('No notes with checklist items yet - add a note and tick items off as you go.', true);
  } else {
    const hasSteps = tasks.some((t) => t.step != null);
    const cols: Col[] = hasSteps
      ? [
          { header: 'Step', width: 40, align: 'right' },
          { header: 'Done', width: 55, align: 'center' },
          { header: 'Task', width: 420, align: 'left' },
        ]
      : [
          { header: 'Done', width: 60, align: 'center' },
          { header: 'Task', width: 455, align: 'left' },
        ];
    const rows: Row[] = tasks.map((t) => {
      const done = [{ t: t.checked ? '[x]' : '[ ]' }];
      const task = [{ t: t.text }];
      const cells = hasSteps ? [[{ t: t.step != null ? String(t.step) : '' }], done, task] : [done, task];
      return { kind: 'data', cells };
    });
    flow.table(cols, rows);
  }

  pages.push(...flow.finalize());

  const n = pages.length;
  for (let i = 0; i < n; i++) pages[i].footer = `Draw-Try - ${title} - page ${i + 1} of ${n}`;
  return buildPdfDoc(pages);
}