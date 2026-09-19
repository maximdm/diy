import type { Material, Unit } from '../domain/types';
import { formatCurrency, formatQty, mmToDisplay, roundTo } from '../domain/format';
import { materialCategories, purchaseTotal, type BomLine, type CutLine, type StockLine } from '../domain/bom';
import type { TaskLine } from '../domain/tasks';
import { Flow, type Col, type Frag, type Row } from './pdfFlow';

export interface BuildListsPdfArgs {
  materials: Material[];
  bom: BomLine[];
  cuts: CutLine[];
  stock: StockLine[];
  tasks: TaskLine[];
  unit: Unit;
  precision: number;
  title: string;
}

function dimsLabel(length: number, width: number, thickness: number, unit: Unit, precision: number): string {
  return `${roundTo(mmToDisplay(length, unit), precision)} x ${roundTo(mmToDisplay(width, unit), precision)} x ${roundTo(mmToDisplay(thickness, unit), precision)} ${unit}`;
}

function stockSize(l: StockLine, unit: Unit, precision: number): string {
  const L = roundTo(mmToDisplay(l.optionLength, unit), precision);
  if (l.optionWidth != null) return `${L} x ${roundTo(mmToDisplay(l.optionWidth, unit), precision)} ${unit}`;
  return `${L} ${unit}`;
}

export function buildListsPdf(args: BuildListsPdfArgs): Uint8Array {
  const { materials, bom, cuts, stock, tasks, unit, precision, title } = args;
  const flow = new Flow(title);
  flow.title(title);

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
            [{ t: formatLengthLabel(c.length, unit, precision) }],
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
      const cells: Frag[][] = hasSteps ? [[{ t: t.step != null ? String(t.step) : '' }], done, task] : [done, task];
      return { kind: 'data', cells };
    });
    flow.table(cols, rows);
  }

  return flow.finish();
}

function formatLengthLabel(mm: number, unit: Unit, precision: number): string {
  return `${roundTo(mmToDisplay(mm, unit), precision)} ${unit}`;
}