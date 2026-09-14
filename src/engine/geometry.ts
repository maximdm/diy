import type { Part, PartShape, Vec2 } from '../domain/types';

export interface AnchorCandidate {
  x: number;
  y: number;
  u: number;
  v: number;
}

export function partShape(p: Part): PartShape {
  return p.shape ?? 'rect';
}

export function anchorCandidates(part: Part): AnchorCandidate[] {
  const x = part.position.x;
  const y = part.position.y;
  const w = part.size.x;
  const h = part.size.y;
  const out: AnchorCandidate[] = [];
  const shape = partShape(part);
  if (shape === 'circle') {
    for (const [u, v] of [
      [0.5, 0],
      [1, 0.5],
      [0.5, 1],
      [0, 0.5],
    ] as const) {
      out.push({ x: x + u * w, y: y + v * h, u, v });
    }
    return out;
  }
  if (shape === 'triangle') {
    for (const [u, v] of [
      [0.5, 0],
      [0, 1],
      [1, 1],
    ] as const) {
      out.push({ x: x + u * w, y: y + v * h, u, v });
    }
    return out;
  }
  if (shape === 'line') {
    for (const [u, v] of [
      [0, 0.5],
      [1, 0.5],
    ] as const) {
      out.push({ x: x + u * w, y: y + v * h, u, v });
    }
    return out;
  }
  for (const u of [0, 0.5, 1]) {
    for (const v of [0, 0.5, 1]) {
      if (u === 0.5 && v === 0.5) continue;
      out.push({ x: x + u * w, y: y + v * h, u, v });
    }
  }
  return out;
}

export function partContains(p: Vec2, part: Part): boolean {
  const l = part.position.x;
  const t = part.position.y;
  const r = l + part.size.x;
  const b = t + part.size.y;
  const shape = partShape(part);
  if (shape === 'circle') {
    const cx = (l + r) / 2;
    const cy = (t + b) / 2;
    const nx = (p.x - cx) / (Math.max(1, part.size.x) / 2);
    const ny = (p.y - cy) / (Math.max(1, part.size.y) / 2);
    return nx * nx + ny * ny <= 1;
  }
  if (shape === 'triangle') {
    const baseA = { x: l, y: b };
    const baseB = { x: r, y: b };
    const apex = { x: (l + r) / 2, y: t };
    const sign = (a: Vec2, b: Vec2, c: Vec2): number => (a.x - c.x) * (b.y - c.y) - (b.x - c.x) * (a.y - c.y);
    const d1 = sign(p, baseA, apex);
    const d2 = sign(p, baseB, baseA);
    const d3 = sign(p, apex, baseB);
    const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
    const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
    return !(hasNeg && hasPos);
  }
  if (shape === 'line') {
    const yMid = (t + b) / 2;
    return pointSegmentDistance(p, { x: l, y: yMid }, { x: r, y: yMid }) <= Math.max(1, part.size.y / 2);
  }
  return p.x >= l && p.x <= r && p.y >= t && p.y <= b;
}

export function snap(value: number, step: number): number {
  return Math.round(value / step) * step;
}

export function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function pointSegmentDistance(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return dist(p, a);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}
