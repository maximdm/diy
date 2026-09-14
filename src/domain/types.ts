export type Unit = 'mm' | 'cm' | 'm' | 'in';

export type Measure = 'linear' | 'area' | 'count';

export type PartShape = 'rect' | 'circle' | 'triangle' | 'line';

export type MaterialRole = 'stock' | 'fixing' | 'finish';

export interface Vec2 {
  x: number;
  y: number;
}

export interface Material {
  id: string;
  name: string;
  category: string;
  role: MaterialRole;
  measure: Measure;
  costPerUnit: number;
  unitLabel: string;
  color: string;
  supplier?: string;
}

export interface PartKind {
  id: string;
  label: string;
  defaultMaterialId: string;
  defaultLength: number;
  defaultWidth: number;
  defaultThickness: number;
  defaultShape?: PartShape;
  measure: Measure;
}

export interface Part {
  id: string;
  kindId: string;
  materialId: string;
  label: string;
  position: Vec2;
  size: Vec2;
  rotation: number;
  quantity: number;
  dimensions: { length: number; width: number; thickness: number };
  shape?: PartShape;
  color?: string;
}

export type Anchor =
  | { kind: 'free'; p: Vec2 }
  | { kind: 'part'; partId: string; u: number; v: number };

export interface Dimension {
  id: string;
  a: Anchor;
  b: Anchor;
  offset: number;
  axis: 'x' | 'y';
}

export interface Template {
  id: string;
  name: string;
  parts: Omit<Part, 'id'>[];
}

export interface Profile {
  id: string;
  name: string;
  color: string;
  displayUnit: Unit;
  precision: number;
  gridSize: number;
  snap: boolean;
  materials: Material[];
  partKinds: PartKind[];
  templates: Template[];
}
