import type { Material, Part } from './types';

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
