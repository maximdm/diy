import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { profileById, profiles } from './domain/profiles';
import { computeBom, computeCutList, computeStockPlan } from './domain/bom';
import { buildListsCsv } from './domain/export';
import { computeTasks } from './domain/tasks';
import type { MeasureMode, PartShape, Profile, Unit } from './domain/types';
import { Scene } from './engine/scene';
import { autosave, loadProject, parseProject } from './engine/persistence';
import { CanvasEngine, type CustomPartSpec, type Tool } from './engine/canvasEngine';
import type { Theme } from './components/Toolbar';
import { CanvasView } from './components/CanvasView';
import { Toolbar } from './components/Toolbar';
import { FloatingTools } from './components/FloatingTools';
import { BomPanel } from './components/BomPanel';
import { Inspector } from './components/Inspector';
import { TasksPanel } from './components/TasksPanel';
import { ToolContext } from './components/ToolContext';
import { LayersPanel } from './components/LayersPanel';
import { Icon } from './components/Icon';

function defaultCustomSpec(p: Profile): CustomPartSpec {
  return {
    label: 'Custom part',
    materialId: p.materials[0]?.id ?? '',
    length: 400,
    width: 200,
    thickness: 20,
    quantity: 1,
  };
}

export default function App() {
  const initial = useMemo(() => loadProject(), []);
  const scene = useMemo(() => {
    const s = new Scene(profileById(initial?.profileId ?? ''));
    if (initial) s.load(initial);
    return s;
  }, [initial]);
  const engineRef = useRef<CanvasEngine | null>(null);
  const [tool, setTool] = useState<Tool>('select');
  const [measureMode, setMeasureModeState] = useState<MeasureMode>('linear');
  const [quickMeasure, setQuickMeasureState] = useState(false);
  const [kindId, setKindId] = useState(scene.profile.partKinds[0]?.id ?? '');
  const [partShape, setPartShape] = useState<PartShape | null>(null);
  const [status, setStatus] = useState('');
  const [canvasColor, setCanvasColor] = useState('#f7f4ec');
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = localStorage.getItem('draw-try:theme');
    const t: Theme = saved === 'grey' || saved === 'dark' ? saved : 'light';
    document.documentElement.dataset.theme = t;
    return t;
  });
  const [customSpec, setCustomSpec] = useState<CustomPartSpec>(defaultCustomSpec(scene.profile));
  const [profileId, setProfileId] = useState(scene.profile.id);
  const [pendingProfile, setPendingProfile] = useState<Profile | null>(null);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [displayUnit, setDisplayUnit] = useState<Unit | null>(initial?.displayUnit ?? null);
  const [gridVisible, setGridVisible] = useState(true);
  const [verticalLines, setVerticalLines] = useState(true);
  const [horizontalLines, setHorizontalLines] = useState(true);
  const [gridOpacity, setGridOpacity] = useState(100);
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [rulersVisible, setRulersVisible] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);

  const version = useSyncExternalStore(scene.subscribe, () => scene.version);

  useEffect(() => autosave(scene), [scene]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('draw-try:theme', theme);
  }, [theme]);

  const onReady = useCallback(
    (engine: CanvasEngine) => {
      engineRef.current = engine;
      engine.setTool('select');
      engine.setPartKind(scene.profile.partKinds[0]?.id ?? '');
      engine.setPartShape(partShape);
      engine.setCustomSpec(customSpec);
      engine.setGridVisible(gridVisible);
      engine.setVerticalLinesVisible(verticalLines);
      engine.setHorizontalLinesVisible(horizontalLines);
      engine.setGridOpacity(gridOpacity);
      engine.setSnapEnabled(snapEnabled);
      engine.setRulersVisible(rulersVisible);
    },
    [scene, partShape, customSpec, gridVisible, verticalLines, horizontalLines, gridOpacity, snapEnabled, rulersVisible],
  );

  const handleTool = useCallback((t: Tool) => {
    setTool(t);
    engineRef.current?.setTool(t);
  }, []);

  const handleMeasureMode = useCallback((m: MeasureMode) => {
    setMeasureModeState(m);
    engineRef.current?.setMeasureMode(m);
  }, []);

  const handleQuickMeasure = useCallback((on: boolean) => {
    setQuickMeasureState(on);
    engineRef.current?.setQuickMeasure(on);
  }, []);

  const handleKind = useCallback((id: string) => {
    setKindId(id);
    engineRef.current?.setPartKind(id);
  }, []);

  const handlePartShape = useCallback((shape: PartShape | null) => {
    setPartShape(shape);
    engineRef.current?.setPartShape(shape);
  }, []);

  const applyProfile = useCallback(
    (next: Profile, reset: boolean) => {
      scene.profile = next;
      if (reset) scene.clear();
      else scene.touch();
      const first = next.partKinds[0]?.id ?? '';
      setKindId(first);
      setProfileId(next.id);
      setPendingProfile(null);
      engineRef.current?.setPartKind(first);
      const spec = defaultCustomSpec(next);
      setCustomSpec(spec);
      engineRef.current?.setCustomSpec(spec);
      scene.customMaterials = [];
      scene.customTemplates = [];
    },
    [scene],
  );

  const handleProfile = useCallback(
    (id: string) => {
      const next = profileById(id);
      if (!next || next.id === scene.profile.id) return;
      setPendingProfile(next);
    },
    [scene],
  );

  const handleTemplate = useCallback(
    (id: string) => {
      const template = scene.templates.find((t) => t.id === id);
      if (!template) return;
      const maxY = scene.parts.reduce((m, p) => Math.max(m, p.position.y + p.size.y), 0);
      scene.addTemplate(template, { x: 0, y: scene.parts.length ? maxY + 200 : 0 });
      engineRef.current?.fit();
    },
    [scene],
  );

  const handleSaveTemplate = useCallback(() => {
    if (scene.parts.length === 0) return;
    setSaveName('');
    setSavingTemplate(true);
  }, [scene]);

  const confirmSaveTemplate = useCallback(() => {
    const name = saveName.trim() || 'Custom template';
    let minX = Infinity;
    let minY = Infinity;
    for (const p of scene.parts) {
      minX = Math.min(minX, p.position.x);
      minY = Math.min(minY, p.position.y);
    }
    const id = `custom-${Date.now()}`;
    scene.addCustomTemplate({ id, name, parts: scene.parts.map((p) => ({ ...p, position: { x: p.position.x - minX, y: p.position.y - minY } })) });
    setSavingTemplate(false);
    engineRef.current?.fit();
  }, [saveName, scene]);

  const handleSaveTemplateCancel = useCallback(() => {
    setSavingTemplate(false);
  }, []);

  const handleExport = useCallback(() => {
    const url = engineRef.current?.exportPng();
    if (!url) return;
    const a = document.createElement('a');
    a.href = url;
    a.download = `${scene.profile.id}-board.png`;
    a.click();
  }, [scene]);

  const handleExportPdf = useCallback(async () => {
    const url = await engineRef.current?.exportPdf();
    if (!url) return;
    const a = document.createElement('a');
    a.href = url;
    a.download = `${scene.profile.id}-board.pdf`;
    a.click();
  }, [scene]);

  const handleExportSvg = useCallback(() => {
    const svg = engineRef.current?.exportSvg();
    if (!svg) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    a.download = `${scene.profile.id}-board.svg`;
    a.click();
    URL.revokeObjectURL(a.href);
  }, [scene]);

  const handleExportCsv = useCallback(() => {
    const materials = scene.materials;
    const parts = scene.parts;
    const csv = buildListsCsv({
      materials,
      bom: computeBom(materials, parts),
      cuts: computeCutList(materials, parts),
      stock: computeStockPlan(materials, parts),
      tasks: computeTasks(scene.notes),
      unit: scene.displayUnit,
      precision: scene.displayPrecision,
      title: `${scene.profile.name} — project lists`,
    });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `${scene.profile.id}-lists.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }, [scene]);

  const handleSaveProject = useCallback(() => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(scene.serialize(), null, 2)], { type: 'application/json' }));
    a.download = `${scene.profile.id}.diy.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }, [scene]);

  const handleOpenProject = useCallback(
    async (file: File) => {
      const project = parseProject(await file.text());
      if (!project) {
        setStatus('Could not open file: not a Draw-Try project');
        return;
      }
      const p = profileById(project.profileId);
      if (!p) {
        setStatus(`Could not open file: unknown profile "${project.profileId}"`);
        return;
      }
      scene.profile = p;
      scene.load(project);
      setProfileId(p.id);
      setKindId(p.partKinds[0]?.id ?? '');
      setDisplayUnit(project.displayUnit ?? null);
      engineRef.current?.setPartKind(p.partKinds[0]?.id ?? '');
      engineRef.current?.fit();
      setStatus(`Opened ${file.name}`);
    },
    [scene],
  );

  const handleCanvasColor = useCallback((color: string) => {
    setCanvasColor(color);
    engineRef.current?.setCanvasColor(color);
  }, []);

  const handleUnit = useCallback(
    (u: Unit | null) => {
      setDisplayUnit(u);
      scene.setDisplayUnit(u);
    },
    [scene],
  );

  const handleGridVisible = useCallback((v: boolean) => {
    setGridVisible(v);
    engineRef.current?.setGridVisible(v);
  }, []);

  const handleVerticalLines = useCallback((v: boolean) => {
    setVerticalLines(v);
    engineRef.current?.setVerticalLinesVisible(v);
  }, []);

  const handleHorizontalLines = useCallback((v: boolean) => {
    setHorizontalLines(v);
    engineRef.current?.setHorizontalLinesVisible(v);
  }, []);

  const handleGridOpacity = useCallback((v: number) => {
    setGridOpacity(v);
    engineRef.current?.setGridOpacity(v);
  }, []);

  const handleSnapEnabled = useCallback((v: boolean) => {
    setSnapEnabled(v);
    engineRef.current?.setSnapEnabled(v);
  }, []);

  const handleRulersVisible = useCallback((v: boolean) => {
    setRulersVisible(v);
    engineRef.current?.setRulersVisible(v);
  }, []);

  const handleCustomSpec = useCallback((spec: CustomPartSpec) => {
    setCustomSpec(spec);
    engineRef.current?.setCustomSpec(spec);
  }, []);

  const handleNew = useCallback(() => {
    scene.clear();
    engineRef.current?.home();
  }, [scene]);

  const handleFocusPart = useCallback(
    (id: string) => {
      scene.selectPart(id);
      engineRef.current?.focusPart(id);
    },
    [scene],
  );

  return (
    <div className="app" style={{ '--profile': scene.profile.color } as CSSProperties}>
      <Toolbar
        profile={scene.profile}
        profiles={profiles}
        profileId={profileId}
        tool={tool}
        canvasColor={canvasColor}
        theme={theme}
        displayUnit={displayUnit}
        gridVisible={gridVisible}
        verticalLines={verticalLines}
        horizontalLines={horizontalLines}
        gridOpacity={gridOpacity}
        snapEnabled={snapEnabled}
        rulersVisible={rulersVisible}
        canUndo={scene.canUndo()}
        canRedo={scene.canRedo()}
        templates={scene.templates}
        onProfile={handleProfile}
        onTool={handleTool}
        onTemplate={handleTemplate}
        onSaveTemplate={handleSaveTemplate}
        onFit={() => engineRef.current?.fit()}
        onExport={handleExport}
        onExportPdf={handleExportPdf}
        onExportSvg={handleExportSvg}
        onExportCsv={handleExportCsv}
        onSaveProject={handleSaveProject}
        onOpenProject={handleOpenProject}
        onCanvasColor={handleCanvasColor}
        onTheme={setTheme}
        onUnit={handleUnit}
        onGridVisible={handleGridVisible}
        onVerticalLines={handleVerticalLines}
        onHorizontalLines={handleHorizontalLines}
        onGridOpacity={handleGridOpacity}
        onSnapEnabled={handleSnapEnabled}
        onRulersVisible={handleRulersVisible}
        onUndo={() => scene.undo()}
        onRedo={() => scene.redo()}
        onNew={handleNew}
        onClear={() => scene.clear()}
      />
      <div className="main">
        <div className="board-wrap">
          <CanvasView scene={scene} onReady={onReady} onStatus={setStatus} />
          <FloatingTools tool={tool} onTool={handleTool} />
          {!sheetOpen && (
            <button
              type="button"
              className="sheet-tab"
              onClick={() => setSheetOpen(true)}
              aria-label="Open panels"
              title="Open panels"
            >
              <Icon name="board" />
              <span>Tools &amp; lists</span>
            </button>
          )}
        </div>
        <aside className={`sidebar${sheetOpen ? ' open' : ''}`}>
          <div className="sidebar-head">
            <span className="sheet-grab" />
            <button
              type="button"
              className="sheet-close"
              aria-label="Close panels"
              title="Close panels"
              onClick={() => setSheetOpen(false)}
            >
              ✕
            </button>
          </div>
          <ToolContext
            scene={scene}
            tool={tool}
            kindId={kindId}
            partShape={partShape}
            customSpec={customSpec}
            measureMode={measureMode}
            quickMeasure={quickMeasure}
            onKind={handleKind}
            onPartShape={handlePartShape}
            onCustomSpec={handleCustomSpec}
            onMeasureMode={handleMeasureMode}
            onQuickMeasure={handleQuickMeasure}
          />
          {tool !== 'part' && tool !== 'dimension' && tool !== 'pan' && <Inspector scene={scene} version={version} />}
          <LayersPanel scene={scene} version={version} onFocus={handleFocusPart} />
          <BomPanel scene={scene} version={version} />
          <TasksPanel scene={scene} version={version} />
        </aside>
      </div>
      <footer className="statusbar">
        <span className="status-text">{status || 'Ready'}</span>
        <span className="status-hint">
          Wheel = zoom · Space/middle-drag = pan · Delete = remove · Ctrl+Z = undo · Q = quick measure · Esc = cancel
        </span>
      </footer>
      {savingTemplate && (
        <div className="overlay" onClick={handleSaveTemplateCancel}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <h3>Save board as template</h3>
            <p className="muted">Save the current parts as a reusable starter template.</p>
            <label className="field">
              <span>Template name</span>
              <input
                autoFocus
                value={saveName}
                placeholder="e.g. My shelf"
                onChange={(e) => setSaveName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') confirmSaveTemplate();
                  if (e.key === 'Escape') handleSaveTemplateCancel();
                }}
              />
            </label>
            <div className="dialog-actions">
              <button className="btn primary" onClick={confirmSaveTemplate} disabled={scene.parts.length === 0}>
                Save template
              </button>
              <button className="btn" onClick={handleSaveTemplateCancel}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {pendingProfile && (
        <div className="overlay">
          <div className="dialog">
            <h3>Switch to {pendingProfile.name}?</h3>
            <p className="muted">
              Start a fresh board for this craft, or keep the current parts on the board (they may reference materials
              the new profile doesn't have).
            </p>
            <div className="dialog-actions">
              <button className="btn primary" onClick={() => applyProfile(pendingProfile, true)}>
                New board
              </button>
              <button className="btn" onClick={() => applyProfile(pendingProfile, false)}>
                Keep parts
              </button>
              <button className="btn" onClick={() => setPendingProfile(null)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}