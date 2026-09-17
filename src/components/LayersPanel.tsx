import { useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { formatLength } from '../domain/format';
import type { Part, PartLayer } from '../domain/types';
import type { Scene } from '../engine/scene';
import { Icon } from './Icon';

interface Props {
  scene: Scene;
  version: number;
  onFocus: (id: string) => void;
}

interface Group {
  id: string;
  name: string;
  layerId: string | null;
  visible: boolean;
  locked: boolean;
  parts: Part[];
}

const UNGROUPED: Group['id'] = '__ungrouped__';

export function LayersPanel({ scene, version, onFocus }: Props) {
  const unit = scene.displayUnit;
  const precision = scene.displayPrecision;
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const draftRef = useRef<HTMLInputElement>(null);
  const [editingPart, setEditingPart] = useState<string | null>(null);
  const [partDraft, setPartDraft] = useState('');
  const partDraftRef = useRef<HTMLInputElement>(null);
  const [assignTo, setAssignTo] = useState('');

  const groups = useMemo<Group[]>(() => {
    const rows: Group[] = scene.layers.map((l) => ({
      id: l.id,
      name: l.name,
      layerId: l.id,
      visible: l.visible,
      locked: l.locked ?? false,
      parts: scene.partsInLayer(l.id),
    }));
    rows.push({
      id: UNGROUPED,
      name: 'Ungrouped',
      layerId: null,
      visible: true,
      locked: false,
      parts: scene.partsInLayer(null),
    });
    return rows;
  }, [scene, version]);

  const q = query.trim().toLowerCase();
  const matches = useMemo(() => {
    if (!q) return null;
    const out: { part: Part; badge: string; visible: boolean; locked: boolean }[] = [];
    for (const g of groups) {
      for (const p of g.parts) {
        const kind = scene.kind(p.kindId);
        const mat = scene.material(p.materialId);
        const hay = [p.label, kind?.label, mat?.name, g.name].filter(Boolean).join(' ').toLowerCase();
        if (hay.includes(q)) out.push({ part: p, badge: g.layerId ? g.name : '—', visible: g.visible, locked: g.locked });
      }
    }
    return out;
  }, [q, groups, scene]);

  const selectedIds = scene.selectedPartIds;
  const selectedCount = selectedIds.length;

  const toggleGroup = (id: string): void => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const startRename = (layer: PartLayer): void => {
    setEditing(layer.id);
    setDraft(layer.name);
    requestAnimationFrame(() => draftRef.current?.focus());
  };

  const commitRename = (): void => {
    if (editing) {
      const name = draft.trim();
      if (name && name !== scene.layerById(editing)?.name) scene.updateLayer(editing, { name });
    }
    setEditing(null);
  };

  const onRenameKey = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') commitRename();
    if (e.key === 'Escape') setEditing(null);
  };

  const startPartRename = (p: Part): void => {
    setEditingPart(p.id);
    setPartDraft(p.label);
    requestAnimationFrame(() => partDraftRef.current?.focus());
  };

  const commitPartRename = (): void => {
    if (editingPart) {
      const name = partDraft.trim();
      const current = scene.partById(editingPart);
      if (name && current && name !== current.label) scene.updatePart(editingPart, { label: name });
    }
    setEditingPart(null);
  };

  const onPartRenameKey = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') commitPartRename();
    if (e.key === 'Escape') setEditingPart(null);
  };

  const openPart = (id: string, e: MouseEvent): void => {
    if (e.ctrlKey || e.metaKey || e.shiftKey) scene.togglePartSelected(id);
    else onFocus(id);
  };

  const dimsOf = (p: Part): string =>
    `${formatLength(p.dimensions.length, unit, precision)} × ${formatLength(p.dimensions.width, unit, precision)}`;

  const dot = (p: Part): string => p.color ?? scene.material(p.materialId)?.color ?? '#cfcfcf';

  const assign = (layerId: string | null): void => {
    if (selectedCount === 0) return;
    scene.setPartsLayer(selectedIds, layerId);
  };

  const applyAssignSelect = (v: string): void => {
    if (!v || selectedCount === 0) return;
    scene.setPartsLayer(selectedIds, v === '__none__' ? null : v);
    setAssignTo('');
  };

  const groupSelectionAsLayer = (): void => {
    const layer = scene.addLayer();
    scene.setPartsLayer(selectedIds, layer.id);
  };

  const partRow = (p: Part, visible: boolean, on: boolean, locked: boolean, badge?: string): ReactNode => (
    <div
      key={p.id}
      className={`part-row${on && !locked ? ' sel' : ''}${!visible ? ' off' : ''}${locked ? ' locked' : ''}`}
      role="button"
      tabIndex={0}
      onClick={(e) => {
        if (!locked) openPart(p.id, e);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !locked) onFocus(p.id);
      }}
      title={locked ? 'Locked layer — unlock to edit this part' : 'Click to find on the board · double-click the name to rename'}
    >
      <span className="part-dot" style={{ background: dot(p) }} />
      {editingPart === p.id && !locked ? (
        <input
          ref={partDraftRef}
          className="part-rename"
          value={partDraft}
          onChange={(e) => setPartDraft(e.target.value)}
          onBlur={commitPartRename}
          onKeyDown={onPartRenameKey}
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <span
          className="part-name"
          onDoubleClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            startPartRename(p);
          }}
        >
          {p.label}
        </span>
      )}
      <span className="part-dims">{dimsOf(p)}</span>
      {badge && <span className="layer-badge">{badge}</span>}
      <span className="part-row-actions">
        <button
          type="button"
          className="icon-btn"
          title="Rename part"
          disabled={locked}
          onClick={(e) => {
            e.stopPropagation();
            startPartRename(p);
          }}
        >
          <Icon name="pencil" />
        </button>
        <button
          type="button"
          className="icon-btn"
          title="Delete part"
          disabled={locked}
          onClick={(e) => {
            e.stopPropagation();
            scene.removePart(p.id);
          }}
        >
          <Icon name="trash" />
        </button>
      </span>
    </div>
  );

  return (
    <section className="panel">
      <div className="layer-head">
        <h2>Layers</h2>
        <button type="button" className="icon-btn" title="New layer" onClick={() => scene.addLayer()}>
          <Icon name="plus" />
        </button>
      </div>

      <label className="layer-search">
        <Icon name="search" />
        <input
          value={query}
          placeholder="Find a part…"
          onChange={(e) => setQuery(e.target.value)}
          spellCheck={false}
        />
        {query && (
          <button type="button" className="layer-search-clear" title="Clear search" onClick={() => setQuery('')}>
            ✕
          </button>
        )}
      </label>

      {selectedCount > 0 &&
        (scene.layers.length === 0 ? (
          <button type="button" className="layer-assign-new" onClick={groupSelectionAsLayer}>
            Group {selectedCount} selected part{selectedCount > 1 ? 's' : ''} into a new layer
          </button>
        ) : (
          <label className="layer-assign">
            <span>
              {selectedCount} selected
            </span>
            <select value={assignTo} onChange={(e) => applyAssignSelect(e.target.value)}>
              <option value="">Add to a layer…</option>
              {scene.layers.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
              <option value="__none__">Ungrouped</option>
            </select>
          </label>
        ))}

      {scene.parts.length === 0 ? (
        <p className="muted">Add parts to group them into layers.</p>
      ) : matches ? (
        matches.length === 0 ? (
          <p className="muted">No parts match “{query}”.</p>
        ) : (
          <div className="layer-list">{matches.map((m) => partRow(m.part, m.visible, scene.isPartSelected(m.part.id), m.locked, m.badge))}</div>
        )
      ) : (
        <div className="layer-list">
          {groups.map((g) => {
            const open = !collapsed.has(g.id);
            return (
              <div key={g.id} className="layer-group">
                <div className={`layer-row${g.visible ? '' : ' off'}${g.locked ? ' locked' : ''}`}>
                  <button
                    type="button"
                    className="icon-btn"
                    title={open ? 'Collapse' : 'Expand'}
                    aria-expanded={open}
                    onClick={() => toggleGroup(g.id)}
                  >
                    <span className={open ? 'chev chev-open' : 'chev'}>
                      <Icon name="chevron" />
                    </span>
                  </button>
                  {g.layerId && (
                    <button
                      type="button"
                      className="icon-btn"
                      title={g.visible ? 'Hide layer' : 'Show layer'}
                      onClick={() => g.layerId && scene.setLayerVisible(g.layerId, !g.visible)}
                    >
                      <Icon name={g.visible ? 'eye' : 'eye-off'} />
                    </button>
                  )}
                  {g.layerId && (
                    <>
                      <button
                        type="button"
                        className="icon-btn"
                        title="Move layer up"
                        disabled={g.id === scene.layers[0]?.id}
                        onClick={() => g.layerId && scene.moveLayer(g.id, -1)}
                      >
                        <Icon name="up" />
                      </button>
                      <button
                        type="button"
                        className="icon-btn"
                        title="Move layer down"
                        disabled={g.id === scene.layers[scene.layers.length - 1]?.id}
                        onClick={() => g.layerId && scene.moveLayer(g.id, 1)}
                      >
                        <Icon name="down" />
                      </button>
                      <button
                        type="button"
                        className={`icon-btn${g.locked ? ' is-on' : ''}`}
                        title={g.locked ? 'Unlock layer' : 'Lock layer'}
                        onClick={() => g.layerId && scene.setLayerLocked(g.id, !g.locked)}
                      >
                        <Icon name={g.locked ? 'lock' : 'unlock'} />
                      </button>
                    </>
                  )}
                  {editing === g.id ? (
                    <input
                      ref={draftRef}
                      className="layer-rename"
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onBlur={commitRename}
                      onKeyDown={onRenameKey}
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    <button
                      type="button"
                      className="layer-name"
                      title={
                        g.locked
                          ? 'Layer is locked'
                          : g.layerId
                            ? 'Select all — double-click to rename'
                            : 'Select all ungrouped parts'
                      }
                      onClick={() => !g.locked && g.parts.length && scene.selectParts(g.parts.map((p) => p.id))}
                      onDoubleClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (g.layerId) {
                          const l = scene.layerById(g.layerId);
                          if (l) startRename(l);
                        }
                      }}
                    >
                      <span className="layer-name-text">{g.name}</span>
                      <span className="layer-count">{g.parts.length}</span>
                    </button>
                  )}
                  <button
                    type="button"
                    className="icon-btn"
                    title={selectedCount ? `Add ${selectedCount} selected part${selectedCount > 1 ? 's' : ''} to ${g.name}` : 'Select a part first'}
                    disabled={selectedCount === 0}
                    onClick={() => assign(g.layerId)}
                  >
                    <Icon name="plus" />
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    title="Rename layer"
                    onClick={() => {
                      if (g.layerId) {
                        const l = scene.layerById(g.layerId);
                        if (l) startRename(l);
                      }
                    }}
                  >
                    <Icon name="pencil" />
                  </button>
                  {g.layerId && (
                    <button
                      type="button"
                      className="icon-btn"
                      title={`Delete ${g.name} (parts stay on the board)`}
                      onClick={() => g.layerId && scene.removeLayer(g.layerId)}
                    >
                      <Icon name="trash" />
                    </button>
                  )}
                </div>
                {open && g.parts.length > 0 && (
                  <div className="layer-parts">
                    {g.parts.map((p) => partRow(p, g.visible, scene.isPartSelected(p.id), g.locked))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}