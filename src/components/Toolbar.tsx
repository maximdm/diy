import { Icon, type IconName } from './Icon';
import type { Profile } from '../domain/types';
import type { Tool } from '../engine/canvasEngine';

interface Props {
  profile: Profile;
  profiles: Profile[];
  profileId: string;
  tool: Tool;
  canvasColor: string;
  canUndo: boolean;
  canRedo: boolean;
  templates: { id: string; name: string }[];
  onProfile: (id: string) => void;
  onTool: (tool: Tool) => void;
  onTemplate: (id: string) => void;
  onSaveTemplate: () => void;
  onFit: () => void;
  onExport: () => void;
  onCanvasColor: (color: string) => void;
  onUndo: () => void;
  onRedo: () => void;
  onNew: () => void;
  onClear: () => void;
}

const TOOLS: { id: Tool; label: string; hint: string; icon: IconName }[] = [
  { id: 'select', label: 'Select', hint: 'Move / resize parts', icon: 'select' },
  { id: 'part', label: 'Part', hint: 'Draw a new part', icon: 'part' },
  { id: 'custom', label: 'Custom', hint: 'Build a precise part in the side panel', icon: 'custom' },
  { id: 'dimension', label: 'Measure', hint: 'Add a linked dimension', icon: 'measure' },
  { id: 'pan', label: 'Pan', hint: 'Pan the board (or hold Space)', icon: 'pan' },
];
export { TOOLS };

export function Toolbar({
  profile,
  profiles,
  profileId,
  tool,
  canvasColor,
  canUndo,
  canRedo,
  templates,
  onProfile,
  onTool,
  onTemplate,
  onSaveTemplate,
  onFit,
  onExport,
  onCanvasColor,
  onUndo,
  onRedo,
  onNew,
  onClear,
}: Props) {
  return (
    <header className="toolbar">
      <div className="brand">
        <span className="brand-mark">◆</span>
        <div className="brand-text">
          <div className="brand-name">Draw-Try</div>
          <div className="brand-sub">{profile.name}</div>
        </div>
      </div>

      <div className="toolbar-divider" />

      <label className="profile-picker" title="Switch craft profile">
        <span className="swatch" style={{ backgroundColor: profile.color }} />
        <select className="select" value={profileId} onChange={(e) => onProfile(e.target.value)}>
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>

      <div className="toolbar-divider" />

      <div className="tool-group" role="toolbar" aria-label="Tools">
        {TOOLS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={tool === t.id ? 'tool-btn active' : 'tool-btn'}
            title={t.hint}
            aria-pressed={tool === t.id}
            onClick={() => onTool(t.id)}
          >
            <Icon name={t.icon} />
            <span className="tool-label">{t.label}</span>
          </button>
        ))}
      </div>

      <div className="actions">
        <button
          type="button"
          className="btn"
          onClick={onUndo}
          disabled={!canUndo}
          title={`Undo${canUndo ? ' (Ctrl+Z)' : ' — nothing to undo'}`}
        >
          <Icon name="undo" />
          <span className="btn-label">Undo</span>
        </button>
        <button
          type="button"
          className="btn"
          onClick={onRedo}
          disabled={!canRedo}
          title={`Redo${canRedo ? ' (Ctrl+Shift+Z)' : ' — nothing to redo'}`}
        >
          <Icon name="redo" />
          <span className="btn-label">Redo</span>
        </button>
        <div className="toolbar-divider" />
        <button
          type="button"
          className="btn"
          onClick={onSaveTemplate}
          title="Save the current board as a template"
        >
          <Icon name="template" />
          <span className="btn-label">Save as template</span>
        </button>
        <label className="action-select" title="Add a starter template">
          <select
            className="select"
            value=""
            onChange={(e) => {
              if (e.target.value) onTemplate(e.target.value);
              e.target.value = '';
            }}
          >
            <option value="">Template…</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="btn" onClick={onFit} title="Fit the board to the view">
          <Icon name="fit" />
          <span className="btn-label">Fit</span>
        </button>
        <button type="button" className="btn" onClick={onExport} title="Export the board as a PNG">
          <Icon name="export" />
          <span className="btn-label">PNG</span>
        </button>
        <label className="color-btn" title="Board color">
          <input type="color" value={canvasColor} onChange={(e) => onCanvasColor(e.target.value)} />
          <span className="color-btn-label">
            <Icon name="board" />
            <span className="btn-label">Board</span>
          </span>
        </label>
        <button type="button" className="btn" onClick={onNew} title="Start a fresh board">
          <Icon name="new" />
          <span className="btn-label">New</span>
        </button>
        <button type="button" className="btn danger" onClick={onClear} title="Clear the board">
          <Icon name="clear" />
          <span className="btn-label">Clear</span>
        </button>
      </div>
    </header>
  );
}
