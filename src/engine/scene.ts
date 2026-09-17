import type { Anchor, Dimension, Material, Note, NoteItem, Part, PartKind, PartLayer, Profile, Template, Unit, Vec2 } from '../domain/types';
import { PROJECT_FORMAT, PROJECT_VERSION, type ProjectFile } from '../domain/types';
import { anchorCandidates, rotatedPoint, snap } from './geometry';

type Listener = () => void;

interface Snapshot {
  parts: Part[];
  layers: PartLayer[];
  dimensions: Dimension[];
  notes: Note[];
  selectedPartIds: string[];
  selectedDimensionIds: string[];
  selectedNoteId: string | null;
}

const HIST_LIMIT = 100;

function anchorRefs(a: Anchor, partId: string): boolean {
  return a.kind === 'part' && a.partId === partId;
}

function dimUsesPart(dim: Dimension, partId: string): boolean {
  const anchors: Anchor[] = [dim.a, dim.b];
  if (dim.c) anchors.push(dim.c);
  if (dim.points) anchors.push(...dim.points);
  return anchors.some((a) => anchorRefs(a, partId));
}

function unitPrecision(unit: Unit | null): number | null {
  return unit === 'mm' ? 0 : unit === 'cm' ? 1 : unit === 'm' || unit === 'in' ? 2 : null;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class Scene {
  profile: Profile;
  parts: Part[] = [];
  layers: PartLayer[] = [];
  dimensions: Dimension[] = [];
  notes: Note[] = [];
  customMaterials: Material[] = [];
  customTemplates: Template[] = [];
  selectedPartIds: string[] = [];
  selectedDimensionIds: string[] = [];
  selectedNoteId: string | null = null;

  get selectedDimensionId(): string | null {
    return this.selectedDimensionIds[0] ?? null;
  }
  version = 0;

  get selectedPartId(): string | null {
    return this.selectedPartIds.length ? this.selectedPartIds[this.selectedPartIds.length - 1] : null;
  }

  private displayUnitOverride: Unit | null = null;
  private displayPrecisionOverride: number | null = null;
  private clipboard: Omit<Part, 'id'>[] = [];

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

  get displayUnit(): Unit {
    return this.displayUnitOverride ?? this.profile.displayUnit;
  }

  get displayPrecision(): number {
    return this.displayPrecisionOverride ?? this.profile.precision;
  }

  setDisplayUnit(unit: Unit | null): void {
    this.displayUnitOverride = unit;
    this.displayPrecisionOverride = unitPrecision(unit);
    this.touch();
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
      layers: clone(this.layers),
      dimensions: clone(this.dimensions),
      notes: clone(this.notes),
      selectedPartIds: clone(this.selectedPartIds),
      selectedDimensionIds: clone(this.selectedDimensionIds),
      selectedNoteId: this.selectedNoteId,
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
    this.layers = s.layers;
    this.dimensions = s.dimensions;
    this.notes = s.notes;
    this.selectedPartIds = s.selectedPartIds;
    this.selectedDimensionIds = s.selectedDimensionIds;
    this.selectedNoteId = s.selectedNoteId;
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

  layerById(id: string): PartLayer | undefined {
    return this.layers.find((l) => l.id === id);
  }

  layerVisible(layerId: string | null): boolean {
    if (!layerId) return true;
    return this.layerById(layerId)?.visible ?? true;
  }

  layerLocked(layerId: string | null): boolean {
    if (!layerId) return false;
    return this.layerById(layerId)?.locked ?? false;
  }

  isPartLocked(id: string): boolean {
    const p = this.partById(id);
    return !p || this.layerLocked(p.layerId ?? null);
  }

  isPartVisible(id: string): boolean {
    const p = this.partById(id);
    return !p || this.layerVisible(p.layerId ?? null);
  }

  visibleParts(): Part[] {
    return this.parts.filter((p) => this.isPartVisible(p.id));
  }

  renderOrderParts(): Part[] {
    const byLayer = new Map<string, Part[]>();
    for (const l of this.layers) byLayer.set(l.id, []);
    const ungrouped: Part[] = [];
    for (const p of this.parts) {
      if (p.layerId != null && byLayer.has(p.layerId)) byLayer.get(p.layerId)!.push(p);
      else ungrouped.push(p);
    }
    const out: Part[] = [];
    for (const l of this.layers) for (const p of byLayer.get(l.id) ?? []) if (this.isPartVisible(p.id)) out.push(p);
    for (const p of ungrouped) if (this.isPartVisible(p.id)) out.push(p);
    return out;
  }

  partsInLayer(layerId: string | null): Part[] {
    return this.parts.filter((p) => (p.layerId ?? null) === layerId);
  }

  isDimensionVisible(dim: Dimension): boolean {
    const anchors: Anchor[] = [dim.a, dim.b];
    if (dim.c) anchors.push(dim.c);
    if (dim.points) anchors.push(...dim.points);
    return anchors.every((a) => a.kind !== 'part' || this.isPartVisible(a.partId));
  }

  isNoteVisible(note: Note): boolean {
    if (note.context.kind === 'part' && (note.context.partId ?? '') && !this.isPartVisible(note.context.partId ?? '')) {
      return false;
    }
    return this.isBoardNote(note);
  }

  addLayer(name?: string): PartLayer {
    this.record();
    const layer: PartLayer = {
      id: this.nextId('l'),
      name: name?.trim() || this.nextLayerName(),
      visible: true,
    };
    this.layers.push(layer);
    this.touch();
    return layer;
  }

  updateLayer(id: string, patch: Partial<PartLayer>): void {
    const l = this.layerById(id);
    if (!l) return;
    this.record();
    Object.assign(l, patch);
    this.touch();
  }

  setLayerVisible(id: string, visible: boolean): void {
    const l = this.layerById(id);
    if (!l || l.visible === visible) return;
    this.record();
    l.visible = visible;
    if (!visible) {
      const hidden = new Set(this.parts.filter((p) => p.layerId === id).map((p) => p.id));
      this.selectedPartIds = this.selectedPartIds.filter((pid) => !hidden.has(pid));
      this.selectedDimensionIds = this.selectedDimensionIds.filter((did) => {
        const d = this.dimensions.find((x) => x.id === did);
        return !d || this.isDimensionVisible(d);
      });
      if (this.selectedNoteId) {
        const n = this.noteById(this.selectedNoteId);
        if (n && !this.isNoteVisible(n)) this.selectedNoteId = null;
      }
    }
    this.touch();
  }

  setLayerLocked(id: string, locked: boolean): void {
    const l = this.layerById(id);
    if (!l || (l.locked ?? false) === locked) return;
    this.record();
    l.locked = locked;
    if (locked) {
      const inLayer = new Set(this.parts.filter((p) => p.layerId === id).map((p) => p.id));
      this.selectedPartIds = this.selectedPartIds.filter((pid) => !inLayer.has(pid));
    }
    this.touch();
  }

  moveLayer(id: string, dir: 1 | -1): boolean {
    const i = this.layers.findIndex((l) => l.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= this.layers.length) return false;
    this.record();
    const [layer] = this.layers.splice(i, 1);
    this.layers.splice(j, 0, layer);
    this.touch();
    return true;
  }

  removeLayer(id: string): void {
    const l = this.layerById(id);
    if (!l) return;
    this.record();
    this.layers = this.layers.filter((x) => x.id !== id);
    for (const p of this.parts) {
      if (p.layerId === id) p.layerId = undefined;
    }
    this.touch();
  }

  setPartsLayer(ids: string[], layerId: string | null): void {
    const targets = ids.map((id) => this.partById(id)).filter((p): p is Part => Boolean(p));
    if (!targets.length) return;
    this.record();
    for (const p of targets) p.layerId = layerId ?? undefined;
    this.touch();
  }

  private nextLayerName(): string {
    const used = new Set(this.layers.map((l) => l.name.toLowerCase()));
    let n = 1;
    while (used.has(`layer ${n}`)) n++;
    return `Layer ${n}`;
  }

  partById(id: string): Part | undefined {
    return this.parts.find((p) => p.id === id);
  }

  selectedPart(): Part | undefined {
    return this.selectedPartId ? this.partById(this.selectedPartId) : undefined;
  }

  selectedParts(): Part[] {
    return this.selectedPartIds.map((id) => this.partById(id)).filter((p): p is Part => Boolean(p));
  }

  isPartSelected(id: string): boolean {
    return this.selectedPartIds.includes(id);
  }

  selectParts(ids: string[]): void {
    this.selectedPartIds = [...ids];
    this.selectedDimensionIds = [];
    this.selectedNoteId = null;
    this.touch();
  }

  togglePartSelected(id: string): void {
    if (this.isPartSelected(id)) {
      this.selectedPartIds = this.selectedPartIds.filter((pid) => pid !== id);
    } else {
      this.selectedPartIds.push(id);
    }
    this.selectedDimensionIds = [];
    this.selectedNoteId = null;
    this.touch();
  }

  copySelection(): void {
    this.clipboard = this.selectedParts().map(({ id: _id, ...rest }) => rest);
  }

  paste(): void {
    if (!this.clipboard.length) return;
    this.record();
    const PASTE_OFFSET = 24;
    const newParts: Part[] = [];
    for (const pt of this.clipboard) {
      const p: Part = {
        ...pt,
        id: this.nextId('p'),
        position: { x: pt.position.x + PASTE_OFFSET, y: pt.position.y + PASTE_OFFSET },
      };
      this.parts.push(p);
      newParts.push(p);
    }
    this.selectParts(newParts.map((p) => p.id));
    this.touch();
  }

  duplicate(): void {
    this.copySelection();
    this.paste();
  }

  alignParts(ids: string[], axis: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom'): void {
    if (ids.length < 2) return;
    const parts = ids.map((id) => this.partById(id)).filter((p): p is Part => Boolean(p));
    if (parts.length < 2) return;
    this.record();
    let ref: number;
    if (axis === 'left') ref = Math.min(...parts.map((p) => p.position.x));
    else if (axis === 'right') ref = Math.max(...parts.map((p) => p.position.x + p.size.x));
    else if (axis === 'center') {
      ref = (Math.min(...parts.map((p) => p.position.x)) + Math.max(...parts.map((p) => p.position.x + p.size.x))) / 2;
    } else if (axis === 'top') ref = Math.min(...parts.map((p) => p.position.y));
    else if (axis === 'bottom') ref = Math.max(...parts.map((p) => p.position.y + p.size.y));
    else {
      ref = (Math.min(...parts.map((p) => p.position.y)) + Math.max(...parts.map((p) => p.position.y + p.size.y))) / 2;
    }
    for (const p of parts) {
      if (axis === 'left') p.position.x = ref;
      else if (axis === 'right') p.position.x = ref - p.size.x;
      else if (axis === 'center') p.position.x = ref - p.size.x / 2;
      else if (axis === 'top') p.position.y = ref;
      else if (axis === 'bottom') p.position.y = ref - p.size.y;
      else p.position.y = ref - p.size.y / 2;
    }
    this.touch();
  }

  distributeParts(ids: string[], axis: 'x' | 'y'): void {
    if (ids.length < 3) return;
    const parts = ids.map((id) => this.partById(id)).filter((p): p is Part => Boolean(p));
    if (parts.length < 3) return;
    this.record();
    if (axis === 'x') {
      parts.sort((a, b) => a.position.x - b.position.x);
      const minX = parts[0].position.x;
      const maxX = parts[parts.length - 1].position.x;
      const step = (maxX - minX) / (parts.length - 1);
      for (let i = 1; i < parts.length - 1; i++) parts[i].position.x = minX + step * i;
    } else {
      parts.sort((a, b) => a.position.y - b.position.y);
      const minY = parts[0].position.y;
      const maxY = parts[parts.length - 1].position.y;
      const step = (maxY - minY) / (parts.length - 1);
      for (let i = 1; i < parts.length - 1; i++) parts[i].position.y = minY + step * i;
    }
    this.touch();
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
    this.dimensions = this.dimensions.filter((d) => !dimUsesPart(d, id));
    this.notes = this.notes.filter((n) => !(n.context.kind === 'part' && n.context.partId === id));
    this.selectedPartIds = this.selectedPartIds.filter((pid) => pid !== id);
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
    this.notes = this.notes.filter((n) => !(n.context.kind === 'measure' && n.context.dimensionId === id));
    this.selectedDimensionIds = this.selectedDimensionIds.filter((pid) => pid !== id);
    this.touch();
  }

  selectDimension(id: string | null): void {
    this.selectedDimensionIds = id ? [id] : [];
    this.selectedPartIds = [];
    this.selectedNoteId = null;
    this.touch();
  }

  selectDimensions(ids: string[]): void {
    this.selectedDimensionIds = [...ids];
    this.selectedPartIds = [];
    this.selectedNoteId = null;
    this.touch();
  }

  toggleDimensionSelected(id: string): void {
    if (this.selectedDimensionIds.includes(id)) {
      this.selectedDimensionIds = this.selectedDimensionIds.filter((pid) => pid !== id);
    } else {
      this.selectedDimensionIds.push(id);
    }
    this.selectedPartIds = [];
    this.selectedNoteId = null;
    this.touch();
  }

  updateDimension(id: string, patch: Partial<Dimension>): void {
    const d = this.dimensions.find((x) => x.id === id);
    if (!d) return;
    this.record();
    Object.assign(d, patch);
    this.touch();
  }

  selectPart(id: string | null): void {
    this.selectedPartIds = id ? [id] : [];
    this.selectedDimensionIds = [];
    this.selectedNoteId = null;
    this.touch();
  }

  noteById(id: string): Note | undefined {
    return this.notes.find((n) => n.id === id);
  }

  selectedNote(): Note | undefined {
    return this.selectedNoteId ? this.noteById(this.selectedNoteId) : undefined;
  }

  addNote(note: Omit<Note, 'id'>): Note {
    this.record();
    const n: Note = { ...note, id: this.nextId('n'), items: (note.items ?? []).map((it) => ({ ...it })) };
    this.notes.push(n);
    this.touch();
    return n;
  }

  updateNote(id: string, patch: Partial<Note>): void {
    const n = this.noteById(id);
    if (!n) return;
    this.record();
    Object.assign(n, patch);
    this.touch();
  }

  removeNote(id: string): void {
    this.record();
    this.notes = this.notes.filter((n) => n.id !== id);
    if (this.selectedNoteId === id) this.selectedNoteId = null;
    this.touch();
  }

  selectNote(id: string | null): void {
    this.selectedNoteId = id;
    this.selectedPartIds = [];
    this.selectedDimensionIds = [];
    this.touch();
  }

  isBoardNote(note: Note): boolean {
    return note.context.kind !== 'general' || note.board;
  }

  noteAnchorWorld(note: Note): Vec2 | null {
    const ctx = note.context;
    if (ctx.kind === 'part') {
      const p = this.partById(ctx.partId ?? '');
      if (!p) return null;
      return { x: p.position.x, y: p.position.y - 46 };
    }
    if (ctx.kind === 'measure') {
      const d = this.dimensions.find((dm) => dm.id === ctx.dimensionId);
      if (!d) return null;
      if (d.kind === 'angle') {
        const a = this.anchorPoint(d.a);
        return { x: a.x, y: a.y - 30 };
      }
      if (d.kind === 'area' && d.points && d.points.length) {
        let cx = 0;
        let cy = 0;
        for (const p of d.points) {
          const w = this.anchorPoint(p);
          cx += w.x;
          cy += w.y;
        }
        return { x: cx / d.points.length, y: cy / d.points.length - 30 };
      }
      const a = this.anchorPoint(d.a);
      const b = this.anchorPoint(d.b);
      return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 - 30 };
    }
    if (!note.board) return null;
    return note.position ?? { x: 0, y: 0 };
  }

  addNoteItem(noteId: string, text: string): void {
    const n = this.noteById(noteId);
    if (!n) return;
    this.record();
    n.items.push({ id: this.nextId('ni'), text, checked: false });
    this.touch();
  }

  updateNoteItem(noteId: string, itemId: string, patch: Partial<NoteItem>): void {
    const n = this.noteById(noteId);
    if (!n) return;
    const it = n.items.find((i) => i.id === itemId);
    if (!it) return;
    this.record();
    Object.assign(it, patch);
    this.touch();
  }

  removeNoteItem(noteId: string, itemId: string): void {
    const n = this.noteById(noteId);
    if (!n) return;
    this.record();
    n.items = n.items.filter((i) => i.id !== itemId);
    this.touch();
  }

  anchorPoint(anchor: Anchor): Vec2 {
    if (anchor.kind === 'free') return anchor.p;
    const p = this.partById(anchor.partId);
    if (!p) return { x: 0, y: 0 };
    return rotatedPoint(p, { x: anchor.u * p.size.x, y: anchor.v * p.size.y });
  }

  resolveAnchor(world: Vec2, toleranceMm: number): Anchor {
    let best: { d: number; part: Part; u: number; v: number } | null = null;
    for (const part of this.parts) {
      if (!this.isPartVisible(part.id)) continue;
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
    this.layers = [];
    this.dimensions = [];
    this.notes = [];
    this.selectedPartIds = [];
    this.selectedDimensionIds = [];
    this.selectedNoteId = null;
    this.touch();
  }

  serialize(): ProjectFile {
    return {
      format: PROJECT_FORMAT,
      version: PROJECT_VERSION,
      profileId: this.profile.id,
      displayUnit: this.displayUnitOverride,
      customMaterials: clone(this.customMaterials),
      customTemplates: clone(this.customTemplates),
      parts: clone(this.parts),
      dimensions: clone(this.dimensions),
      notes: clone(this.notes),
      layers: clone(this.layers),
    };
  }

  load(file: ProjectFile): void {
    this.parts = clone(file.parts);
    this.layers = (file.layers ?? []).map((l) => ({ id: l.id, name: l.name, visible: l.visible, locked: l.locked ?? false }));
    this.dimensions = clone(file.dimensions);
    this.notes = file.notes.map((n) => ({ ...n, items: (n.items ?? []).map((it) => ({ ...it })) }));
    this.customMaterials = clone(file.customMaterials ?? []);
    this.customTemplates = clone(file.customTemplates ?? []);
    this.displayUnitOverride = file.displayUnit ?? null;
    this.displayPrecisionOverride = unitPrecision(file.displayUnit ?? null);
    this.selectedPartIds = [];
    this.selectedDimensionIds = [];
    this.selectedNoteId = null;
    for (const d of this.dimensions) {
      if (!d.kind) d.kind = 'linear';
      if (!d.axis) d.axis = 'x';
    }
    this.counter = this.maxIdCounter() + 1;
    this.undoStack = [];
    this.redoStack = [];
    this.touch();
  }

  private maxIdCounter(): number {
    let max = 0;
    for (const id of [
      ...this.parts.map((p) => p.id),
      ...this.layers.map((l) => l.id),
      ...this.dimensions.map((d) => d.id),
      ...this.notes.map((n) => n.id),
      ...this.notes.flatMap((n) => n.items.map((i) => i.id)),
    ]) {
      const m = /(\d+)$/.exec(id);
      if (m) max = Math.max(max, Number(m[1]));
    }
    return max;
  }
}