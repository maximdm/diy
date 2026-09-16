import { formatLength } from '../domain/format';
import type { Scene } from '../engine/scene';
import type { PartShape, MeasureMode } from '../domain/types';
import type { Tool, CustomPartSpec } from '../engine/canvasEngine';
import { CustomPartBuilder } from './CustomPartBuilder';

interface Props {
  scene: Scene;
  tool: Tool;
  kindId: string;
  partShape: PartShape | null;
  customSpec: CustomPartSpec;
  measureMode: MeasureMode;
  quickMeasure: boolean;
  onKind: (id: string) => void;
  onPartShape: (shape: PartShape | null) => void;
  onCustomSpec: (spec: CustomPartSpec) => void;
  onMeasureMode: (m: MeasureMode) => void;
  onQuickMeasure: (on: boolean) => void;
}

const SHAPES: { value: PartShape; label: string }[] = [
  { value: 'rect', label: 'Rectangle' },
  { value: 'circle', label: 'Circle' },
  { value: 'triangle', label: 'Triangle' },
  { value: 'line', label: 'Line / rod' },
];

const MEASURE_MODES: { value: MeasureMode; label: string; hint: string }[] = [
  { value: 'linear', label: 'Length', hint: 'Axis-aligned length (auto x/y)' },
  { value: 'diagonal', label: 'Diagonal', hint: 'True distance between two points' },
  { value: 'angle', label: 'Angle', hint: 'Click vertex, then two arms' },
  { value: 'radius', label: 'Radius', hint: 'Click centre, then the rim' },
  { value: 'area', label: 'Area', hint: 'Click points; double-click or click the first to close' },
];

export function ToolContext({
  scene,
  tool,
  kindId,
  partShape,
  customSpec,
  measureMode,
  quickMeasure,
  onKind,
  onPartShape,
  onCustomSpec,
  onMeasureMode,
  onQuickMeasure,
}: Props) {
  const unit = scene.displayUnit;
  const precision = scene.displayPrecision;

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
        <div className="seg">
          {MEASURE_MODES.map((m) => (
            <button
              key={m.value}
              type="button"
              className={measureMode === m.value ? 'seg-btn active' : 'seg-btn'}
              title={m.hint}
              onClick={() => onMeasureMode(m.value)}
            >
              {m.label}
            </button>
          ))}
        </div>
        <p className="muted small">
          {MEASURE_MODES.find((m) => m.value === measureMode)?.hint}
          <br />
          <br />
          Dimensions follow parts when they move. Hold <b>Q</b> with Select to quick-measure a drag.
        </p>
        <label className="field check">
          <input type="checkbox" checked={quickMeasure} onChange={(e) => onQuickMeasure(e.target.checked)} />
          <span>Quick measure ({quickMeasure ? 'on' : 'off'})</span>
        </label>
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
