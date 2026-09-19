import { useMemo } from 'react';
import type { Note, NoteContext, Vec2 } from '../domain/types';
import type { Scene } from '../engine/scene';

interface Props {
  scene: Scene;
  version: number;
}

function defaultTitle(ctx: NoteContext, scene: Scene): string {
  if (ctx.kind === 'part') {
    const p = ctx.partId ? scene.partById(ctx.partId) : undefined;
    return p ? (p.quantity > 1 ? `${p.label} x${p.quantity}` : p.label) : 'Part note';
  }
  if (ctx.kind === 'measure') return 'Measurement note';
  return 'Project note';
}

export function TasksPanel({ scene, version }: Props) {
  const notes = useMemo(() => {
    const steps = scene.stepNotes();
    const rest = scene.notes.filter((n) => n.step == null);
    return [...steps, ...rest];
  }, [scene, version]);
  const openCount = useMemo(
    () => notes.reduce((sum, n) => sum + n.items.filter((i) => !i.checked).length, 0),
    [notes],
  );

  const cascadePos = (): Vec2 => {
    const n = scene.notes.length;
    return { x: 120 + (n % 4) * 220, y: 120 + Math.floor(n / 4) * 170 };
  };

  const addNote = (kind: NoteContext['kind']): void => {
    const note = scene.addNote({
      title: '',
      context:
        kind === 'part'
          ? { kind: 'part', partId: scene.parts[0]?.id ?? '' }
          : kind === 'measure'
          ? { kind: 'measure', dimensionId: scene.dimensions[0]?.id ?? '' }
          : { kind: 'general' },
      items: [],
      board: true,
      position: kind === 'general' ? cascadePos() : undefined,
    });
    scene.selectNote(note.id);
  };

  return (
    <section className="panel">
      <h2>Notes{openCount > 0 ? ` · ${openCount} open` : ''}</h2>
      {notes.length === 0 && (
        <p className="muted">No notes yet. Add one below — each note is a checklist of tasks.</p>
      )}
      <div className="note-cards">
        {notes.map((note) => (
          <NoteCard key={note.id} scene={scene} note={note} selected={note.id === scene.selectedNoteId} />
        ))}
      </div>
      <div className="note-add-row">
        <button className="btn" onClick={() => addNote('general')}>
          + General note
        </button>
        <button className="btn" disabled={scene.parts.length === 0} onClick={() => addNote('part')}>
          + On a part
        </button>
        <button className="btn" disabled={scene.dimensions.length === 0} onClick={() => addNote('measure')}>
          + On a measure
        </button>
      </div>
    </section>
  );
}

function NoteCard({ scene, note, selected }: { scene: Scene; note: Note; selected: boolean }) {
  const ctx = note.context;
  const done = note.items.filter((i) => i.checked).length;
  const stepNotes = scene.notes.filter((n) => n.step != null).sort((a, b) => (a.step ?? 0) - (b.step ?? 0));
  const stepIndex = stepNotes.findIndex((n) => n.id === note.id);
  const isStep = note.step != null;

  const changeContext = (kind: NoteContext['kind']): void => {
    if (kind === 'part') {
      scene.updateNote(note.id, { context: { kind: 'part', partId: scene.parts[0]?.id ?? '' }, board: true });
    } else if (kind === 'measure') {
      scene.updateNote(note.id, { context: { kind: 'measure', dimensionId: scene.dimensions[0]?.id ?? '' }, board: true });
    } else {
      const n = scene.notes.length;
      scene.updateNote(note.id, {
        context: { kind: 'general' },
        board: true,
        position: { x: 120 + (n % 4) * 220, y: 120 + Math.floor(n / 4) * 170 },
      });
    }
  };

  return (
    <div className={selected ? 'note-card selected' : 'note-card'} onClick={() => scene.selectNote(note.id)}>
      <div className="note-card-head">
        <input
          className="note-title"
          value={note.title}
          placeholder={defaultTitle(ctx, scene)}
          onChange={(e) => scene.updateNote(note.id, { title: e.target.value })}
          onClick={(e) => e.stopPropagation()}
        />
        <button
          className="btn danger small"
          title="Delete note"
          onClick={(e) => {
            e.stopPropagation();
            scene.removeNote(note.id);
          }}
        >
          ×
        </button>
      </div>

      <div className="note-about" onClick={(e) => e.stopPropagation()}>
        <select value={ctx.kind} onChange={(e) => changeContext(e.target.value as NoteContext['kind'])}>
          <option value="general">Other / project</option>
          <option value="part">A part</option>
          <option value="measure">A measurement</option>
        </select>
        {ctx.kind === 'part' && (
          <select
            value={ctx.partId ?? ''}
            onChange={(e) => scene.updateNote(note.id, { context: { kind: 'part', partId: e.target.value } })}
          >
            {scene.parts.length === 0 && <option value="">No parts yet</option>}
            {scene.parts.map((p) => (
              <option key={p.id} value={p.id}>
                {p.quantity > 1 ? `${p.label} x${p.quantity}` : p.label}
              </option>
            ))}
          </select>
        )}
        {ctx.kind === 'measure' && (
          <select
            value={ctx.dimensionId ?? ''}
            onChange={(e) => scene.updateNote(note.id, { context: { kind: 'measure', dimensionId: e.target.value } })}
          >
            {scene.dimensions.length === 0 && <option value="">No measurements yet</option>}
            {scene.dimensions.map((d, i) => (
              <option key={d.id} value={d.id}>
                Measurement {i + 1}
              </option>
            ))}
          </select>
        )}
      </div>

      <ul className="note-items" onClick={(e) => e.stopPropagation()}>
        {note.items.map((it) => (
          <li key={it.id} className={it.checked ? 'note-item done' : 'note-item'}>
            <input
              type="checkbox"
              checked={it.checked}
              onChange={(e) => scene.updateNoteItem(note.id, it.id, { checked: e.target.checked })}
            />
            <input
              className="item-text"
              value={it.text}
              placeholder="List item…"
              onChange={(e) => scene.updateNoteItem(note.id, it.id, { text: e.target.value })}
            />
            <button className="btn danger small" onClick={() => scene.removeNoteItem(note.id, it.id)}>
              ×
            </button>
          </li>
        ))}
        {note.items.length === 0 && <li className="muted small">No items yet — add a checklist below.</li>}
      </ul>

      <div className="note-card-foot" onClick={(e) => e.stopPropagation()}>
        <button className="btn small" onClick={() => scene.addNoteItem(note.id, '')}>
          + Add item
        </button>
        <div className="note-step-ctl">
          <button
            className="btn small"
            title="Move earlier in the build sequence"
            disabled={!isStep || stepIndex <= 0}
            onClick={() => scene.moveNoteStep(note.id, -1)}
          >
            ⇧
          </button>
          <button
            className="btn small"
            title="Move later in the build sequence"
            disabled={!isStep || stepIndex < 0 || stepIndex >= stepNotes.length - 1}
            onClick={() => scene.moveNoteStep(note.id, 1)}
          >
            ⇩
          </button>
          <label className="step-toggle" title="Order this note into an assembly step">
            <input
              type="checkbox"
              checked={isStep}
              onChange={(e) => scene.setNoteStep(note.id, e.target.checked ? stepNotes.length + 1 : null)}
            />
            <span>Step</span>
          </label>
          {isStep && <span className="step-chip">#{note.step}</span>}
        </div>
        {note.items.length > 0 && <span className="muted small">{done}/{note.items.length} done</span>}
      </div>
    </div>
  );
}
