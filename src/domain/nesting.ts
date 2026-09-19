export interface NestItem {
  w: number;
  h: number;
  label: string;
  color: string;
  rotatable: boolean;
}

export interface PlacedRect {
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  color: string;
  rotated: boolean;
}

export interface SheetLayout {
  length: number;
  width: number;
  placed: PlacedRect[];
  offcuts: PlacedRect[];
  used: number;
}

export interface SheetNestPlan {
  sheets: SheetLayout[];
  skipped: number;
  used: number;
  capacity: number;
}

interface FreeRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function pruneContained(frees: FreeRect[]): FreeRect[] {
  const out: FreeRect[] = [];
  for (const a of frees) {
    if (a.w <= 0 || a.h <= 0) continue;
    let contained = false;
    for (const b of frees) {
      if (a === b) continue;
      if (b.x <= a.x && b.y <= a.y && b.x + b.w >= a.x + a.w && b.y + b.h >= a.y + a.h) {
        contained = true;
        break;
      }
    }
    if (!contained) out.push(a);
  }
  return out;
}

function splitFree(rect: FreeRect, r: FreeRect): FreeRect[] {
  const pieces: FreeRect[] = [];
  const left = { x: rect.x, y: rect.y, w: r.x - rect.x, h: rect.h };
  const right = { x: r.x + r.w, y: rect.y, w: rect.x + rect.w - (r.x + r.w), h: rect.h };
  const bottom = { x: Math.max(rect.x, r.x), y: rect.y, w: Math.min(rect.x + rect.w, r.x + r.w) - Math.max(rect.x, r.x), h: r.y - rect.y };
  const top = { x: Math.max(rect.x, r.x), y: r.y + r.h, w: Math.min(rect.x + rect.w, r.x + r.w) - Math.max(rect.x, r.x), h: rect.y + rect.h - (r.y + r.h) };
  for (const p of [left, right, bottom, top]) {
    if (p.w > 0 && p.h > 0) pieces.push(p);
  }
  return pieces;
}

function placeItem(frees: FreeRect[], effW: number, effH: number, rotatable: boolean): { x: number; y: number; w: number; h: number; rotated: boolean } | null {
  let best: { x: number; y: number; w: number; h: number; rotated: boolean; key: number } | null = null;
  for (const fr of frees) {
    const cands = [
      { w: effW, h: effH, rotated: false },
      { w: effH, h: effW, rotated: true },
    ];
    for (const c of cands) {
      if (c.rotated && !rotatable) continue;
      if (fr.w < c.w || fr.h < c.h) continue;
      const key = fr.y * 1_000_000 + fr.x;
      if (!best || key < best.key) best = { x: fr.x, y: fr.y, w: c.w, h: c.h, rotated: c.rotated, key };
    }
  }
  if (!best) return null;
  return { x: best.x, y: best.y, w: best.w, h: best.h, rotated: best.rotated };
}

export function packSheets(items: NestItem[], sheetLength: number, sheetWidth: number, kerfIn = 0): SheetNestPlan {
  const kerf = Math.max(0, kerfIn);
  const ordered = [...items].sort((a, b) => {
    const aa = a.w * a.h;
    const bb = b.w * b.h;
    if (bb !== aa) return bb - aa;
    const am = Math.max(a.w, a.h);
    const bm = Math.max(b.w, b.h);
    return bm - am;
  });

  const sheets: SheetLayout[] = [];
  let skipped = 0;
  let used = 0;
  let freeRects: FreeRect[] = [{ x: 0, y: 0, w: sheetLength, h: sheetWidth }];
  let placed: PlacedRect[] = [];
  let sheetUsed = 0;

  const flush = (): void => {
    const offcuts = pruneContained(freeRects)
      .filter((f) => f.w * f.h >= 2500)
      .map((f) => ({ x: f.x, y: f.y, w: f.w, h: f.h, label: 'offcut', color: '#ffffff', rotated: false }));
    sheets.push({ length: sheetLength, width: sheetWidth, placed, offcuts, used: sheetUsed });
    placed = [];
    sheetUsed = 0;
    freeRects = [{ x: 0, y: 0, w: sheetLength, h: sheetWidth }];
  };

  for (const it of ordered) {
    let res = placeItem(freeRects, it.w + kerf, it.h + kerf, it.rotatable);
    if (!res) {
      if (placed.length > 0 || sheetUsed > 0) {
        flush();
        res = placeItem(freeRects, it.w + kerf, it.h + kerf, it.rotatable);
      }
    }
    if (!res) {
      skipped += 1;
      continue;
    }
    const rect = { x: res.x, y: res.y, w: res.w, h: res.h };
    const next: FreeRect[] = [];
    for (const fr of freeRects) {
      if (fr.x >= rect.x + rect.w || fr.x + fr.w <= rect.x || fr.y >= rect.y + rect.h || fr.y + fr.h <= rect.y) {
        next.push(fr);
      } else {
        next.push(...splitFree(fr, rect));
      }
    }
    freeRects = pruneContained(next);
    placed.push({ x: res.x, y: res.y, w: it.w, h: it.h, label: it.label, color: it.color, rotated: res.rotated });
    sheetUsed += it.w * it.h;
    used += it.w * it.h;
  }
  if (placed.length > 0 || sheetUsed > 0) flush();

  const capacity = (sheets.length + skipped) * sheetLength * sheetWidth;
  if (skipped > 0) {
    for (let i = 0; i < skipped; i++) sheets.push({ length: sheetLength, width: sheetWidth, placed: [], offcuts: [], used: 0 });
  }
  return { sheets, skipped, used, capacity };
}

export interface LinearCutPlaced {
  label: string;
  length: number;
  from: number;
  to: number;
}

