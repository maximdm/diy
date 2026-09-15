import { displayToMm, formatCurrency, formatLength, formatQty, mmToDisplay } from '../domain/format';
import type { Part, PartShape } from '../domain/types';
import { materialCategories, materialQuantity } from '../domain/bom';
import type { Scene } from '../engine/scene';

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
  const part: Part | undefined = scene.selectedPart();
  const note = scene.selectedNote();

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
        <span>Shape</span>
        <select value={part.shape ?? 'rect'} onChange={(e) => update({ shape: e.target.value as PartShape })}>
          <option value="rect">Rectangle</option>
          <option value="circle">Circle</option>
          <option value="triangle">Triangle</option>
          <option value="line">Line / rod</option>
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
