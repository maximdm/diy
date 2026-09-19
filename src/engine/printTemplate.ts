import type { Part, Unit } from '../domain/types';
import { formatLength, mmToDisplay, roundTo } from '../domain/format';
import { approxTextWidth, buildPdfDoc, pdfEscape, winEncode, type PdfPage } from './pdf';

const MM = 72 / 25.4;
const PAGE_W = 595.28;
const PAGE_H = 841.89;

const MARGIN_LEFT = 14;
const MARGIN_RIGHT = 24;
const TITLE_TOP = 26;
const SCALE_BOTTOM = 36;

const fmt = (n: number): string => (Math.round(n * 1000) / 1000).toString();

export interface PrintTemplateOptions {
  unit: Unit;
  precision: number;
  materialName: (partId: string) => string | undefined;
}

export interface PrintTemplateResult {
  bytes: Uint8Array;
  pageCount: number;
  tooBig: Part[];
}

interface Pt {
  x: number;
  y: number;
}

export function buildPrintTemplatePdf(parts: Part[], opts: PrintTemplateOptions): PrintTemplateResult {
  const { unit, precision } = opts;
  const pages: PdfPage[] = [];
  const tooBig: Part[] = [];
  const materialName = (p: Part): string => opts.materialName(p.id) ?? '';

  for (const part of parts) {
    if (part.quantity <= 0) continue;
    const L = part.dimensions.length;
    const W0 = part.dimensions.width;
    const shape = part.shape ?? 'rect';
    const W = W0 > 0 ? W0 : shape === 'circle' ? L : shape === 'line' ? part.dimensions.thickness || 4 : L;
    const landscape = L > W;

    const pageW = landscape ? PAGE_H : PAGE_W;
    const pageH = landscape ? PAGE_W : PAGE_H;

    const usableW = pageW - (MARGIN_LEFT + MARGIN_RIGHT) * MM;
    const drawTop = pageH - TITLE_TOP * MM;
    const drawBottom = SCALE_BOTTOM * MM;
    const usableH = drawTop - drawBottom;

    if (L > usableW || W > usableH) {
      tooBig.push(part);
      continue;
    }

    const ox = MARGIN_LEFT * MM + (usableW - L * MM) / 2;
    const shapeBottom = drawBottom + (usableH - W * MM) / 2;
    const ptx = (x: number): number => ox + x * MM;
    const pty = (y: number): number => shapeBottom + (W - y) * MM;

    const ops: string[] = [];
    const line2 = (x1: number, y1: number, x2: number, y2: number, sw: number, dash = false): void => {
      ops.push(`q`);
      if (dash) ops.push('[4 3] 0 d');
      ops.push(`0.5 w`);
      ops.push(`${fmt(x1)} ${fmt(y1)} m`);
      ops.push(`${fmt(x2)} ${fmt(y2)} l`);
      ops.push(`${fmt(sw)} w`);
      ops.push('S');
      ops.push(`Q`);
    };
    const poly = (pts: Pt[], sw: number, closed: boolean, dash = false): void => {
      ops.push('q');
      if (dash) ops.push('[4 3] 0 d');
      ops.push(`${fmt(sw)} w`);
      pts.forEach((p, i) => ops.push(i === 0 ? `${fmt(p.x)} ${fmt(p.y)} m` : `${fmt(p.x)} ${fmt(p.y)} l`));
      if (closed) ops.push('h');
      ops.push('S');
      ops.push('Q');
    };
    const ellipse = (cx: number, cy: number, rx: number, ry: number, sw: number, dash = false): void => {
      const k = 0.5523;
      ops.push('q');
      if (dash) ops.push('[4 3] 0 d');
      ops.push(`${fmt(sw)} w`);
      ops.push(`${fmt(cx + rx)} ${fmt(cy)} m`);
      ops.push(`${fmt(cx + rx)} ${fmt(cy + k * ry)} ${fmt(cx + k * rx)} ${fmt(cy + ry)} ${fmt(cx)} ${fmt(cy + ry)} c`);
      ops.push(`${fmt(cx - k * rx)} ${fmt(cy + ry)} ${fmt(cx - rx)} ${fmt(cy + k * ry)} ${fmt(cx - rx)} ${fmt(cy)} c`);
      ops.push(`${fmt(cx - rx)} ${fmt(cy - k * ry)} ${fmt(cx - k * rx)} ${fmt(cy - ry)} ${fmt(cx)} ${fmt(cy - ry)} c`);
      ops.push(`${fmt(cx + k * rx)} ${fmt(cy - ry)} ${fmt(cx + rx)} ${fmt(cy - k * ry)} ${fmt(cx + rx)} ${fmt(cy)} c`);
      ops.push('S');
      ops.push('Q');
    };
    const text = (x: number, y: number, size: number, s: string, bold = false, align: 'left' | 'center' | 'right' = 'left', angle = 0): void => {
      const font = bold ? 'F2' : 'F1';
      const w = approxTextWidth(s, size);
      let xx = x;
      if (align === 'center') xx = x - w / 2;
      else if (align === 'right') xx = x - w;
      const tm = angle === 90 ? `0 1 -1 0 ${fmt(xx)} ${fmt(y)}` : `1 0 0 1 ${fmt(xx)} ${fmt(y)}`;
      ops.push(`BT`);
      ops.push(`/${font} ${fmt(size)} Tf`);
      ops.push(`${tm} Tm`);
      ops.push(`(${pdfEscape(winEncode(s))}) Tj`);
      ops.push(`ET`);
    };
    const arrowLine = (x1: number, y1: number, x2: number, y2: number, tick: number, sw: number): void => {
      line2(x1, y1, x2, y2, sw);
      const dx = x2 - x1;
      const dy = y2 - y1;
      const d = Math.hypot(dx, dy) || 1;
      const nx = (-dy / d) * tick;
      const ny = (dx / d) * tick;
      line2(x1 - nx, y1 - ny, x1 + nx, y1 + ny, sw);
      line2(x2 - nx, y2 - ny, x2 + nx, y2 + ny, sw);
    };

    const dimsTxt = `${roundTo(mmToDisplay(L, unit), precision)} x ${roundTo(mmToDisplay(W, unit), precision)} x ${roundTo(mmToDisplay(part.dimensions.thickness, unit), precision)} ${unit}`;

    text(pageW / 2, pageH - 12, 13, `${part.label}${part.quantity > 1 ? ` x${part.quantity}` : ''}`, true, 'center');
    text(
      pageW / 2,
      pageH - 20,
      9,
      `${dimsTxt} - ${materialName(part)} - 1:1 template`,
      false,
      'center',
      0,
    );

    if (shape === 'rect') {
      poly(
        [
          { x: ptx(0), y: pty(0) },
          { x: ptx(L), y: pty(0) },
          { x: ptx(L), y: pty(W) },
          { x: ptx(0), y: pty(W) },
        ],
        0.9,
        true,
      );
    } else if (shape === 'circle') {
      ellipse((ptx(0) + ptx(L)) / 2, (pty(0) + pty(W)) / 2, (L * MM) / 2, (W * MM) / 2, 0.9);
    } else if (shape === 'triangle') {
      poly(
        [
          { x: ptx(L / 2), y: pty(0) },
          { x: ptx(0), y: pty(W) },
          { x: ptx(L), y: pty(W) },
        ],
        0.9,
        true,
      );
    } else {
      const s = Math.max(0.8, (W >= 1 ? W : part.dimensions.thickness || 4) * MM);
      line2(ptx(0), pty(W / 2), ptx(L), pty(W / 2), s);
      poly(
        [
          { x: ptx(0), y: pty(W / 2 - (s / MM) / 2) },
          { x: ptx(0), y: pty(W / 2 + (s / MM) / 2) },
          { x: ptx(L), y: pty(W / 2 + (s / MM) / 2) },
          { x: ptx(L), y: pty(W / 2 - (s / MM) / 2) },
        ],
        0.4,
        true,
        true,
      );
    }

    const dimL = formatLength(L, unit, precision);
    const dimW = formatLength(W, unit, precision);

    arrowLine(ptx(0), pty(W + 8), ptx(L), pty(W + 8), 1.4, 0.4);
    text((ptx(0) + ptx(L)) / 2, pty(W + 11.5), 8, dimL, false, 'center');

    arrowLine(ptx(L + 8), pty(W), ptx(L + 8), pty(0), 1.4, 0.4);
    text(ptx(L + 9.5), (pty(0) + pty(W)) / 2, 8, dimW, false, 'left', 90);

    const barY = 16;
    const barW = 100 * MM;
    const barX = (pageW - barW) / 2;
    line2(barX, barY, barX + barW, barY, 0.7);
    for (let i = 0; i <= 10; i++) {
      const x = barX + i * 10 * MM;
      const major = i % 5 === 0;
      line2(x, barY - (major ? 2 : 1.2), x, barY + (major ? 2 : 1.2), 0.5);
      if (major) text(x, barY - 5, 7, String(i * 10), false, 'center');
    }
    text(pageW / 2, barY - 12, 7.5, `100 mm scale bar - print this page at 100% (no scaling)`, false, 'center');

    pages.push({ width: pageW, height: pageH, ops: ops.join('\n'), footer: null });
  }

  return { bytes: buildPdfDoc(pages), pageCount: pages.length, tooBig };
}