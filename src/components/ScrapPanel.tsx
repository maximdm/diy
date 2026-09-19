import { useMemo, type ReactNode } from 'react';
import { fitTemplates } from '../domain/scraps';
import { displayToMm, mmToDisplay, roundTo } from '../domain/format';
import { materialCategories } from '../domain/bom';
import type { ScrapItem } from '../domain/types';
import type { Scene } from '../engine/scene';
import { loadInventory } from '../engine/persistence';

interface Props {
  scene: Scene;
  version: number;
  onStartTemplate: (id: string) => void;
}

function sameScrap(a: ScrapItem, b: ScrapItem): boolean {
  return (
    a.materialId === b.materialId &&
    a.length === b.length &&
    a.width === b.width &&
    a.thickness === b.thickness &&
    a.quantity === b.quantity
  );
}

function defaultScrap(scene: Scene): Omit<ScrapItem, 'id'> {
  const stock = scene.materials.find((m) => m.measure !== 'count');
  const m = stock ?? scene.materials[0];
  const linear = m?.measure === 'linear';
  const area = m?.measure === 'area';
  return {
    materialId: m?.id ?? '',
    length: linear ? 1200 : area ? 500 : 0,
    width: area ? 400 : 0,
    thickness: 0,
    quantity: 1,
    note: '',
    source: 'manual',
  };
}

function NumField({
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
    <label className="field scrap-num">
      <span>{label}</span>
      <input
        type="number"
        min={min}
        value={Number.isFinite(value) ? roundTo(value, 1) : 0}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}

function ScrapRow({ scene, item }: { scene: Scene; item: ScrapItem }) {
  const unit = scene.displayUnit;
  const m = scene.material(item.materialId);
  const measure = m?.measure ?? 'count';
  const categoryRows = materialCategories(scene.materials);

  const changeMaterial = (id: string): void => {
    const next = scene.material(id);
    const patch: Partial<ScrapItem> = { materialId: id };
    if (next) {
      const linear = next.measure === 'linear';
      const area = next.measure === 'area';
      patch.length = linear ? 1200 : area ? 500 : 0;
      patch.width = area ? 400 : 0;
      patch.thickness = 0;
    }
    scene.updateScrap(item.id, patch);
  };

  const mmField = (key: 'length' | 'width' | 'thickness', label: string): ReactNode => (
    <NumField label={`${label} (${unit})`} value={mmToDisplay(item[key], unit)} onChange={(v) => scene.updateScrap(item.id, { [key]: displayToMm(v, unit) })} />
  );

  return (
    <div className="scrap-row">
      <select className="select scrap-material" value={item.materialId} onChange={(e) => changeMaterial(e.target.value)}>
        {categoryRows.map((cat) => (
          <optgroup key={cat} label={cat}>
            {scene.materials
              .filter((mm) => mm.category === cat)
              .map((mm) => (
                <option key={mm.id} value={mm.id}>
                  {mm.name}
                </option>
              ))}
          </optgroup>
        ))}
      </select>
      <div className="scrap-dims">
        {measure === 'linear' && (
          <>
            {mmField('length', 'Length')}
            {mmField('width', 'Width')}
            {mmField('thickness', 'Thick')}
          </>
        )}
        {measure === 'area' && (
          <>
            {mmField('length', 'Length')}
            {mmField('width', 'Width')}
            {mmField('thickness', 'Thick')}
          </>
        )}
      </div>
      {measure === 'count' ? (
        <div className="scrap-dims">
          <NumField label="Qty" value={item.quantity} min={1} onChange={(v) => scene.updateScrap(item.id, { quantity: Math.max(0, Math.round(v)) })} />
        </div>
      ) : (
        <label className="field scrap-num">
          <span>Qty</span>
          <input type="number" min={1} value={item.quantity} onChange={(e) => scene.updateScrap(item.id, { quantity: Math.max(0, Math.round(Number(e.target.value))) })} />
        </label>
      )}
      {item.source === 'offcut' && <span className="scrap-chip" title="Captured from a cut layout">offcut</span>}
      <button className="btn danger small" title="Remove scrap" onClick={() => scene.removeScrap(item.id)}>
        ×
      </button>
      {measure === 'count' && (
        <input className="scrap-note" placeholder="Box of screws, spare motor…" value={item.note ?? ''} onChange={(e) => scene.updateScrap(item.id, { note: e.target.value })} />
      )}
    </div>
  );
}

export function ScrapPanel({ scene, version, onStartTemplate }: Props) {
  const fits = useMemo(() => fitTemplates(scene.materials, scene.scraps, scene.templates), [scene, version]);
  const inventory = useMemo(() => loadInventory(), []);
  const importable = useMemo(() => inventory.filter((inv) => !scene.scraps.some((s) => sameScrap(s, inv))), [inventory, scene.scraps]);

  const importInventory = (): void => {
    for (const it of importable) {
      const { id: _id, ...rest } = it;
      scene.addScrap(rest);
    }
  };

  return (
    <section className="panel">
      <h2>Scrap &amp; ideas</h2>
      <p className="muted small">Leftover stock you already own. The cut layouts can add offcuts automatically.</p>
      {importable.length > 0 && (
        <button className="btn small" onClick={importInventory}>
          Import {importable.length} scrap{importable.length === 1 ? '' : 's'} from browser inventory
        </button>
      )}
      <div className="scrap-list">
        {scene.scraps.map((s) => (
          <ScrapRow key={s.id} scene={scene} item={s} />
        ))}
      </div>
      {scene.scraps.length === 0 && <p className="muted small">No scraps logged yet.</p>}
      <button className="btn small" onClick={() => scene.addScrap(defaultScrap(scene))}>
        + Add scrap
      </button>

      <h2>Build from scraps</h2>
      {scene.scraps.length === 0 ? (
        <p className="muted small">Log leftover material to see what you can build from it.</p>
      ) : fits.length === 0 ? (
        <p className="muted small">No templates from scraps yet — add bigger pieces or log more material.</p>
      ) : (
        <ul className="scrap-ideas">
          {fits.map((f) => {
            const buildable = f.buildable;
            return (
              <li key={f.templateId} className={`scrap-idea${buildable ? ' buildable' : ''}`}>
                <div className="scrap-idea-head">
                  <strong>{f.name}</strong>
                  {buildable ? (
                    <span className="scrap-chip ok">fits your scraps</span>
                  ) : (
                    <span className="scrap-chip">{Math.round(f.fraction * 100)}% fits</span>
                  )}
                </div>
                <div className="muted small">
                  {buildable
                    ? `${f.totalPieces} pieces cut from your scraps`
                    : `${f.fittingPieces}/${f.totalPieces} pieces fit`}
                  {f.missing.length > 0 && ` · need ${f.missing.join(', ')}`}
                </div>
                <button className="btn small" disabled={!buildable} title={buildable ? 'Add these parts to the board' : 'Not all pieces fit your scraps'} onClick={() => onStartTemplate(f.templateId)}>
                  {buildable ? '+ Start with these parts' : `Need ${f.missing.join(', ')}`}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}