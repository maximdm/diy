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

export function rot(p: Part): number {
  return p.rotation ?? 0;
}

export function partCenter(p: Part): Vec2 {
  return { x: p.position.x + p.size.x / 2, y: p.position.y + p.size.y / 2 };
}

export function rotatedPoint(p: Part, local: Vec2): Vec2 {
  const c = partCenter(p);
  const a = rot(p);
  const lx = local.x - p.size.x / 2;
  const ly = local.y - p.size.y / 2;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  return { x: c.x + lx * cos - ly * sin, y: c.y + lx * sin + ly * cos };
}

export function toLocalFrame(p: Part, world: Vec2): Vec2 {
  const c = partCenter(p);
  const a = rot(p);
  const dx = world.x - c.x;
  const dy = world.y - c.y;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  return { x: dx * cos + dy * sin + p.size.x / 2, y: -dx * sin + dy * cos + p.size.y / 2 };
}

export function worldAABB(p: Part): { minX: number; minY: number; maxX: number; maxY: number } {
  const cs = [
    rotatedPoint(p, { x: 0, y: 0 }),
    rotatedPoint(p, { x: p.size.x, y: 0 }),
    rotatedPoint(p, { x: p.size.x, y: p.size.y }),
    rotatedPoint(p, { x: 0, y: p.size.y }),
  ];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const c of cs) {
    minX = Math.min(minX, c.x);
    minY = Math.min(minY, c.y);
    maxX = Math.max(maxX, c.x);
    maxY = Math.max(maxY, c.y);
  }
  return { minX, minY, maxX, maxY };
}

export function anchorCandidates(part: Part): AnchorCandidate[] {
  const w = part.size.x;
  const h = part.size.y;
  const out: AnchorCandidate[] = [];
  const shape = partShape(part);
  const local: [number, number][] =
    shape === 'circle'
      ? [
          [0.5, 0],
          [1, 0.5],
          [0.5, 1],
          [0, 0.5],
        ]
      : shape === 'triangle'
        ? [
            [0.5, 0],
            [0, 1],
            [1, 1],
          ]
        : shape === 'line'
          ? [
              [0, 0.5],
              [1, 0.5],
            ]
          : [
              [0, 0],
              [0.5, 0],
              [1, 0],
              [0, 0.5],
              [1, 0.5],
              [0, 1],
              [0.5, 1],
              [1, 1],
            ];
  for (const [u, v] of local) {
    const pt = rotatedPoint(part, { x: u * w, y: v * h });
    out.push({ x: pt.x, y: pt.y, u, v });
  }
  return out;
}

export function partContains(p: Vec2, part: Part): boolean {
  const lp = toLocalFrame(part, p);
  const l = 0;
  const t = 0;
  const r = part.size.x;
  const b = part.size.y;
  const shape = partShape(part);
  if (shape === 'circle') {
    const cx = r / 2;
    const cy = b / 2;
    const nx = (lp.x - cx) / (Math.max(1, part.size.x) / 2);
    const ny = (lp.y - cy) / (Math.max(1, part.size.y) / 2);
    return nx * nx + ny * ny <= 1;
  }
  if (shape === 'triangle') {
    const baseA = { x: l, y: b };
    const baseB = { x: r, y: b };
    const apex = { x: r / 2, y: t };
    const sign = (a: Vec2, b2: Vec2, c: Vec2): number => (a.x - c.x) * (b2.y - c.y) - (b2.x - c.x) * (a.y - c.y);
    const d1 = sign(lp, baseA, apex);
    const d2 = sign(lp, baseB, baseA);
    const d3 = sign(lp, apex, baseB);
    const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
    const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
    return !(hasNeg && hasPos);
  }
  if (shape === 'line') {
    const yMid = b / 2;
    return pointSegmentDistance(lp, { x: l, y: yMid }, { x: r, y: yMid }) <= Math.max(1, part.size.y / 2);
  }
  return lp.x >= l && lp.x <= r && lp.y >= t && lp.y <= b;
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

export function angleBetween(a: Vec2, b: Vec2, c: Vec2): number {
  const v1 = { x: b.x - a.x, y: b.y - a.y };
  const v2 = { x: c.x - a.x, y: c.y - a.y };
  const dot = v1.x * v2.x + v1.y * v2.y;
  const cross = v1.x * v2.y - v1.y * v2.x;
  return Math.abs(Math.atan2(cross, dot));
}

export function polygonArea(points: Vec2[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const q = points[(i + 1) % points.length];
    sum += p.x * q.y - q.x * p.y;
  }
  return Math.abs(sum) / 2;
}

export function polygonPerimeter(points: Vec2[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    sum += dist(points[i], points[(i + 1) % points.length]);
  }
  return sum;
}
