import type { Material, Unit } from './types';
import { formatCurrency, formatLength, mmToDisplay, roundTo } from './format';
import { purchaseTotal, type BomLine, type CutLine, type StockLine } from './bom';
import type { TaskLine } from './tasks';

function csvCell(value: string | number): string {
  const s = String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function csvRow(row: (string | number)[]): string {
  return row.map(csvCell).join(',');
}

function section(title: string, header: string[], rows: (string | number)[][]): string[] {
  return [csvRow([title]), csvRow(header), ...rows.map(csvRow), ''];
}

function dimsLabel(length: number, width: number, thickness: number, unit: Unit, precision: number): string {
  return `${roundTo(mmToDisplay(length, unit), precision)} × ${roundTo(mmToDisplay(width, unit), precision)} × ${roundTo(mmToDisplay(thickness, unit), precision)} ${unit}`;
}

function stockSize(line: StockLine, unit: Unit, precision: number): string {
  const L = roundTo(mmToDisplay(line.optionLength, unit), precision);
  if (line.optionWidth != null) return `${L} × ${roundTo(mmToDisplay(line.optionWidth, unit), precision)} ${unit}`;
  return `${L} ${unit}`;
}

export interface BuildListsCsvArgs {
  materials: Material[];
  bom: BomLine[];
  cuts: CutLine[];
  stock: StockLine[];
  tasks: TaskLine[];
  unit: Unit;
  precision: number;
  title: string;
}

export function buildListsCsv(args: BuildListsCsvArgs): string {
  const { bom, cuts, stock, tasks, unit, precision, title } = args;
  const rows: string[] = [csvRow([title]), csvRow(['Export from Draw-Try']), ''];

  rows.push(...section('Materials (bill of materials)', ['Category', 'Material', 'Qty', 'Unit', 'Unit cost', 'Cost'], bom.map((l) => [l.category, l.name, roundTo(l.qty, 3), l.unitLabel, formatCurrency(l.unitCost), formatCurrency(l.cost)])));

  if (stock.length > 0) {
    rows.push(
      ...section(
        'Stock plan (what to buy)',
        ['Category', 'Material', 'Stock size', 'To buy', 'Pieces cut', 'Waste %', 'Per piece', 'Cost'],
        stock.map((l) => [l.category, l.name, stockSize(l, unit, precision), l.pieces, l.cutCount, roundTo(l.wastePct, 0), formatCurrency(l.costPerPiece), formatCurrency(l.cost)]),
      ),
    );
  }

  if (cuts.length > 0) {
    rows.push(
      ...section('Cut list', ['Category', 'Piece', 'Dimensions', 'Length', 'Qty'], cuts.map((c) => [c.category, c.name, dimsLabel(c.length, c.width, c.thickness, unit, precision), formatLength(c.length, unit, precision), c.count])),
    );
  }

  if (tasks.length > 0) {
    rows.push(...section('Tasks (to-do)', ['Done', 'Task'], tasks.map((t) => [t.checked ? 'yes' : 'no', t.text])));
  }

  rows.push(csvRow(['Total cost', formatCurrency(purchaseTotal(bom, stock))]), '');
  return rows.join('\r\n');
}

export { section, csvRow, csvCell };