import type { Anchor, Dimension, Material, Part, PartKind, Profile, Template, Vec2 } from '../domain/types';
import { anchorCandidates, snap } from './geometry';

type Listener = () => void;

interface Snapshot {
  parts: Part[];
  dimensions: Dimension[];
  selectedPartId: string | null;
  selectedDimensionId: string | null;
}

const HIST_LIMIT = 100;

function anchorRefs(a: Anchor, partId: string): boolean {
  return a.kind === 'part' && a.partId === partId;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class Scene {
  profile: Profile;
  parts: Part[] = [];
  dimensions: Dimension[] = [];
  customMaterials: Material[] = [];
  customTemplates: Template[] = [];
  selectedPartId: string | null = null;
  selectedDimensionId: string | null = null;
  version = 0;

  private listeners = new Set<Listener>();
  private counter = 0;
  private undoStack: Snapshot[] = [];
  private redoStack: Snapshot[] = [];
  private inTxn = false;
  private txnBefore: Snapshot | null = null;
  private txnChanged = false;

  constructor(profile: Profile) {
    this.profile = profile;
  }

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  touch(): void {
    this.version++;
    for (const l of this.listeners) l();
  }

  private nextId(prefix: string): string {
    this.counter++;
    return `${prefix}${this.counter}`;
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  private snapshot(): Snapshot {
    return {
      parts: clone(this.parts),
      dimensions: clone(this.dimensions),
      selectedPartId: this.selectedPartId,
      selectedDimensionId: this.selectedDimensionId,
    };
  }

  private pushUndo(s: Snapshot): void {
    this.undoStack.push(s);
    if (this.undoStack.length > HIST_LIMIT) this.undoStack.shift();
    this.redoStack = [];
  }

  begin(): void {
    if (this.inTxn) return;
    this.inTxn = true;
    this.txnBefore = this.snapshot();
    this.txnChanged = false;
  }

  end(): void {
    if (!this.inTxn) {
      this.txnBefore = null;
      this.txnChanged = false;
      return;
    }
    this.inTxn = false;
    if (this.txnBefore && this.txnChanged) {
      this.pushUndo(this.txnBefore);
      this.touch();
    }
    this.txnBefore = null;
    this.txnChanged = false;
  }

  undo(): boolean {
    const s = this.undoStack.pop();
    if (!s) return false;
    this.redoStack.push(this.snapshot());
    this.restore(s);
    return true;
  }

  redo(): boolean {
    const s = this.redoStack.pop();
    if (!s) return false;
    this.undoStack.push(this.snapshot());
    this.restore(s);
    return true;
  }

  private restore(s: Snapshot): void {
    this.parts = s.parts;
    this.dimensions = s.dimensions;
    this.selectedPartId = s.selectedPartId;
    this.selectedDimensionId = s.selectedDimensionId;
    this.touch();
  }

  private record(): void {
    if (this.inTxn) {
      this.txnChanged = true;
      return;
    }
    this.pushUndo(this.snapshot());
  }

  material(id: string): Material | undefined {
    return this.profile.materials.find((m) => m.id === id) ?? this.customMaterials.find((m) => m.id === id);
  }

  get materials(): Material[] {
    return [...this.profile.materials, ...this.customMaterials];
  }

  get templates(): Template[] {
    return [...this.profile.templates, ...this.customTemplates];
  }

  addCustomTemplate(template: Template): void {
    this.customTemplates = this.customTemplates.filter((t) => t.id !== template.id);
    this.customTemplates.push(template);
    this.touch();
  }

  setCustomMaterial(material: Material): void {
    this.customMaterials = this.customMaterials.filter((m) => m.id !== material.id);
    this.customMaterials.push(material);
  }

  kind(id: string): PartKind | undefined {
    return this.profile.partKinds.find((k) => k.id === id);
  }

  partById(id: string): Part | undefined {
    return this.parts.find((p) => p.id === id);
  }

  selectedPart(): Part | undefined {
    return this.selectedPartId ? this.partById(this.selectedPartId) : undefined;
  }

  addPart(part: Omit<Part, 'id'>): Part {
    this.record();
    const p: Part = { ...part, id: this.nextId('p') };
    this.parts.push(p);
    this.touch();
    return p;
  }

  updatePart(id: string, patch: Partial<Part>): void {
    const p = this.partById(id);
    if (!p) return;
    this.record();
    Object.assign(p, patch);
    this.touch();
  }

  removePart(id: string): void {
    this.record();
    this.parts = this.parts.filter((p) => p.id !== id);
    this.dimensions = this.dimensions.filter((d) => !anchorRefs(d.a, id) && !anchorRefs(d.b, id));
    if (this.selectedPartId === id) this.selectedPartId = null;
    this.touch();
  }

  addDimension(dim: Omit<Dimension, 'id'>): Dimension {
    this.record();
    const d: Dimension = { ...dim, id: this.nextId('d') };
    this.dimensions.push(d);
    this.touch();
    return d;
  }

  removeDimension(id: string): void {
    this.record();
    this.dimensions = this.dimensions.filter((d) => d.id !== id);
    if (this.selectedDimensionId === id) this.selectedDimensionId = null;
    this.touch();
  }

  selectPart(id: string | null): void {
    this.selectedPartId = id;
    this.selectedDimensionId = null;
    this.touch();
  }

  selectDimension(id: string | null): void {
    this.selectedDimensionId = id;
    this.selectedPartId = null;
    this.touch();
  }

  anchorPoint(anchor: Anchor): Vec2 {
    if (anchor.kind === 'free') return anchor.p;
    const p = this.partById(anchor.partId);
    if (!p) return { x: 0, y: 0 };
    return { x: p.position.x + anchor.u * p.size.x, y: p.position.y + anchor.v * p.size.y };
  }

  resolveAnchor(world: Vec2, toleranceMm: number): Anchor {
    let best: { d: number; part: Part; u: number; v: number } | null = null;
    for (const part of this.parts) {
      for (const c of anchorCandidates(part)) {
        const d = Math.hypot(c.x - world.x, c.y - world.y);
        if (!best || d < best.d) best = { d, part, u: c.u, v: c.v };
      }
    }
    if (best && best.d <= toleranceMm) {
      return { kind: 'part', partId: best.part.id, u: best.u, v: best.v };
    }
    return { kind: 'free', p: { x: snap(world.x, this.profile.gridSize), y: snap(world.y, this.profile.gridSize) } };
  }

  addTemplate(template: Template, origin: Vec2): void {
    this.record();
    for (const t of template.parts) {
      if (t.quantity <= 0) continue;
      this.parts.push({
        ...t,
        id: this.nextId('p'),
        position: { x: t.position.x + origin.x, y: t.position.y + origin.y },
      });
    }
    this.touch();
  }

  clear(): void {
    this.record();
    this.parts = [];
    this.dimensions = [];
    this.selectedPartId = null;
    this.selectedDimensionId = null;
    this.touch();
  }
}