import { approxTextWidth, buildPdfDoc, pdfEscape, winEncode, type PdfPage } from './pdf';
import { roundTo, mmToDisplay } from '../domain/format';
import type { Unit } from '../domain/types';
import type { StockLine } from '../domain/bom';

export const A4_W = 595.28;
export const A4_H = 841.89;
export const MARGIN = 40;
export const USABLE = A4_W - MARGIN * 2;
export const INK = '0.14 0.12 0.09';
export const MUTED = '0.45 0.42 0.38';
export const RULE = '0.78 0.76 0.72';
export const BAND = '0.93 0.92 0.90';

export const fmt = (n: number): string => (Math.round(n * 1000) / 1000).toString();

export interface Frag {
  t: string;
  sm?: boolean;
  b?: boolean;
}

export interface Col {
  header: string;
  width: number;
  align?: 'left' | 'right' | 'center';
}

export interface Row {
  kind: 'data' | 'cat' | 'total';
  cells: Frag[][];
}

export function fragW(f: Frag): number {
  return approxTextWidth(f.t, f.sm ? 7.5 : 9);
}

function hexRgb(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec((hex || '').trim());
  if (!m) return '0.55 0.53 0.5';
  const n = parseInt(m[1], 16);
  return `${(((n >> 16) & 255) / 255).toFixed(3)} ${(((n >> 8) & 255) / 255).toFixed(3)} ${((n & 255) / 255).toFixed(3)}`;
}

function lengthLabel(mm: number, unit: Unit, precision: number): string {
  return `${roundTo(mmToDisplay(mm, unit), precision)} ${unit}`;
}

function fragsWidth(frags: Frag[]): number {
  return frags.reduce((s, f) => s + fragW(f), 0);
}

function wrapCell(cell: Frag[], maxW: number): Frag[][] {
  const out: Frag[][] = [];
  let cur: Frag[] = [];
  let curW = 0;
  for (const f of cell) {
    for (const w of f.t.split(' ')) {
      const wf: Frag = { t: w, sm: f.sm, b: f.b };
      if (wf.t === '') continue;
      const ww = fragW(wf) + 3.5;
      if (cur.length && curW + ww > maxW) {
        out.push(cur);
        cur = [];
        curW = 0;
      }
      cur.push(wf);
      curW += ww;
    }
  }
  if (cur.length) out.push(cur);
  if (out.length === 0) out.push([]);
  return out;
}

function rowHeight(row: Row, cols: Col[]): number {
  if (row.kind !== 'data') return 18;
  let max = 1;
  for (let i = 0; i < cols.length; i++) {
    const lines = wrapCell(row.cells[i] ?? [], cols[i].width);
    if (lines.length > max) max = lines.length;
  }
  return max * 11.5 + 4;
}

