import { formatLength } from '../domain/format';
import type { Scene } from '../engine/scene';
import type { PartShape } from '../domain/types';
import type { Tool, CustomPartSpec } from '../engine/canvasEngine';
import { CustomPartBuilder } from './CustomPartBuilder';

interface Props {
  scene: Scene;
  tool: Tool;
  kindId: string;
  partShape: PartShape | null;
  customSpec: CustomPartSpec;
  onKind: (id: string) => void;
  onPartShape: (shape: PartShape | null) => void;
  onCustomSpec: (spec: CustomPartSpec) => void;
}

const SHAPES: { value: PartShape; label: string }[] = [
  { value: 'rect', label: 'Rectangle' },
  { value: 'circle', label: 'Circle' },
  { value: 'triangle', label: 'Triangle' },
  { value: 'line', label: 'Line / rod' },
];

export function ToolContext({ scene, tool, kindId, partShape, customSpec, onKind, onPartShape, onCustomSpec }: Props) {
  const unit = scene.profile.displayUnit;
  const precision = scene.profile.precision;

  if (tool === 'custom') {
    return <CustomPartBuilder scene={scene} spec={customSpec} onChange={onCustomSpec} />;
  }

  if (tool === 'part') {
    const kind = scene.kind(kindId);
    const material = kind ? scene.material(kind.defaultMaterialId) : undefined;
    return (
      <section className="panel">
        <h2>Drawing</h2>
        <label className="field">
          <span>Part kind</span>
          <select value={kindId} onChange={(e) => onKind(e.target.value)}>
            {scene.profile.partKinds.map((k) => (
              <option key={k.id} value={k.id}>
                {k.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Shape</span>
          <select value={partShape ?? ''} onChange={(e) => onPartShape(e.target.value === '' ? null : (e.target.value as PartShape))}>
            <option value="">Default ({kind?.defaultShape ?? 'rect'})</option>
            {SHAPES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        {kind ? (
          <div className="meta">
            <div>
              <span className="muted small">Material</span>
              <div>{material?.name ?? '—'}</div>
            </div>
          </div>
        ) : (
          <p className="muted">Pick a part kind first.</p>
        )}
        {kind && (
          <div className="muted small" style={{ marginTop: 8 }}>
            Default: {formatLength(kind.defaultLength, unit, precision)} ×{' '}
            {formatLength(kind.defaultWidth, unit, precision)}
            <br />
            Click to place at default size, or drag to set size.
          </div>
        )}
      </section>
    );
  }

  if (tool === 'dimension') {
    return (
      <section className="panel">
        <h2>Measurement</h2>
        <p className="muted small">
          Click a corner or edge to start, then click a second point to place the dimension.
          <br />
          <br />
          Dimensions follow parts when they move.
        </p>
      </section>
    );
  }

  if (tool === 'pan') {
    return (
      <section className="panel">
        <h2>Pan</h2>
        <p className="muted small">
          Drag the board to pan. Use scroll wheel to zoom.
        </p>
      </section>
    );
  }

  return null;
}
