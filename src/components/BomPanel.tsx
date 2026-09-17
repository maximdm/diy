import { Fragment, useMemo } from 'react';
import { computeBom, computeCutList, computeStockPlan, materialCategories, purchaseTotal } from '../domain/bom';
import { formatCurrency, formatLength, formatQty, mmToDisplay, roundTo } from '../domain/format';
import type { Scene } from '../engine/scene';

interface Props {
  scene: Scene;
  version: number;
}

export function BomPanel({ scene, version }: Props) {
  const { lines, cuts, stock, total } = useMemo(() => {
    const parts = scene.parts;
    const materials = scene.materials;
    const bom = computeBom(materials, parts);
    const plan = computeStockPlan(materials, parts);
    return {
      lines: bom,
      cuts: computeCutList(materials, parts),
      stock: plan,
      total: purchaseTotal(bom, plan),
    };
  }, [scene, version]);
  const unit = scene.displayUnit;
  const precision = scene.displayPrecision;
  const dims = (c: { length: number; width: number; thickness: number }) =>
    `${mmToDisplay(c.length, unit).toFixed(precision)} x ${mmToDisplay(c.width, unit).toFixed(precision)} x ${mmToDisplay(c.thickness, unit).toFixed(precision)} ${unit}`;

  const categories = materialCategories(scene.materials);

  const stockSize = (l: { optionLength: number; optionWidth?: number }): string => {
    const L = roundTo(mmToDisplay(l.optionLength, unit), precision);
    if (l.optionWidth != null) return `${L} x ${roundTo(mmToDisplay(l.optionWidth, unit), precision)} ${unit}`;
    return `${L} ${unit}`;
  };

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
                <Fragment key={`cat-${cat}`}>
                  <tr key={`cat-head-${cat}`} className="category">
                    <td colSpan={3}>{cat}</td>
                  </tr>
                  {group.map((l) => (
                    <tr key={l.materialId}>
                      <td>{l.name}</td>
                      <td className="num">{formatQty(l.qty, l.unitLabel)}</td>
                      <td className="num">{formatCurrency(l.cost)}</td>
                      </tr>
                  ))}
                </Fragment>
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

      <h2>Stock plan</h2>
      {stock.length === 0 ? (
        <p className="muted">Set standard stock sizes in a material to see how much to buy.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Buy</th>
              <th className="num">Pieces</th>
              <th className="num">Waste</th>
              <th className="num">Cost</th>
            </tr>
          </thead>
          <tbody>
            {categories.map((cat) => {
              const group = stock.filter((l) => l.category === cat);
              if (group.length === 0) return null;
              return (
                <>
                  <tr key={`stock-cat-${cat}`} className="category">
                    <td colSpan={4}>{cat}</td>
                  </tr>
                  {group.map((l) => (
                    <tr key={l.materialId}>
                      <td>
                        {l.name}
                        <div className="muted small">{stockSize(l)}</div>
                      </td>
                      <td className="num">{l.pieces}</td>
                      <td className="num">{`${roundTo(l.wastePct, 0)}%`}</td>
                      <td className="num">{formatCurrency(l.cost)}</td>
                    </tr>
                  ))}
                </>
              );
            })}
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
                <Fragment key={`cuts-${cat}`}>
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
                </Fragment>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}
