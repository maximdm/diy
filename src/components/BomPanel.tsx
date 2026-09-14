import { useMemo } from 'react';
import { bomTotal, computeBom, computeCutList, materialCategories } from '../domain/bom';
import { formatCurrency, formatLength, formatQty, mmToDisplay } from '../domain/format';
import type { Scene } from '../engine/scene';

interface Props {
  scene: Scene;
  version: number;
}

export function BomPanel({ scene, version }: Props) {
  const { lines, cuts, total } = useMemo(() => {
    const parts = scene.parts;
    const materials = scene.materials;
    return {
      lines: computeBom(materials, parts),
      cuts: computeCutList(materials, parts),
      total: bomTotal(computeBom(materials, parts)),
    };
  }, [scene, version]);
  const unit = scene.profile.displayUnit;
  const precision = scene.profile.precision;
  const dims = (c: { length: number; width: number; thickness: number }) =>
    `${mmToDisplay(c.length, unit).toFixed(precision)} x ${mmToDisplay(c.width, unit).toFixed(precision)} x ${mmToDisplay(c.thickness, unit).toFixed(precision)} ${unit}`;

  const categories = materialCategories(scene.materials);

  return (
    <section className="panel">
      <h2>Materials</h2>
      {lines.length === 0 ? (
        <p className="muted">Add parts to build the list.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Material</th>
              <th className="num">Qty</th>
              <th className="num">Cost</th>
            </tr>
          </thead>
          <tbody>
            {categories.map((cat) => {
              const group = lines.filter((l) => l.category === cat);
              if (group.length === 0) return null;
              return (
                <>
                  <tr key={`cat-${cat}`} className="category">
                    <td colSpan={3}>{cat}</td>
                  </tr>
                  {group.map((l) => (
                    <tr key={l.materialId}>
                      <td>{l.name}</td>
                      <td className="num">{formatQty(l.qty, l.unitLabel)}</td>
                      <td className="num">{formatCurrency(l.cost)}</td>
                    </tr>
                  ))}
                </>
              );
            })}
            <tr className="total">
              <td>Total</td>
              <td className="num" />
              <td className="num">{formatCurrency(total)}</td>
            </tr>
          </tbody>
        </table>
      )}

      <h2>Cut list</h2>
      {cuts.length === 0 ? (
        <p className="muted">Timber and panel cuts appear here.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Piece</th>
              <th className="num">Length</th>
              <th className="num">Qty</th>
            </tr>
          </thead>
          <tbody>
            {categories.map((cat) => {
              const group = cuts.filter((c) => c.category === cat);
              if (group.length === 0) return null;
              return (
                <>
                  <tr key={`cut-cat-${cat}`} className="category">
                    <td colSpan={3}>{cat}</td>
                  </tr>
                  {group.map((c) => (
                    <tr key={`${c.materialId}-${c.length}-${c.width}-${c.thickness}`}>
                      <td>
                        {c.name}
                        <div className="muted small">{dims(c)}</div>
                      </td>
                      <td className="num">{formatLength(c.length, unit, precision)}</td>
                      <td className="num">{c.count}</td>
                    </tr>
                  ))}
                </>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}