function wrapText(s: string, size: number, maxW: number): string[] {
  const words = s.split(' ');
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const cand = cur ? `${cur} ${w}` : w;
    if (cur && approxTextWidth(cand, size) > maxW) {
      lines.push(cur);
      cur = w;
    } else {
      cur = cand;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

export class Flow {
  private pages: PdfPage[] = [];
  private ops: string[] = [];
  private y = 0;
  constructor(private label: string) {
    this.newPage();
  }

  private newPage(): void {
    if (this.ops.length) this.pages[this.pages.length - 1].ops = this.ops.join('\n');
    this.ops = [];
    this.y = 0;
    this.pages.push({ width: A4_W, height: A4_H, ops: '', footer: null });
  }

  private available(): number {
    return A4_H - MARGIN * 2 - this.y;
  }

  private ensure(h: number): void {
    if (this.available() < h) this.newPage();
  }

  private baseline(yTop: number, size: number): number {
    return A4_H - MARGIN - yTop - size;
  }

  private push(op: string): void {
    this.ops.push(op);
  }

  private textAt(x: number, yTop: number, size: number, bold: boolean, s: string, color = INK, align: 'left' | 'right' | 'center' = 'left'): void {
    const font = bold ? 'F2' : 'F1';
    const w = approxTextWidth(s, size);
    let xx = x;
    if (align === 'right') xx = x - w;
    else if (align === 'center') xx = x - w / 2;
    this.push(`BT\n${color} rg\n/${font} ${fmt(size)} Tf\n${fmt(xx)} ${fmt(this.baseline(yTop, size))} Td (${pdfEscape(winEncode(s))}) Tj\nET`);
  }

  private rule(x1: number, yTop: number, x2: number, color = RULE, w = 0.6): void {
    const yy = A4_H - MARGIN - yTop;
    this.push(`q\n${color} RG\n${fmt(w)} w\n${fmt(x1)} ${fmt(yy)} m\n${fmt(x2)} ${fmt(yy)} l\nS\nQ`);
  }

  private rect(x: number, yTop: number, w: number, h: number, color: string): void {
    this.push(`q\n${color} rg\n${fmt(x)} ${fmt(A4_H - MARGIN - yTop - h)} ${fmt(w)} ${fmt(h)} re\nf\nQ`);
  }

  private rectStroke(x: number, yTop: number, w: number, h: number, color = '0.6 0.58 0.54', lw = 0.7): void {
    this.push(`q\n${color} RG\n${fmt(lw)} w\n${fmt(x)} ${fmt(A4_H - MARGIN - yTop - h)} ${fmt(w)} ${fmt(h)} re\nS\nQ`);
  }

  private advance(dh: number): void {
    this.y += dh;
  }

  figSheets(line: StockLine, unit: Unit, precision: number): void {
    if (!line.sheets || line.sheets.length === 0) return;
    const columns = 3;
    const boxW = 150;
    const boxH = 104;
    const gap = 14;
    const rowW = columns * boxW + (columns - 1) * gap;
    const x0 = MARGIN + (USABLE - rowW) / 2;
    const pad = 6;
    let remaining = line.sheets;
    let shown = 0;

    while (remaining.length) {
      const rowSheets = remaining.slice(0, columns);
      remaining = remaining.slice(columns);
      this.ensure(boxH + 26);
      const rowTop = this.y;
      rowSheets.forEach((s, idx) => {
        const scale = Math.min((boxW - pad * 2) / s.length, (boxH - pad * 2) / s.width);
        const dw = s.length * scale;
        const dh = s.width * scale;
        const ox = x0 + idx * (boxW + gap) + (boxW - dw) / 2;
        const oy = rowTop + (boxH - dh) / 2;
        this.rect(ox, rowTop, boxW, boxH, '1 1 1');
        this.rectStroke(ox, oy, dw, dh, '0.4 0.38 0.34', 0.8);
        for (const o of s.offcuts) {
          this.rectStroke(ox + o.x * scale, oy + (s.width - o.y - o.h) * scale, Math.max(0.5, o.w * scale), Math.max(0.5, o.h * scale), '0.75 0.72 0.68', 0.5);
        }
        for (const p of s.placed) {
          this.rect(ox + p.x * scale, oy + (s.width - p.y - p.h) * scale, Math.max(0.5, p.w * scale), Math.max(0.5, p.h * scale), hexRgb(p.color));
        }
        shown += 1;
      });
      const waste = line.wastePct;
      const firstSheet = rowSheets[0];
      const kerfPart = (line.kerf ?? 0) > 0 ? ` \u00b7 kerf ${roundTo(mmToDisplay(line.kerf!, unit), precision)} ${unit}` : '';
      const caption = `Sheets ${shown - rowSheets.length + 1}\u2013${shown} of ${line.pieces} \u00b7 ${lengthLabel(firstSheet.length, unit, precision)} x ${lengthLabel(firstSheet.width, unit, precision)} \u00b7 ${Math.round(waste)}% waste${kerfPart}`;
      this.textAt(MARGIN, rowTop + boxH + 3, 7.5, false, caption, MUTED, 'left');
      this.advance(boxH + 16);
    }
    if (this.available()) this.advance(6);
  }

  figLinear(line: StockLine, unit: Unit, precision: number): void {
    if (!line.linear || line.linear.lengths.length === 0) return;
    const barH = 16;
    const rowGap = 9;
    const pal = ['0.62 0.42 0.62', '0.45 0.58 0.78', '0.42 0.68 0.55', '0.82 0.62 0.42', '0.78 0.48 0.44'];
    const bars = line.linear.lengths.slice(0, 8);
    this.ensure(bars.length * (barH + rowGap) + 24);
    const barW = USABLE - 54;
    const x1 = MARGIN + 52;
    const labelCol = 48;
    bars.forEach((b, i) => {
      const yTop = this.y;
      const stockLab = lengthLabel(b.stockLength, unit, precision);
      this.textAt(MARGIN, yTop + 4, 6.5, false, `L${i + 1}`, MUTED);
      this.rect(MARGIN + labelCol, yTop + 1, barW + 4, barH - 2, '0.97 0.96 0.94');
      this.rectStroke(MARGIN + labelCol, yTop + 1, barW + 4, barH - 2, '0.6 0.58 0.54', 0.6);
      const scale = barW / b.stockLength;
      b.cuts.forEach((c, j) => {
        this.rect(x1 + c.from * scale, yTop + 3, Math.max(1, c.length * scale), barH - 6, pal[j % pal.length]);
      });
      const rightLab = `${Math.round((b.used / b.stockLength) * 100)}% used \u00b7 ${Math.round((b.waste / b.stockLength) * 100)}% waste of ${stockLab}`;
      this.textAt(A4_W - MARGIN, yTop + 13, 6.5, false, rightLab, MUTED, 'right');
      this.advance(barH + rowGap);
    });
    if (line.linear.lengths.length > bars.length) {
      this.textAt(MARGIN, this.y, 7, false, `+${line.linear.lengths.length - bars.length} more lengths`, MUTED);
      this.advance(10);
    }
    this.advance(4);
  }

  title(s: string): void {
    this.ensure(70);
    this.textAt(MARGIN, 2, 17, true, s);
    this.advance(24);
    this.textAt(MARGIN, this.y, 9.5, false, 'Generated by Draw-Try - project lists and cutting plan.', MUTED);
    this.advance(12);
  }

  section(s: string): void {
    this.ensure(34);
    this.advance(8);
    this.textAt(MARGIN, this.y, 13, true, s);
    this.advance(16);
    this.rule(MARGIN, this.y, MARGIN + USABLE);
    this.advance(4);
  }

  paragraph(s: string, muted = false): void {
    const lines = wrapText(s, 9, USABLE);
    this.ensure(lines.length * 12 + 4);
    for (const line of lines) {
      this.textAt(MARGIN, this.y, 9, false, line, muted ? MUTED : INK);
      this.advance(12);
    }
    this.advance(4);
  }

  table(cols: Col[], rows: Row[], total?: Row): void {
    const drawHeader = (): void => {
      let x = MARGIN;
      for (const c of cols) {
        this.textAt(x, this.y, 8.5, true, c.header, MUTED, c.align ?? 'left');
        x += c.width;
      }
      this.advance(3);
      this.rule(MARGIN, this.y, MARGIN + USABLE, '0.62 0.60 0.55', 0.9);
      this.advance(13);
    };

    this.ensure(24);
    drawHeader();

    for (const row of rows) {
      const h = rowHeight(row, cols);
      if (this.available() < h) {
        this.newPage();
        drawHeader();
      }
      if (row.kind === 'cat') {
        this.rect(MARGIN, this.y, USABLE, 18, BAND);
        this.textAt(MARGIN + 4, this.y + 3, 10, true, row.cells[0]?.[0]?.t ?? '', '0.14 0.12 0.09');
      } else if (row.kind === 'total') {
        this.rule(MARGIN, this.y, MARGIN + USABLE, INK, 1.1);
        this.advance(5);
        this.dataRow(row, cols);
      } else {
        this.dataRow(row, cols);
      }
      this.advance(Math.max(0, h));
    }

    if (total) {
      const h = 20;
      if (this.available() < h) this.newPage();
      this.rule(MARGIN, this.y, MARGIN + USABLE, INK, 1.1);
      this.advance(5);
      this.dataRow(total, cols);
      this.advance(2);
    }
  }

  private dataRow(row: Row, cols: Col[]): void {
    let x = MARGIN;
    for (let ci = 0; ci < cols.length; ci++) {
      const c = cols[ci];
      const lines = wrapCell(row.cells[ci] ?? [], c.width);
      let cy = this.y;
      for (const line of lines) {
        const lineW = fragsWidth(line);
        let cursor = c.align === 'right' ? x + c.width - lineW : c.align === 'center' ? x + (c.width - lineW) / 2 : x;
        for (const f of line) {
          this.textAt(cursor, cy, f.sm ? 7.5 : 9, f.b ?? false, f.t, INK);
          cursor += fragW(f);
        }
        const lh = line.some((f) => f.sm) ? 9 : 11.5;
        cy += lh;
      }
      x += c.width;
    }
  }

  finalize(): PdfPage[] {
    if (this.ops.length) this.pages[this.pages.length - 1].ops = this.ops.join('\n');
    return this.pages;
  }

  finish(): Uint8Array {
    const pages = this.finalize();
    const n = pages.length;
    for (let i = 0; i < n; i++) pages[i].footer = `${this.label} - page ${i + 1} of ${n}`;
    return buildPdfDoc(pages);
  }
}