import { displayToMm, formatAngle, formatArea, formatCurrency, formatLength, formatQty, mmToDisplay } from '../domain/format';
import type { Dimension, Part, PartShape } from '../domain/types';
import { materialCategories, materialQuantity } from '../domain/bom';
import type { Scene } from '../engine/scene';
import { angleBetween, dist, polygonArea, polygonPerimeter } from '../engine/geometry';

function dimValue(scene: Scene, d: Dimension): number {
  if (d.kind === 'radius') {
    const v = dist(scene.anchorPoint(d.a), scene.anchorPoint(d.b));
    return d.radiusMode === 'diameter' ? v * 2 : v;
  }
  if (d.kind === 'area' && d.points) {
    return polygonArea(d.points.map((p) => scene.anchorPoint(p)));
  }
  if (d.kind === 'angle') {
    return angleBetween(scene.anchorPoint(d.a), scene.anchorPoint(d.b!), scene.anchorPoint(d.c!));
  }
  const a = scene.anchorPoint(d.a);
  const b = scene.anchorPoint(d.b);
  return d.axis === 'free' ? dist(a, b) : d.axis === 'x' ? Math.abs(b.x - a.x) : Math.abs(b.y - a.y);
}

interface Props {
  scene: Scene;
  version: number;
}

function NumberField({
  label,
  value,
  min = 0,
  onChange,
}: {
  label: string;
  value: number;
  min?: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input
        type="number"
        min={min}
        value={Number.isFinite(value) ? Math.round(value * 10) / 10 : 0}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}

export function Inspector({ scene, version }: Props) {
  void version;
  const parts = scene.selectedParts();
  const note = scene.selectedNote();
  const dims = scene.dimensions.filter((d) => scene.selectedDimensionIds.includes(d.id));

  if (dims.length) {
    const unit = scene.displayUnit;
    const precision = scene.displayPrecision;
    const primary = dims[0];
    const linearTotal = dims
      .filter((d) => d.kind === 'linear')
      .reduce((s, d) => s + dimValue(scene, d), 0);
    return (
      <section className="panel">
        <h2>Measurement{dims.length > 1 ? `s (${dims.length})` : ''}</h2>
        {primary.kind === 'linear' && (
          <>
            <label className="field">
              <span>Direction</span>
              <select
                value={primary.axis}
                onChange={(e) =>
                  scene.updateDimension(primary.id, { axis: e.target.value as Dimension['axis'] })
                }
              >
                <option value="x">Aligned horizontal</option>
                <option value="y">Aligned vertical</option>
                <option value="free">Diagonal / true</option>
              </select>
            </label>
            <label className="field">
              <span>Target ({unit})</span>
              <input
                type="number"
                value={primary.target == null ? '' : Math.round(mmToDisplay(primary.target, unit) * 10) / 10}
                placeholder="none"
                onChange={(e) =>
                  scene.updateDimension(primary.id, {
                    target: e.target.value === '' ? null : displayToMm(Number(e.target.value), unit),
                  })
                }
              />
            </label>
            {primary.target != null && (
              <div
                className="muted small"
                style={{ color: dimValue(scene, primary) - (primary.target ?? 0) >= 0 ? '#2a8a4a' : '#b3442f' }}
              >
                Difference:{' '}
                {formatLength(dimValue(scene, primary) - (primary.target ?? 0), unit, precision)}
              </div>
            )}
          </>
        )}
        {primary.kind === 'radius' && (
          <label className="field">
            <span>Mode</span>
            <select
              value={primary.radiusMode ?? 'radius'}
              onChange={(e) => scene.updateDimension(primary.id, { radiusMode: e.target.value as 'radius' | 'diameter' })}
            >
              <option value="radius">Radius (R)</option>
              <option value="diameter">Diameter (⌀)</option>
            </select>
          </label>
        )}
        {primary.kind === 'angle' && (
          <div className="muted small">Angle: {formatAngle(dimValue(scene, primary), precision)}</div>
        )}
        {primary.kind === 'area' && primary.points && (
          <div className="muted small">
            Area: {formatArea(dimValue(scene, primary), unit, precision)}
            <br />
            Perimeter: {formatLength(polygonPerimeter(primary.points.map((p) => scene.anchorPoint(p))), unit, precision)}
          </div>
        )}
        {dims.length > 1 && (
          <div className="meta">
            <div>
              <span className="muted small">Selected lengths</span>
              <div>{formatLength(linearTotal, unit, precision)}</div>
            </div>
            <div>
              <span className="muted small">Count</span>
              <div>{dims.filter((d) => d.kind === 'linear').length} length(s)</div>
            </div>
          </div>
        )}
        <button className="btn" onClick={() => scene.selectDimensions([])}>
          Clear selection
        </button>
      </section>
    );
  }

  if (note) {
    return (
      <section className="panel">
        <h2>Selection</h2>
        <p className="muted">
          A note is selected. Edit its title, items and attachment in the <strong>Notes</strong> panel — each item is
          a task you can tick off.
        </p>
      </section>
    );
  }

  if (parts.length > 1) {
    const ids = parts.map((p) => p.id);
    return (
      <section className="panel">
        <h2>Selection</h2>
        <p className="muted">{parts.length} parts selected</p>
        <div className="align-grid">
          <span className="small-caption">Align</span>
          <div className="align-row">
            <button className="btn btn-icon" title="Align left" onClick={() => scene.alignParts(ids, 'left')}>◀|</button>
            <button className="btn btn-icon" title="Align centers horizontally" onClick={() => scene.alignParts(ids, 'center')}>◀▶</button>
            <button className="btn btn-icon" title="Align right" onClick={() => scene.alignParts(ids, 'right')}>|▶</button>
            <button className="btn btn-icon" title="Align top" onClick={() => scene.alignParts(ids, 'top')}>▲</button>
            <button className="btn btn-icon" title="Align middles vertically" onClick={() => scene.alignParts(ids, 'middle')}>▲▼</button>
            <button className="btn btn-icon" title="Align bottom" onClick={() => scene.alignParts(ids, 'bottom')}>▼</button>
          </div>
          <span className="small-caption">Distribute</span>
          <div className="align-row">
            <button className="btn btn-icon" title="Distribute horizontally" onClick={() => scene.distributeParts(ids, 'x')}>⇔</button>
            <button className="btn btn-icon" title="Distribute vertically" onClick={() => scene.distributeParts(ids, 'y')}>⇕</button>
          </div>
          <button className="btn" onClick={() => scene.selectParts([])}>Clear selection</button>
        </div>
      </section>
    );
  }

  const part: Part | undefined = parts[0] ?? undefined;
  if (!part) {
    return (
      <section className="panel">
        <h2>Selection</h2>
        <p className="muted">Select a part to edit its size, material and quantity, or a note to edit its text.</p>
      </section>
    );
  }

  const kind = scene.kind(part.kindId);
  const material = scene.material(part.materialId);
  const unit = scene.displayUnit;
  const precision = scene.displayPrecision;
  const update = (patch: Partial<Part>) => scene.updatePart(part.id, patch);

  return (
    <section className="panel">
      <h2>Selection</h2>
      <label className="field">
        <span>Label</span>
        <input value={part.label} onChange={(e) => update({ label: e.target.value })} />
      </label>

      <label className="field">
        <span>Layer</span>
        <select
          value={part.layerId ?? ''}
          onChange={(e) => update({ layerId: e.target.value || undefined })}
        >
          <option value="">— ungrouped —</option>
          {scene.layers.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
      </label>

      <label className="field">
        <span>Shape</span>
        <select value={part.shape ?? 'rect'} onChange={(e) => update({ shape: e.target.value as PartShape })}>
          <option value="rect">Rectangle</option>
          <option value="circle">Circle</option>
          <option value="triangle">Triangle</option>
          <option value="line">Line / rod</option>
        </select>
      </label>

      <label className="field">
        <span>Grain</span>
        <select
          value={part.grain ?? 'free'}
          onChange={(e) => update({ grain: e.target.value as 'free' | 'fixed' })}
          title="A fixed grain keeps this part straight during sheet nesting (no 90° rotation)."
        >
          <option value="free">Any direction (may rotate)</option>
          <option value="fixed">Fixed - with the length</option>
        </select>
      </label>

      <label className="field">
        <span>Material</span>
        <select value={part.materialId} onChange={(e) => update({ materialId: e.target.value })}>
          {materialCategories(scene.materials).map((cat) => (
            <optgroup key={cat} label={cat}>
              {scene.materials
                .filter((m) => m.category === cat)
                .map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
      </label>

      <label className="field color-field">
        <span>Color</span>
        <input
          type="color"
          value={part.color ?? material?.color ?? '#cfcfcf'}
          onChange={(e) => update({ color: e.target.value })}
        />
      </label>

      <NumberField label="Quantity" value={part.quantity} onChange={(v) => update({ quantity: Math.max(0, v) })} />
      <NumberField
        label="Rotation (deg)"
        min={-360}
        value={(part.rotation * 180) / Math.PI}
        onChange={(v) => update({ rotation: (v * Math.PI) / 180 })}
      />
      <NumberField
        label={`Length (${unit})`}
        value={mmToDisplay(part.dimensions.length, unit)}
        onChange={(v) => update({ dimensions: { ...part.dimensions, length: displayToMm(v, unit) } })}
      />
      <NumberField
        label={`Width (${unit})`}
        value={mmToDisplay(part.dimensions.width, unit)}
        onChange={(v) => update({ dimensions: { ...part.dimensions, width: displayToMm(v, unit) } })}
      />
      <NumberField
        label={`Thickness (${unit})`}
        value={mmToDisplay(part.dimensions.thickness, unit)}
        onChange={(v) => update({ dimensions: { ...part.dimensions, thickness: displayToMm(v, unit) } })}
      />
      <div className="muted small">
        Board footprint: {formatLength(part.size.x, unit, precision)} × {formatLength(part.size.y, unit, precision)}{' '}
        — drag the corner on the board to change
      </div>

      <div className="meta">
        <div>
          <span className="muted small">Kind</span>
          <div>{kind?.label ?? (part.kindId === 'custom' ? 'Custom' : part.kindId)}</div>
        </div>
        {material && (
          <div>
            <span className="muted small">Uses</span>
            <div>
              {formatQty(materialQuantity(material, part), material.unitLabel)} ·{' '}
              {formatCurrency(materialQuantity(material, part) * material.costPerUnit)}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
