import { Fragment, useMemo } from 'react';
import {
  computeBom,
  computeCutList,
  computeStockPlan,
  materialCategories,
  purchaseTotal,
  type StockLinearLayout,
  type StockLine,
  type StockSheetLayout,
} from '../domain/bom';
import { formatCurrency, formatLength, formatQty, mmToDisplay, roundTo } from '../domain/format';
import type { Unit } from '../domain/types';
import type { Scene } from '../engine/scene';

const LINEAR_PALETTE = ['#9e7bb8', '#7392c7', '#6bae8c', '#d19e6b', '#c77a70'];

function SheetPreview({ sheet, unit, precision }: { sheet: StockSheetLayout; unit: Unit; precision: number }) {
  const scale = Math.min(150 / sheet.length, 108 / sheet.width);
  const w = Math.max(1, Math.round(sheet.length * scale));
  const h = Math.max(1, Math.round(sheet.width * scale));
  const fmtLen = (mm: number) => `${roundTo(mmToDisplay(mm, unit), precision)} ${unit}`;
  return (
    <figure className="nest-sheet">
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img">
        <rect x={0.5} y={0.5} width={w - 1} height={h - 1} fill="#fff" stroke="#b9b4ab" strokeWidth={1} />
        {sheet.offcuts.map((o, i) => (
          <rect
            key={`o${i}`}
            x={o.x * scale}
            y={o.y * scale}
            width={o.w * scale}
            height={o.h * scale}
            fill="none"
            stroke="#d8d2c6"
            strokeWidth={0.8}
            strokeDasharray="3 2"
          />
        ))}
        {sheet.placed.map((p, i) => {
          const px = p.x * scale;
          const py = (sheet.width - p.y - p.h) * scale;
          const pw = Math.max(1, p.w * scale);
          const ph = Math.max(1, p.h * scale);
          return (
            <g key={i}>
              <rect x={px} y={py} width={pw} height={ph} fill={p.color} stroke="#5a524a" strokeWidth={0.5} />
              {Math.min(pw, ph) > 26 && (
                <text x={px + pw / 2} y={py + ph / 2 + 2} textAnchor="middle" fontSize={Math.min(9, Math.min(pw, ph) / 5)} fill="#1d1712">
                  {p.label}
                  {p.rotated ? ' \u21bb' : ''}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <figcaption className="muted small">
        {fmtLen(sheet.length)} × {fmtLen(sheet.width)} · {sheet.placed.length} cut{sheet.placed.length === 1 ? '' : 's'}
      </figcaption>
    </figure>
  );
}

function LinearPreview({ layout, unit, precision }: { layout: StockLinearLayout; unit: Unit; precision: number }) {
  const bars = layout.lengths.slice(0, 8);
  const barW = 240;
  return (
    <div className="nest-linear">
      {bars.map((b, i) => (
        <div key={i} className="nest-bar">
          <span className="nest-bar-label muted small">L{i + 1}</span>
          <svg width={barW} height={18} role="img" aria-label={`Length ${i + 1}`}>
            <rect x={0} y={0} width={barW} height={18} rx={2} fill="#f2efe9" stroke="#b9b4ab" strokeWidth={1} />
            {b.cuts.map((c, j) => (
              <rect
                key={j}
                x={(c.from / b.stockLength) * barW}
                y={1.5}
                width={Math.max(1, (c.length / b.stockLength) * barW)}
                height={15}
                rx={1}
                fill={LINEAR_PALETTE[j % LINEAR_PALETTE.length]}
              >
                <title>{`${c.label || 'cut'}: ${roundTo(mmToDisplay(c.length, unit), precision)} ${unit}`}</title>
              </rect>
            ))}
          </svg>
          <span className="muted small">{Math.round((b.waste / b.stockLength) * 100)}% left</span>
        </div>
      ))}
      {layout.lengths.length > bars.length && <div className="muted small">+{layout.lengths.length - bars.length} more lengths</div>}
    </div>
  );
}

function StockLayout({ line, unit, precision, scene }: { line: StockLine; unit: Unit; precision: number; scene: Scene }) {
  if (!line.sheets && !line.linear) return null;
  const sheetCount = (line.sheets ?? []).reduce((s, sh) => s + sh.offcuts.length, 0);
  const linearCount = (line.linear?.lengths ?? []).filter((n) => Math.round(n.waste) > 0).length;
  const total = sheetCount + linearCount;
  return (
    <tr className="stock-layout-row">
      <td colSpan={4}>
        {line.sheets && (
          <div className="nest-sheets">
            {line.sheets.slice(0, 6).map((s, i) => (
              <SheetPreview key={i} sheet={s} unit={unit} precision={precision} />
            ))}
            {line.sheets.length > 6 && <div className="muted small">+{line.sheets.length - 6} more sheets</div>}
          </div>
        )}
        {line.linear && <LinearPreview layout={line.linear} unit={unit} precision={precision} />}
        {total > 0 && (
          <button className="btn small" title="Save these leftover pieces to your scrap log" onClick={() => scene.captureOffcuts(line)}>
            + Save {total} offcut{total === 1 ? '' : 's'} to scrap
          </button>
        )}
      </td>
    </tr>
  );
}

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

  const stockDetail = (l: StockLine): string => {
    const kern = (l.kerf ?? 0) > 0 ? ` · kerf ${roundTo(mmToDisplay(l.kerf!, unit), precision)} ${unit}` : '';
    return `${stockSize(l)}${kern}`;
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
                    <Fragment key={l.materialId}>
                      <tr>
                        <td>
                          {l.name}
                          <div className="muted small">{stockDetail(l)}</div>
                        </td>
                        <td className="num">{l.pieces}</td>
                        <td className="num">{`${roundTo(l.wastePct, 0)}%`}</td>
                        <td className="num">{formatCurrency(l.cost)}</td>
                      </tr>
                      <StockLayout line={l} unit={unit} precision={precision} scene={scene} />
                    </Fragment>
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
