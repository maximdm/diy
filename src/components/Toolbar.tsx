import { useRef, useState } from 'react';
import { Icon, type IconName } from './Icon';
import type { Profile, Unit } from '../domain/types';
import type { Tool } from '../engine/canvasEngine';

export type Theme = 'light' | 'grey' | 'dark';

interface Props {
  profile: Profile;
  profiles: Profile[];
  profileId: string;
  tool: Tool;
  canvasColor: string;
  theme: Theme;
  displayUnit: Unit | null;
  gridVisible: boolean;
  verticalLines: boolean;
  horizontalLines: boolean;
  gridOpacity: number;
  snapEnabled: boolean;
  rulersVisible: boolean;
  canUndo: boolean;
  canRedo: boolean;
  templates: { id: string; name: string }[];
  onProfile: (id: string) => void;
  onTool: (tool: Tool) => void;
  onTemplate: (id: string) => void;
  onSaveTemplate: () => void;
  onFit: () => void;
  onExport: () => void;
  onExportPdf: () => void;
  onExportSvg: () => void;
  onExportCsv: () => void;
  onExportListsPdf: () => void;
  onExportPrintTemplate: () => void;
  onExportSheet: () => void;
  onSaveProject: () => void;
  onOpenProject: (file: File) => void;
  onCanvasColor: (color: string) => void;
  onTheme: (theme: Theme) => void;
  onUnit: (unit: Unit | null) => void;
  onGridVisible: (v: boolean) => void;
  onVerticalLines: (v: boolean) => void;
  onHorizontalLines: (v: boolean) => void;
  onGridOpacity: (v: number) => void;
  onSnapEnabled: (v: boolean) => void;
  onRulersVisible: (v: boolean) => void;
  onUndo: () => void;
  onRedo: () => void;
  onNew: () => void;
  onClear: () => void;
}

const TOOLS: { id: Tool; label: string; hint: string; icon: IconName }[] = [
  { id: 'select', label: 'Select', hint: 'Move / resize parts and notes', icon: 'select' },
  { id: 'part', label: 'Part', hint: 'Draw a new part', icon: 'part' },
  { id: 'custom', label: 'Custom', hint: 'Build a precise part in the side panel', icon: 'custom' },
  { id: 'dimension', label: 'Measure', hint: 'Add a linked dimension', icon: 'measure' },
  { id: 'pan', label: 'Pan', hint: 'Pan the board (or hold Space)', icon: 'pan' },
];
export { TOOLS };

const THEMES: Theme[] = ['light', 'grey', 'dark'];

