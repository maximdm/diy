import { useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import type { Tool } from '../engine/canvasEngine';
import { Icon } from './Icon';
import { TOOLS } from './Toolbar';

interface Props {
  tool: Tool;
  onTool: (tool: Tool) => void;
}

interface Offset {
  left: number;
  bottom: number;
}

const DEFAULT_POS: Offset = { left: 14, bottom: 14 };
const EDGE = 8;
const DRAG_SLOP = 3;
const FAB = 46;
const ITEM = 42;
const RADIUS = 58;
const HALF = RADIUS + ITEM / 2 + 6;

export function FloatingTools({ tool, onTool }: Props) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<Offset | null>(null);
  const [dragging, setDragging] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ px: number; py: number; left: number; bottom: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const active = TOOLS.find((t) => t.id === tool) ?? TOOLS[0];

  const onDown = (e: ReactPointerEvent<HTMLButtonElement>): void => {
    if (e.button !== 0) return;
    drag.current = { px: e.clientX, py: e.clientY, ...(pos ?? DEFAULT_POS), moved: false };
    setDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onMove = (e: ReactPointerEvent<HTMLButtonElement>): void => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.px;
    const dy = e.clientY - d.py;
    if (!d.moved && (Math.abs(dx) > DRAG_SLOP || Math.abs(dy) > DRAG_SLOP)) d.moved = true;
    if (!d.moved) return;
    const wrapW = wrapRef.current?.clientWidth ?? 0;
    const wrapH = wrapRef.current?.clientHeight ?? 0;
    const w = e.currentTarget.offsetWidth;
    const h = e.currentTarget.offsetHeight;
    const left = Math.min(Math.max(EDGE, d.left + dx), Math.max(EDGE, wrapW - w - EDGE));
    const bottom = Math.min(Math.max(EDGE, d.bottom - dy), Math.max(EDGE, wrapH - h - EDGE));
    setPos({ left, bottom });
  };

  const onUp = (e: ReactPointerEvent<HTMLButtonElement>): void => {
    const d = drag.current;
    drag.current = null;
    setDragging(false);
    if (d?.moved) suppressClick.current = true;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const wrapW = wrapRef.current?.clientWidth ?? 0;
  const wrapH = wrapRef.current?.clientHeight ?? 0;
  const base = pos ?? DEFAULT_POS;
  const fabCx = base.left + FAB / 2;
  const fabCy = wrapH - base.bottom - FAB / 2;
  const cx = Math.min(Math.max(fabCx, HALF), Math.max(HALF, wrapW - HALF));
  const cy = Math.min(Math.max(fabCy, HALF), Math.max(HALF, wrapH - HALF));

  const clickItem = (id: Tool): void => {
    onTool(id);
    setOpen(false);
  };

  return (
    <div className="fab-wrap" ref={wrapRef}>
      {open && <div className="fab-backdrop" onClick={() => setOpen(false)} />}
      {open && (
        <div
          className="fab-radial"
          style={{ width: HALF * 2, height: HALF * 2, left: cx - HALF, top: cy - HALF }}
        >
          {TOOLS.map((t, i) => {
            const angle = -Math.PI / 2 + (i / TOOLS.length) * Math.PI * 2;
            const tx = Math.cos(angle) * RADIUS;
            const ty = Math.sin(angle) * RADIUS;
            return (
              <button
                key={t.id}
                type="button"
                role="menuitem"
                className={t.id === tool ? 'fab-radial-item active' : 'fab-radial-item'}
                style={{ '--tx': `${tx}px`, '--ty': `${ty}px`, '--i': i } as CSSProperties}
                title={t.hint}
                onClick={() => clickItem(t.id)}
              >
                <Icon name={t.icon} />
              </button>
            );
          })}
        </div>
      )}
      <button
        type="button"
        className={open ? 'fab active dragging' : dragging ? 'fab dragging' : 'fab'}
        style={pos ?? undefined}
        title={`Active tool: ${active.label} — click for tools, drag to move`}
        aria-haspopup="menu"
        aria-expanded={open}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onClick={() => {
          if (suppressClick.current) {
            suppressClick.current = false;
            return;
          }
          setOpen((o) => !o);
        }}
      >
        <Icon name={active.icon} />
      </button>
    </div>
  );
}