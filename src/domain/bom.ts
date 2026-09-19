import type { Material, Part, StockOption } from './types';
import {
  packLinearStock,
  packSheets,
  type LinearNestLength,
  type NestItem,
  type PlacedRect,
  type SheetLayout,
} from './nesting';

export interface BomLine {
  materialId: string;
  name: string;
  category: string;
  qty: number;
  unitLabel: string;
  unitCost: number;
  cost: number;
}

export interface CutLine {
  materialId: string;
  name: string;
  category: string;
  length: number;
  width: number;
  thickness: number;
  count: number;
}

export interface StockCut {
  length: number;
  width: number;
  thickness: number;
  count: number;
  label?: string;
  color?: string;
  rotatable?: boolean;
}

export interface StockSheetLayout {
  length: number;
  width: number;
  placed: PlacedRect[];
  offcuts: PlacedRect[];
  used: number;
}

export interface StockLinearLayout {
  kerf: number;
  lengths: LinearNestLength[];
}

export interface StockLine {
  materialId: string;
  name: string;
  category: string;
  optionName: string;
  optionLength: number;
  optionWidth?: number;
  pieces: number;
  cutCount: number;
  wastePct: number;
  costPerPiece: number;
  cost: number;
  kerf?: number;
  sheets?: StockSheetLayout[];
  linear?: StockLinearLayout;
}

export function materialQuantity(m: Material, p: Part): number {
  if (m.measure === 'linear') return (p.dimensions.length / 1000) * p.quantity;
  if (m.measure === 'area') {
    return ((p.dimensions.length * p.dimensions.width) / 1_000_000) * p.quantity;
  }
  return p.quantity;
}

export function materialCategories(materials: Material[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const m of materials) {
    if (!seen.has(m.category)) {
      seen.add(m.category);
      result.push(m.category);
    }
  }
  return result;
}

function categoryIndex(materials: Material[], category: string): number {
  const idx = materials.findIndex((m) => m.category === category);
  return idx === -1 ? materials.length : idx;
}

export function computeBom(materials: Material[], parts: Part[]): BomLine[] {
  const byMaterial = new Map<string, BomLine>();
  for (const p of parts) {
    if (p.quantity <= 0) continue;
    const m = materials.find((x) => x.id === p.materialId);
    if (!m) continue;
    const line =
      byMaterial.get(m.id) ??
      ({
        materialId: m.id,
        name: m.name,
        category: m.category,
        qty: 0,
        unitLabel: m.unitLabel,
        unitCost: m.costPerUnit,
        cost: 0,
      } as BomLine);
    line.qty += materialQuantity(m, p);
    byMaterial.set(m.id, line);
  }
  return [...byMaterial.values()]
    .map((l) => ({ ...l, cost: l.qty * l.unitCost }))
    .sort((a, b) => {
      const ci = categoryIndex(materials, a.category) - categoryIndex(materials, b.category);
      return ci !== 0 ? ci : a.name.localeCompare(b.name);
    });
}

export function computeCutList(materials: Material[], parts: Part[]): CutLine[] {
  const map = new Map<string, CutLine>();
  for (const p of parts) {
    if (p.quantity <= 0) continue;
    const m = materials.find((x) => x.id === p.materialId);
    if (!m || m.role !== 'stock' || m.measure === 'count') continue;
    const key = `${p.materialId}|${p.dimensions.length}|${p.dimensions.width}|${p.dimensions.thickness}`;
    const line =
      map.get(key) ??
      ({
        materialId: p.materialId,
        name: m.name,
        category: m.category,
        length: p.dimensions.length,
        width: p.dimensions.width,
        thickness: p.dimensions.thickness,
        count: 0,
      } as CutLine);
    line.count += p.quantity;
    map.set(key, line);
  }
  return [...map.values()].sort((a, b) => {
    const ci = categoryIndex(materials, a.category) - categoryIndex(materials, b.category);
    return ci !== 0 ? ci : b.length - a.length;
  });
}

export function bomTotal(lines: BomLine[]): number {
  return lines.reduce((sum, l) => sum + l.cost, 0);
}

function stockPieceCost(m: Material, opt: StockOption): number {
  if (m.measure === 'linear') return opt.costPerPiece ?? (opt.length / 1000) * m.costPerUnit;
  if (m.measure === 'area') return opt.costPerPiece ?? ((opt.length * (opt.width ?? opt.length)) / 1_000_000) * m.costPerUnit;
  return m.costPerUnit;
}

