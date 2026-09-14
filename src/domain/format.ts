import type { Unit } from './types';

const FACTORS: Record<Unit, number> = { mm: 1, cm: 10, m: 1000, in: 25.4 };

export function roundTo(value: number, precision: number): number {
  const f = 10 ** precision;
  return Math.round(value * f) / f;
}

export function mmToDisplay(mm: number, unit: Unit): number {
  return mm / FACTORS[unit];
}

export function displayToMm(value: number, unit: Unit): number {
  return value * FACTORS[unit];
}

export function formatLength(mm: number, unit: Unit, precision: number): string {
  return `${roundTo(mmToDisplay(mm, unit), precision)} ${unit}`;
}

export function formatQty(qty: number, unit: string): string {
  if (unit === 'm' || unit === 'm2') return `${qty.toFixed(2)} ${unit === 'm2' ? 'm\u00b2' : unit}`;
  return `${Math.round(qty)} ${unit}`;
}

export function formatCurrency(n: number): string {
  return `$${n.toFixed(2)}`;
}