export interface LinearNestLength {
  stockLength: number;
  cuts: LinearCutPlaced[];
  used: number;
  waste: number;
}

export interface LinearNestPlan {
  lengths: LinearNestLength[];
  used: number;
  capacity: number;
  skipped: number;
}

export function packLinearStock(items: { length: number; label: string }[], stockLength: number, kerfIn = 0): LinearNestPlan {
  const kerf = Math.max(0, kerfIn);
  const ordered = [...items].sort((a, b) => b.length - a.length);
  const bins: { remaining: number; used: number; cuts: LinearCutPlaced[] }[] = [];
  let skipped = 0;
  let used = 0;

  for (const it of ordered) {
    const eff = it.length + kerf;
    if (eff > stockLength) {
      skipped += 1;
      continue;
    }
    let bin = bins.find((b) => b.remaining >= eff);
    if (!bin) {
      bin = { remaining: stockLength, used: 0, cuts: [] };
      bins.push(bin);
    }
    const from = stockLength - bin.remaining;
    bin.cuts.push({ label: it.label, length: it.length, from, to: from + it.length });
    bin.remaining -= eff;
    bin.used += it.length;
    used += it.length;
  }

  const lengths = bins.map((b) => ({
    stockLength,
    cuts: b.cuts,
    used: b.used,
    waste: b.remaining,
  }));
  const capacity = (lengths.length + skipped) * stockLength;
  return { lengths, used, capacity, skipped };
}

export interface StockRectBin {
  length: number;
  width: number;
}

export interface MultiSheetNestPlan {
  sheets: SheetLayout[];
  skipped: number;
  used: number;
  capacity: number;
}

export function packIntoBins(items: NestItem[], bins: StockRectBin[], kerfIn = 0): MultiSheetNestPlan {
  const kerf = Math.max(0, kerfIn);
  const ordered = [...items].sort((a, b) => {
    const aa = a.w * a.h;
    const bb = b.w * b.h;
    if (bb !== aa) return bb - aa;
    return Math.max(b.w, b.h) - Math.max(a.w, a.h);
  });
  const sortedBins = bins
    .filter((b) => b.length > 0 && b.width > 0)
    .sort((a, b) => b.length * b.width - a.length * a.width);

  let remaining = ordered;
  const sheets: SheetLayout[] = [];
  let used = 0;

  for (const bin of sortedBins) {
    if (remaining.length === 0) break;
    let freeRects: FreeRect[] = [{ x: 0, y: 0, w: bin.length, h: bin.width }];
    const placed: PlacedRect[] = [];
    let sheetUsed = 0;
    const next: NestItem[] = [];
    for (const it of remaining) {
      const res = placeItem(freeRects, it.w + kerf, it.h + kerf, it.rotatable);
      if (!res) {
        next.push(it);
        continue;
      }
      const rect = { x: res.x, y: res.y, w: res.w, h: res.h };
      const split: FreeRect[] = [];
      for (const fr of freeRects) {
        if (fr.x >= rect.x + rect.w || fr.x + fr.w <= rect.x || fr.y >= rect.y + rect.h || fr.y + fr.h <= rect.y) {
          split.push(fr);
        } else {
          split.push(...splitFree(fr, rect));
        }
      }
      freeRects = pruneContained(split);
      placed.push({ x: res.x, y: res.y, w: it.w, h: it.h, label: it.label, color: it.color, rotated: res.rotated });
      sheetUsed += it.w * it.h;
      used += it.w * it.h;
    }
    remaining = next;
    const offcuts = pruneContained(freeRects)
      .filter((f) => f.w * f.h >= 2500)
      .map((f) => ({ x: f.x, y: f.y, w: f.w, h: f.h, label: 'offcut', color: '#ffffff', rotated: false }));
    sheets.push({ length: bin.length, width: bin.width, placed, offcuts, used: sheetUsed });
  }

  const skipped = remaining.length;
  const capacity = sortedBins.reduce((s, b) => s + b.length * b.width, 0);
  return { sheets, skipped, used, capacity };
}

export interface LinearBin {
  length: number;
  width: number;
  thickness: number;
}

export interface LinearFitItem {
  length: number;
  width: number;
  thickness: number;
  label: string;
}

export function packLinearIntoBins(items: LinearFitItem[], bins: LinearBin[], kerfIn = 0): LinearNestPlan {
  const kerf = Math.max(0, kerfIn);
  const ordered = [...items].sort((a, b) => b.length - a.length);
  const sortedBins = bins
    .filter((b) => b.length > 0)
    .sort((a, b) => b.length - a.length);

  let remaining = ordered;
  const lengths: LinearNestLength[] = [];
  let used = 0;
  let skipped = 0;

  for (const bin of sortedBins) {
    if (remaining.length === 0) break;
    let avail = bin.length;
    const cuts: LinearCutPlaced[] = [];
    let binUsed = 0;
    const next: LinearFitItem[] = [];
    for (const it of remaining) {
      if (bin.width > 0 && bin.width < it.width) {
        next.push(it);
        continue;
      }
      if (bin.thickness > 0 && bin.thickness < it.thickness) {
        next.push(it);
        continue;
      }
      const eff = it.length + kerf;
      if (avail < eff) {
        next.push(it);
        continue;
      }
      const from = bin.length - avail;
      cuts.push({ label: it.label, length: it.length, from, to: from + it.length });
      avail -= eff;
      binUsed += it.length;
      used += it.length;
    }
    remaining = next;
    lengths.push({ stockLength: bin.length, cuts, used: binUsed, waste: avail });
  }

  skipped = remaining.length;
  const capacity = sortedBins.reduce((s, b) => s + b.length, 0);
  return { lengths, used, capacity, skipped };
}