function collectStockCuts(materials: Material[], parts: Part[]): Map<string, StockCut[]> {
  const map = new Map<string, StockCut[]>();
  for (const p of parts) {
    if (p.quantity <= 0) continue;
    const m = materials.find((x) => x.id === p.materialId);
    if (!m || m.role !== 'stock' || m.measure === 'count') continue;
    const arr = map.get(m.id) ?? [];
    arr.push({
      length: p.dimensions.length,
      width: p.dimensions.width,
      thickness: p.dimensions.thickness,
      count: p.quantity,
      label: p.label,
      color: p.color ?? m.color,
      rotatable: (p.grain ?? 'free') !== 'fixed',
    });
    map.set(m.id, arr);
  }
  return map;
}

function letters(cuts: StockCut[]): { length: number; label: string }[] {
  const out: { length: number; label: string }[] = [];
  for (const c of cuts) {
    for (let i = 0; i < c.count; i++) out.push({ length: c.length, label: c.label ?? '' });
  }
  return out;
}

function sheetItems(cuts: StockCut[]): NestItem[] {
  const out: NestItem[] = [];
  for (const c of cuts) {
    for (let i = 0; i < c.count; i++) {
      out.push({ w: c.length, h: c.width, label: c.label ?? '', color: c.color ?? '#cfcfcf', rotatable: c.rotatable ?? true });
    }
  }
  return out;
}

function kerfOf(m: Material): number {
  return Math.max(0, m.kerf ?? 0);
}

function planLine(m: Material, cuts: StockCut[], opt: StockOption): StockLine {
  const perPiece = stockPieceCost(m, opt);
  const cutCount = cuts.reduce((s, c) => s + c.count, 0);
  const kerf = kerfOf(m);
  if (m.measure === 'linear') {
    const plan = packLinearStock(letters(cuts), opt.length, kerf);
    const pieces = plan.lengths.length + plan.skipped;
    const capacity = plan.capacity > 0 ? plan.capacity : pieces * opt.length;
    return {
      materialId: m.id,
      name: m.name,
      category: m.category,
      optionName: opt.name ?? '',
      optionLength: opt.length,
      pieces,
      cutCount,
      wastePct: capacity > 0 ? (1 - plan.used / capacity) * 100 : 0,
      costPerPiece: perPiece,
      cost: pieces * perPiece,
      kerf,
      linear: { kerf, lengths: plan.lengths },
    };
  }
  const plan = packSheets(sheetItems(cuts), opt.length, opt.width ?? opt.length, kerf);
  const pieces = plan.sheets.length;
  const capacity = plan.capacity > 0 ? plan.capacity : pieces * opt.length * (opt.width ?? opt.length);
  const sheets: StockSheetLayout[] = plan.sheets.map((s: SheetLayout) => ({
    length: s.length,
    width: s.width,
    placed: s.placed,
    offcuts: s.offcuts,
    used: s.used,
  }));
  return {
    materialId: m.id,
    name: m.name,
    category: m.category,
    optionName: opt.name ?? '',
    optionLength: opt.length,
    optionWidth: opt.width,
    pieces,
    cutCount,
    wastePct: capacity > 0 ? Math.max(0, 1 - plan.used / capacity) * 100 : 0,
    costPerPiece: perPiece,
    cost: pieces * perPiece,
    kerf,
    sheets,
  };
}

export function computeStockPlan(materials: Material[], parts: Part[]): StockLine[] {
  const allCuts = collectStockCuts(materials, parts);
  const out: StockLine[] = [];
  for (const m of materials) {
    const cuts = allCuts.get(m.id);
    if (!cuts || cuts.length === 0 || !m.stock || m.stock.length === 0) continue;
    const candidates = m.stock.map((opt) => planLine(m, cuts, opt));
    candidates.sort((a, b) => a.cost - b.cost || a.pieces - b.pieces || a.optionName.localeCompare(b.optionName));
    out.push(candidates[0]);
  }
  return out.sort((a, b) => {
    const ci = categoryIndex(materials, a.category) - categoryIndex(materials, b.category);
    return ci !== 0 ? ci : a.name.localeCompare(b.name);
  });
}

export function purchaseTotal(bomLines: BomLine[], stockLines: StockLine[]): number {
  const stockIds = new Set(stockLines.map((l) => l.materialId));
  const rest = bomLines.filter((l) => !stockIds.has(l.materialId)).reduce((s, l) => s + l.cost, 0);
  return rest + stockLines.reduce((s, l) => s + l.cost, 0);
}
