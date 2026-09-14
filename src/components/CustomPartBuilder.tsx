import { displayToMm, mmToDisplay } from '../domain/format';
import { materialCategories } from '../domain/bom';
import type { CustomPartSpec } from '../engine/canvasEngine';
import type { MaterialRole, Measure, PartShape } from '../domain/types';
import type { Scene } from '../engine/scene';

interface Props {
  scene: Scene;
  spec: CustomPartSpec;
  onChange: (spec: CustomPartSpec) => void;
}

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input type="number" min={0} value={Math.round(value * 10) / 10} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}

const CUSTOM = '__custom__';
const UNIT_LABELS: { value: Measure; label: string; unit: string }[] = [
  { value: 'linear', label: 'Length (per metre)', unit: 'm' },
  { value: 'area', label: 'Area (per m²)', unit: 'm2' },
  { value: 'count', label: 'Per piece', unit: 'pc' },
];

const SHAPES: { value: PartShape; label: string }[] = [
  { value: 'rect', label: 'Rectangle' },
  { value: 'circle', label: 'Circle' },
  { value: 'triangle', label: 'Triangle' },
  { value: 'line', label: 'Line / rod' },
];

const ROLES: { value: MaterialRole; label: string }[] = [
  { value: 'stock', label: 'Stock (cut)' },
  { value: 'fixing', label: 'Fixing' },
  { value: 'finish', label: 'Finish' },
];

export function CustomPartBuilder({ scene, spec, onChange }: Props) {
  const unit = scene.profile.displayUnit;
  const custom = spec.materialId === CUSTOM;

  const pickCustom = () => {
    onChange({
      ...spec,
      materialId: CUSTOM,
      customMaterial: {
        id: '__custom__',
        name: 'Custom material',
        category: 'Custom',
        role: 'stock',
        measure: 'count',
        costPerUnit: 1,
        unitLabel: 'pc',
        color: spec.color ?? '#888888',
      },
    });
  };

  const pickProfile = (id: string) => {
    onChange({ ...spec, materialId: id, customMaterial: undefined });
  };

  return (
    <section className="panel">
      <h2>Custom part</h2>
      <label className="field">
        <span>Label</span>
        <input value={spec.label} onChange={(e) => onChange({ ...spec, label: e.target.value })} />
      </label>

      <label className="field">
        <span>Material</span>
        <select
          value={spec.materialId}
          onChange={(e) => (e.target.value === CUSTOM ? pickCustom() : pickProfile(e.target.value))}
        >
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
          <option value={CUSTOM}>Custom material…</option>
        </select>
      </label>

      {custom && spec.customMaterial && (
        <div className="custom-material">
          <label className="field">
            <span>Name</span>
            <input
              value={spec.customMaterial.name}
              onChange={(e) => onChange({ ...spec, customMaterial: { ...spec.customMaterial!, name: e.target.value } })}
            />
          </label>
          <label className="field">
            <span>Measure</span>
            <select
              value={spec.customMaterial.measure}
              onChange={(e) => {
                const measure = e.target.value as Measure;
                const item = UNIT_LABELS.find((u) => u.value === measure);
                onChange({
                  ...spec,
                  customMaterial: {
                    ...spec.customMaterial!,
                    measure,
                    unitLabel: item?.unit ?? 'pc',
                  },
                });
              }}
            >
              {UNIT_LABELS.map((u) => (
                <option key={u.value} value={u.value}>
                  {u.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Role</span>
            <select
              value={spec.customMaterial.role}
              onChange={(e) =>
                onChange({
                  ...spec,
                  customMaterial: { ...spec.customMaterial!, role: e.target.value as MaterialRole },
                })
              }
            >
              {ROLES.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>
          <NumberField
            label="Cost per unit"
            value={spec.customMaterial.costPerUnit}
            onChange={(v) => onChange({ ...spec, customMaterial: { ...spec.customMaterial!, costPerUnit: v } })}
          />
          <label className="field color-field">
            <span>Material color</span>
            <input
              type="color"
              value={spec.customMaterial.color ?? '#888888'}
              onChange={(e) =>
                onChange({ ...spec, customMaterial: { ...spec.customMaterial!, color: e.target.value } })
              }
            />
          </label>
        </div>
      )}

      <label className="field">
        <span>Shape</span>
        <select value={spec.shape ?? 'rect'} onChange={(e) => onChange({ ...spec, shape: e.target.value as PartShape })}>
          {SHAPES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </label>

      <label className="field color-field">
        <span>Part color</span>
        <input
          type="color"
          value={spec.color ?? scene.material(spec.materialId)?.color ?? '#cfcfcf'}
          onChange={(e) => onChange({ ...spec, color: e.target.value })}
        />
      </label>

      <NumberField
        label={`Length (${unit})`}
        value={mmToDisplay(spec.length, unit)}
        onChange={(v) => onChange({ ...spec, length: displayToMm(v, unit) })}
      />
      <NumberField
        label={`Width (${unit})`}
        value={mmToDisplay(spec.width, unit)}
        onChange={(v) => onChange({ ...spec, width: displayToMm(v, unit) })}
      />
      <NumberField
        label={`Thickness (${unit})`}
        value={mmToDisplay(spec.thickness, unit)}
        onChange={(v) => onChange({ ...spec, thickness: displayToMm(v, unit) })}
      />
      <NumberField label="Quantity" value={spec.quantity} onChange={(v) => onChange({ ...spec, quantity: Math.max(0, v) })} />

      <p className="muted small" style={{ marginTop: 8 }}>
        Drag on the board to draw it, or click to place at the size above.
      </p>
    </section>
  );
}