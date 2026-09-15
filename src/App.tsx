import { useCallback, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { profileById, profiles } from './domain/profiles';
import { furniture } from './domain/profiles/furniture';
import type { PartShape, Profile, Unit } from './domain/types';
import { Scene } from './engine/scene';
import { CanvasEngine, type CustomPartSpec, type Tool } from './engine/canvasEngine';
import { CanvasView } from './components/CanvasView';
import { Toolbar } from './components/Toolbar';
import { FloatingTools } from './components/FloatingTools';
import { BomPanel } from './components/BomPanel';
import { Inspector } from './components/Inspector';
import { TasksPanel } from './components/TasksPanel';
import { ToolContext } from './components/ToolContext';

export default function App() {
  const scene = useMemo(() => new Scene(furniture), []);
  const engineRef = useRef<CanvasEngine | null>(null);
  const [tool, setTool] = useState<Tool>('select');
  const [kindId, setKindId] = useState(furniture.partKinds[0]?.id ?? '');
  const [partShape, setPartShape] = useState<PartShape | null>(null);
  const [status, setStatus] = useState('');
  const [canvasColor, setCanvasColor] = useState('#f7f4ec');
  const [customSpec, setCustomSpec] = useState<CustomPartSpec>({
    label: 'Custom part',
    materialId: furniture.materials[0]?.id ?? '',
    length: 400,
    width: 200,
    thickness: 20,
    quantity: 1,
  });
  const [profileId, setProfileId] = useState(furniture.id);
  const [pendingProfile, setPendingProfile] = useState<Profile | null>(null);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [displayUnit, setDisplayUnit] = useState<Unit | null>(null);
  const [gridVisible, setGridVisible] = useState(true);
  const [verticalLines, setVerticalLines] = useState(true);
  const [horizontalLines, setHorizontalLines] = useState(true);
  const [gridOpacity, setGridOpacity] = useState(100);
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [rulersVisible, setRulersVisible] = useState(false);

  const version = useSyncExternalStore(scene.subscribe, () => scene.version);

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
      const spec = {
        label: 'Custom part',
        materialId: next.materials[0]?.id ?? '',
        length: 400,
        width: 200,
        thickness: 20,
        quantity: 1,
      };
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

  return (
    <div className="app" style={{ '--profile': scene.profile.color } as CSSProperties}>
      <Toolbar
        profile={scene.profile}
        profiles={profiles}
        profileId={profileId}
        tool={tool}
        canvasColor={canvasColor}
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
        onCanvasColor={handleCanvasColor}
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
        </div>
        <aside className="sidebar">
          <ToolContext
            scene={scene}
            tool={tool}
            kindId={kindId}
            partShape={partShape}
            customSpec={customSpec}
            onKind={handleKind}
            onPartShape={handlePartShape}
            onCustomSpec={handleCustomSpec}
          />
          {tool !== 'part' && tool !== 'dimension' && tool !== 'pan' && <Inspector scene={scene} version={version} />}
          <BomPanel scene={scene} version={version} />
          <TasksPanel scene={scene} version={version} />
        </aside>
      </div>
      <footer className="statusbar">
        <span className="status-text">{status || 'Ready'}</span>
        <span className="status-hint">
          Wheel = zoom · Space/middle-drag = pan · Delete = remove · Ctrl+Z = undo · Esc = cancel
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