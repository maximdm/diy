import { PROJECT_FORMAT, PROJECT_VERSION, type ProjectFile } from '../domain/types';
import type { ScrapItem } from '../domain/types';
import type { Scene } from './scene';

const STORAGE_KEY = 'draw-try:project';
const INVENTORY_KEY = 'draw-try:scraps';
const AUTOSAVE_MS = 400;

function validProject(f: unknown): f is ProjectFile {
  if (!f || typeof f !== 'object') return false;
  const o = f as Record<string, unknown>;
  return (
    o.format === PROJECT_FORMAT &&
    o.version === PROJECT_VERSION &&
    typeof o.profileId === 'string' &&
    Array.isArray(o.parts) &&
    Array.isArray(o.dimensions) &&
    Array.isArray(o.notes)
  );
}

export function parseProject(text: string): ProjectFile | null {
  try {
    const file = JSON.parse(text);
    return validProject(file) ? file : null;
  } catch {
    return null;
  }
}

export function loadProject(): ProjectFile | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? parseProject(raw) : null;
  } catch {
    return null;
  }
}

export function saveProject(scene: Scene): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(scene.serialize()));
  } catch {
    // storage unavailable (privacy mode / quota) — persistence is best-effort
  }
  saveInventory(scene.scraps);
}

export function loadInventory(): ScrapItem[] {
  try {
    const raw = localStorage.getItem(INVENTORY_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as ScrapItem[];
  } catch {
    return [];
  }
}

export function saveInventory(items: ScrapItem[]): void {
  try {
    localStorage.setItem(INVENTORY_KEY, JSON.stringify(items));
  } catch {
    // best-effort; storage may be unavailable
  }
}

export function autosave(scene: Scene): () => void {
  let timer = 0;
  const write = (): void => {
    timer = 0;
    saveProject(scene);
  };
  const schedule = (): void => {
    clearTimeout(timer);
    timer = window.setTimeout(write, AUTOSAVE_MS);
  };
  const flush = (): void => {
    clearTimeout(timer);
    write();
  };
  const unsub = scene.subscribe(schedule);
  const onHide = (): void => flush();
  window.addEventListener('pagehide', onHide);
  return () => {
    clearTimeout(timer);
    window.removeEventListener('pagehide', onHide);
    unsub();
  };
}