export function Toolbar({
  profile,
  profiles,
  profileId,
  tool,
  canvasColor,
  theme,
  displayUnit,
  gridVisible,
  verticalLines,
  horizontalLines,
  gridOpacity,
  snapEnabled,
  rulersVisible,
  canUndo,
  canRedo,
  templates,
  onProfile,
  onTool,
  onTemplate,
  onSaveTemplate,
  onFit,
  onExport,
  onExportPdf,
  onExportSvg,
  onExportCsv,
  onExportListsPdf,
  onExportPrintTemplate,
  onExportSheet,
  onSaveProject,
  onOpenProject,
  onCanvasColor,
  onTheme,
  onUnit,
  onGridVisible,
  onVerticalLines,
  onHorizontalLines,
  onGridOpacity,
  onSnapEnabled,
  onRulersVisible,
  onUndo,
  onRedo,
  onNew,
  onClear,
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const exportBtnRef = useRef<HTMLButtonElement>(null);
  const boardBtnRef = useRef<HTMLButtonElement>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(null);

  const positionMenu = (btn: HTMLButtonElement): void => {
    if (!window.matchMedia('(max-width: 720px)').matches) {
      setMenuPos(null);
      return;
    }
    const r = btn.getBoundingClientRect();
    setMenuPos({ top: r.bottom + 6, right: Math.max(8, window.innerWidth - r.right) });
  };

  const toggleExportMenu = (): void => {
    setExportOpen((o) => !o);
    if (!exportOpen && exportBtnRef.current) positionMenu(exportBtnRef.current);
  };

  const toggleBoardMenu = (): void => {
    setMenuOpen((o) => !o);
    if (!menuOpen && boardBtnRef.current) positionMenu(boardBtnRef.current);
  };
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

      <div className="toolbar-scroll">
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
        <div className="board-menu">
          {exportOpen && <div className="menu-backdrop" onClick={() => setExportOpen(false)} />}
          <button
            ref={exportBtnRef}
            type="button"
            className="btn"
            onClick={toggleExportMenu}
            title="Export the board as PNG or PDF"
            aria-expanded={exportOpen}
          >
            <Icon name="export" />
            <span className="btn-label">Export</span>
          </button>
          {exportOpen && (
            <div className="board-menu-drop" role="menu" style={menuPos ?? undefined}>
              <button type="button" className="menu-item" role="menuitem" onClick={onExport}>
                <Icon name="export" />
                <span>PNG image</span>
              </button>
              <button type="button" className="menu-item" role="menuitem" onClick={onExportPdf}>
                <Icon name="export" />
                <span>PDF document</span>
              </button>
              <button type="button" className="menu-item" role="menuitem" onClick={onExportSvg}>
                <Icon name="export" />
                <span>SVG image</span>
              </button>
              <button type="button" className="menu-item" role="menuitem" onClick={onExportCsv}>
                <Icon name="export" />
                <span>CSV lists (materials, cuts, tasks)</span>
              </button>
              <button type="button" className="menu-item" role="menuitem" onClick={onExportListsPdf}>
                <Icon name="export" />
                <span>PDF lists (materials, cuts, tasks)</span>
              </button>
              <button type="button" className="menu-item" role="menuitem" onClick={onExportPrintTemplate}>
                <Icon name="export" />
                <span>PDF cut templates (1:1, selected parts)</span>
              </button>
              <button type="button" className="menu-item" role="menuitem" onClick={onExportSheet}>
                <Icon name="export" />
                <span>PDF project sheet (sketch + lists)</span>
              </button>
              <div className="menu-sep" />
              <button type="button" className="menu-item" onClick={onSaveProject}>
                <Icon name="export" />
                <span>Save project (.diy.json)</span>
              </button>
              <button type="button" className="menu-item" onClick={() => fileRef.current?.click()}>
                <Icon name="export" />
                <span>Open project (.diy.json)</span>
              </button>
              <input
                ref={fileRef}
                type="file"
                accept=".diy.json,application/json"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) onOpenProject(f);
                  e.target.value = '';
                }}
              />
            </div>
          )}
        </div>
        <div className="board-menu">
          {menuOpen && <div className="menu-backdrop" onClick={() => setMenuOpen(false)} />}
          <button
            ref={boardBtnRef}
            type="button"
            className="btn"
            onClick={toggleBoardMenu}
            title="Board options — units, grid, snap, rulers"
            aria-expanded={menuOpen}
          >
            <Icon name="board" />
            <span className="btn-label">Board</span>
          </button>
          {menuOpen && (
            <div className="board-menu-drop" style={menuPos ?? undefined}>
              <label className="field">
                <span>Units</span>
                <select
                  className="select"
                  value={displayUnit ?? ''}
                  onChange={(e) => onUnit(e.target.value ? (e.target.value as Unit) : null)}
                >
                  <option value="">Auto ({profile.displayUnit})</option>
                  <option value="mm">Millimetres</option>
                  <option value="cm">Centimetres</option>
                  <option value="m">Metres</option>
                  <option value="in">Inches</option>
                </select>
              </label>
              <label className="field">
                <span>Theme</span>
                <div className="seg">
                  {THEMES.map((t) => (
                    <button
                      key={t}
                      type="button"
                      className={theme === t ? 'seg-btn active' : 'seg-btn'}
                      onClick={() => onTheme(t)}
                    >
                      {t === 'grey' ? 'Grey' : t[0].toUpperCase() + t.slice(1)}
                    </button>
                  ))}
                </div>
              </label>
              <label className="field check">
                <input type="checkbox" checked={gridVisible} onChange={(e) => onGridVisible(e.target.checked)} />
                <span>Grid lines</span>
              </label>
              <div className="board-submenu">
                <label className="field check">
                  <input
                    type="checkbox"
                    checked={verticalLines}
                    onChange={(e) => onVerticalLines(e.target.checked)}
                  />
                  <span>Vertical lines</span>
                </label>
                <label className="field check">
                  <input
                    type="checkbox"
                    checked={horizontalLines}
                    onChange={(e) => onHorizontalLines(e.target.checked)}
                  />
                  <span>Horizontal lines</span>
                </label>
                <label className="field range-row">
                  <span>Grid opacity</span>
                  <div className="range-input">
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={gridOpacity}
                      onChange={(e) => onGridOpacity(Number(e.target.value))}
                    />
                    <output>{gridOpacity}%</output>
                  </div>
                </label>
              </div>
              <label className="field check">
                <input type="checkbox" checked={snapEnabled} onChange={(e) => onSnapEnabled(e.target.checked)} />
                <span>Snap to grid</span>
              </label>
              <label className="field check">
                <input type="checkbox" checked={rulersVisible} onChange={(e) => onRulersVisible(e.target.checked)} />
                <span>Rulers around the board</span>
              </label>
              <label className="field">
                <span>Board color</span>
                <input
                  type="color"
                  value={canvasColor}
                  onChange={(e) => {
                    onCanvasColor(e.target.value);
                    e.currentTarget.blur();
                  }}
                />
              </label>
            </div>
          )}
        </div>
        <button type="button" className="btn" onClick={onNew} title="Start a fresh board">
          <Icon name="new" />
          <span className="btn-label">New</span>
        </button>
        <button type="button" className="btn danger" onClick={onClear} title="Clear the board">
          <Icon name="clear" />
          <span className="btn-label">Clear</span>
        </button>
        </div>
      </div>
    </header>
  );
}
