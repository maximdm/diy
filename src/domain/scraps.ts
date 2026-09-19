import type { Material, ScrapItem, Template } from './types';
import { packIntoBins, packLinearIntoBins } from './nesting';
import type { StockLine } from './bom';

export interface TemplateFit {
  templateId: string;
  name: string;
  buildable: boolean;
  fraction: number;
  fittingPieces: number;
  totalPieces: number;
  missing: string[];
  satisfiedMaterials: number;
  totalMaterials: number;
  scrapsUsed: number;
}

function kerfOf(m: Material): number {
  return Math.max(0, m.kerf ?? 0);
}

export function fitTemplate(materials: Material[], scrapList: ScrapItem[], tpl: Template): TemplateFit {
  const scraps = scrapList.filter((s) => s.quantity > 0);
  let fittingPieces = 0;
  let totalPieces = 0;
  let satisfiedMaterials = 0;
  let totalMaterials = 0;
  let scrapsUsed = 0;
  const missing: string[] = [];

  for (const m of materials) {
    if (m.role !== 'stock' || m.measure === 'count') continue;
    const parts = tpl.parts.filter((p) => p.materialId === m.id && p.quantity > 0);
    if (parts.length === 0) continue;
    totalMaterials++;
    const pieces = parts.reduce((sum, p) => sum + p.quantity, 0);
    totalPieces += pieces;
    const matScraps = scraps.filter((s) => s.materialId === m.id);
    if (matScraps.length === 0) {
      missing.push(m.name);
      continue;
    }
    const kerf = kerfOf(m);
    let placed: number;
    if (m.measure === 'linear') {
      const bins = matScraps.flatMap((s) => Array.from({ length: s.quantity }, () => ({ length: s.length, width: s.width, thickness: s.thickness })));
      const items = parts.flatMap((p) =>
        Array.from({ length: p.quantity }, () => ({ length: p.dimensions.length, width: p.dimensions.width, thickness: p.dimensions.thickness, label: p.label })),
      );
      const plan = packLinearIntoBins(items, bins, kerf);
      placed = items.length - plan.skipped;
      scrapsUsed += plan.lengths.filter((n) => n.cuts.length > 0).length;
    } else {
      const bins = matScraps.flatMap((s) => Array.from({ length: s.quantity }, () => ({ length: s.length, width: s.width })));
      const items = parts.flatMap((p) =>
        Array.from({ length: p.quantity }, () => ({ w: p.dimensions.length, h: p.dimensions.width, label: p.label, color: m.color, rotatable: (p.grain ?? 'free') !== 'fixed' })),
      );
      const plan = packIntoBins(items, bins, kerf);
      placed = items.length - plan.skipped;
      scrapsUsed += plan.sheets.filter((s) => s.placed.length > 0).length;
    }
    fittingPieces += placed;
    if (placed === pieces) satisfiedMaterials += 1;
    else missing.push(m.name);
  }

  return {
    templateId: tpl.id,
    name: tpl.name,
    buildable: totalMaterials > 0 && satisfiedMaterials === totalMaterials,
    fraction: totalPieces > 0 ? fittingPieces / totalPieces : 0,
    fittingPieces,
    totalPieces,
    missing,
    satisfiedMaterials,
    totalMaterials,
    scrapsUsed,
  };
}

export function fitTemplates(materials: Material[], scraps: ScrapItem[], templates: Template[]): TemplateFit[] {
  return templates
    .map((t) => fitTemplate(materials, scraps, t))
    .filter((f) => f.totalPieces > 0)
    .sort((a, b) => {
      if (a.buildable !== b.buildable) return a.buildable ? -1 : 1;
      if (b.fraction !== a.fraction) return b.fraction - a.fraction;
      return a.name.localeCompare(b.name);
    });
}

export function offcutsFromStockLine(line: StockLine): ScrapItem[] {
  const out: ScrapItem[] = [];
  const base = { materialId: line.materialId, quantity: 1, source: 'offcut' as const };
  const note = `Offcut from ${line.optionName}`;
  for (const sheet of line.sheets ?? []) {
    for (const o of sheet.offcuts) {
      if (o.w <= 0 || o.h <= 0) continue;
      out.push({ id: `${line.materialId}-o${out.length}`, ...base, length: o.w, width: o.h, thickness: 0, note });
    }
  }
  for (const n of line.linear?.lengths ?? []) {
    const waste = Math.round(n.waste);
    if (waste <= 0) continue;
    out.push({ id: `${line.materialId}-o${out.length}`, ...base, length: waste, width: 0, thickness: 0, note });
  }
  return out;
}