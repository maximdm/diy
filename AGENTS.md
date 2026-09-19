# AGENTS.md

Guidance for AI agents and contributors working in **Draw-Try**, an extensible canvas
for DIY project boards (sketches, measurements, notes, material and to-do lists).

## What this is

A from-scratch canvas app (no tldraw/Excalidraw dependency). A **profile** describes a
DIY domain (garden furniture, jewelry, clothes…). Each profile supplies materials, part
kinds and templates. Parts and notes on the board feed three derived views: a **bill of
materials**, a **cut list** and a **to-do list**. The core idea: the board and the lists
are two views of the same data — moving or resizing a part changes the shopping list,
checking a note changes the tasks.

## Commands

Run from the repo root:

```bash
npm install        # install deps
npm run dev        # Vite dev server (http://localhost:5173)
npm run typecheck  # tsc --noEmit  (must pass before finishing work)
npm run build      # typecheck + production build
npm run preview    # preview the built output
```

There is no test runner yet. If you add one, wire it into `package.json` and document it
here.

> Note: `esbuild`'s postinstall may be blocked by the local npm policy. The build still
> works, but if `npm run dev`/`build` reports a missing esbuild binary, run
> `npm install-scripts approve esbuild` (or `npm rebuild esbuild`).

## Architecture

```
src/
  domain/            Pure data + logic. No DOM, no React.
    types.ts         Profile, Material, PartKind, Part, Anchor, Dimension, Note, Template
    bom.ts           computeBom / computeCutList / materialQuantity (derived data)
    tasks.ts         computeTasks: derived note/to-do view
    format.ts        formatLength / formatQty / formatCurrency
    profiles/        One file per DIY domain; a profile is pure data
  engine/            Canvas + document. No React.
    geometry.ts      hit tests, anchor candidates, snap, point-segment distance
    scene.ts         Observable document: parts, dimensions, notes, selection, version
    canvasEngine.ts  Canvas 2D renderer + pointer interaction (tools)
  components/        React UI only: Toolbar, CanvasView, Inspector, BomPanel, NotesPanel
  App.tsx            Wires the scene, engine and panels together
  styles.css         All styling
```

### Responsibilities (do not blur these)

- **`domain/`** never imports `engine/` or React. It is the portable model.
- **`engine/`** never imports React. It owns the canvas and the `Scene`.
- **`components/`** never mutate canvas state directly; they call `Scene` methods or
  the `CanvasEngine` handle.
- **Derived data is never stored.** BOM/cut/task lists are computed from `Scene.parts`
  and `Scene.notes` on render (`computeBom`, `computeCutList`, `computeTasks`). Never
  keep a parallel "list" array.

### State flow

`Scene` is the single source of truth. It exposes:

- `subscribe(listener): () => void` — stable arrow property, safe for
  `useSyncExternalStore`.
- `version: number` — bumped in `touch()`; React uses it as the snapshot.
- Mutation methods (`addPart`, `updatePart`, `removePart`, `addDimension`,
  `removeDimension`, `addNote`, `updateNote`, `removeNote`, `selectPart`,
  `selectDimension`, `addTemplate`, `clear`) all end with `touch()`.
- Edits are undoable via snapshot history: each mutation records the pre-mutation state;
  `undo()`/`redo()` (Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y). Continuous gestures wrap their
  mutations in `begin()`/`end()` so a whole drag is a single undo step.

The `CanvasEngine` subscribes to the scene and marks itself dirty; it redraws on
`requestAnimationFrame` only when dirty. React panels re-render via
`useSyncExternalStore(scene.subscribe, () => scene.version)` in `App.tsx`, which passes
`version` down to `Inspector` and `BomPanel` so their `useMemo` recomputes.

## Units and coordinates

- **World space is always millimetres.** `Part.position`/`Part.size` and
  `Part.dimensions` are mm. Never store cm/inches internally; convert at display time via
  `domain/format.ts`.
- **The display unit is per project.** `Profile.displayUnit` / `Profile.precision` drive
  `formatLength`, the Inspector fields, dimension labels and the status readout (via
  `format.mmToDisplay` / `displayToMm`); lists render in the project's unit. An optional
  per-project override is resolved in `Scene.displayUnit` / `Scene.displayPrecision` (set
  via `scene.setDisplayUnit`) and honoured everywhere — always read the unit/precision
  through `scene`, never `scene.profile.displayUnit` directly. Never hardcode a unit in
  UI text.
- `Camera = { x, y, scale }` where `scale` is **pixels per mm**. Convert with the
  engine's `toWorld` / `toScreen` only.
- `Profile.gridSize` is in mm. Snapping uses `geometry.snap(value, gridSize)`.

## Working on the canvas engine

- `canvasEngine.ts` is one class; drawing methods are `drawXxx(ctx, …)`. All drawing is
  done in **screen space** (labels/line widths stay crisp) except grid math.
- Pointer handling is a small state machine (`Mode`): `idle | pan | move | resize | draw
  | dim`. Add new interactions as a new `Mode` variant plus handlers in
  `onDown`/`onMove`/`onUp`, and reset to `idle` on `Escape`.
- `dim` is a two-click flow: the first click stores an `Anchor`, `onUp` must **not**
  reset it, the second click commits via `scene.addDimension`.
- Dimensions store **anchors**, not points. `Anchor` is either `free` (a snapped world
  point) or `part` (`partId` + normalized `u`,`v` in 0..1). Part anchors follow the part
  when it moves — preserve this; it is the whole point of linked dimensions.
- `resolveAnchor(world, toleranceMm)` picks the nearest part corner/edge midpoint or a
  free grid-snapped point. Tolerance is passed in world mm (callers use `px / scale`).
- Parts are shape-aware: `PartShape = 'rect' | 'circle' | 'triangle' | 'line'`.
  `geometry.partShape()` centralises the default; `anchorCandidates`/`partContains` in
  `geometry.ts` must agree with `traceShape` in the engine (`line` strokes, the others
  fill+stroke). BOM/cut math is shape-agnostic — never fork derived data on shape.

## Extending: profiles first

Adding a domain (clothes, jewelry, woodworking) should be **a new file in
`domain/profiles/` and nothing else**. If a new domain requires editing the engine, the
abstraction is wrong — fix the model rather than special-casing.

A `Profile` is:

- `materials[]` — `measure: 'linear' | 'area' | 'count'` drives how BOM quantity is
  computed (`materialQuantity`); `role: 'stock' | 'fixing' | 'finish'` separates what is
  cut (only `stock` appears in the cut list) from fixings and finishes in the BOM.
  `category` groups materials in the picker and the BOM/cut list.
- `partKinds[]` — defaults for newly drawn parts
  (`defaultLength/Width/Thickness`, optional `defaultShape`).
- `templates[]` — starter part sets (`Template.parts` are `Part` minus `id`).
- `displayUnit` / `precision` — how lengths display and are entered (`format.ts`
  converts at the edge; world space stays mm).

Keep profiles as data. Do not put behaviour in them.

## Conventions

- TypeScript, `strict` on, plus `noUnusedLocals`/`noUnusedParameters` — the typecheck
  will fail on unused code.
- ESM, `"type": "module"`, React 18, function components, hooks.
- Components are small and colocated in `components/`; shared types live in `domain/`.
- Prefer existing helpers over new ones (`snap`, `formatLength`, `materialQuantity`, …).
- Match the existing formatting: 2-space indent, single quotes, semicolons, ~100 col.
- **Do not add code comments** unless they explain a non-obvious constraint; the
  existing code is intentionally comment-free.
- Do not introduce a state library or a heavier canvas dependency without updating
  `PLAN.md` and getting agreement.

## Known limitations (v0.1)

- Rotation is supported in rendering, hit-testing, resize, the resize/rotate handles
  and the Inspector (`rotation` is radians; the Inspector shows degrees). `rect | circle
  | triangle | line` parts all rotate. Part-anchored dimensions follow a rotated part.
- Selection is multi-select: Shift-click toggles parts, drag on empty space marquees,
  part/selection move snaps to other parts' edges, arrow keys nudge (Shift = 10× step),
  Ctrl/Cmd+C/V/D copy/paste/duplicate, and the Inspector offers align & distribute for
  the current multi-selection.
- Project persistence: `Scene.serialize()`/`Scene.load()` (schema-versioned `ProjectFile`,
  `src/engine/persistence.ts`) auto-save on change (debounced, flushed on `pagehide`) and
  restore on boot; file open/save (`Save project` / `Open project`, `.diy.json` download/
  upload) is wired into the export menu. No disk files, no multiplayer.
- Twelve profiles ship as data (gardening, furniture, jewelry, clothes, construction,
  woodworking, tiling, landscaping, plumbing, electrical, metalwork, leatherworking) with
  a switcher (switched boards persist like any other). More candidates are catalogued in
  `PROFILE_IDEAS.md`.
- Dimensions are visual/attached, not constraining; they do not drive part geometry.
- Notes are implemented (board-anchored + project-level with checkboxes, derived Tasks
  panel, arrows to parts, and notes can be ordered into **assembly steps** via `Note.step`),
  but there is no canvas text editing — note text is edited in the Notes panel, and note
  style is fixed (no color/size overrides).
- `Part.size` (visual footprint) and `Part.dimensions` (physical cut) are decoupled: the
  Inspector edits physical dims, the board resize handle edits the footprint.
- PNG export of the current viewport (lossless); the viewport PDF embeds a JPEG (~96 dpi,
  hand-rolled writer in `src/engine/pdf.ts`, no vector drawing). SVG export
  (`CanvasEngine.exportSvg()`) is world-space vector (board + grid + parts + dimensions +
  notes), gridded like the canvas, no rulers/handles. The PDF core in `pdf.ts` (multi-page,
  text + rules, `buildPdfDoc`) also powers the **printable lists PDF**
  (`src/engine/pdfLists.ts`: BOM + stock plan + cut list + tasks, grouped by material, cost
  totals), **1:1 cut templates** (`src/engine/printTemplate.ts`: selected parts at true
  scale with a 100 mm verification bar) and a **combined project sheet**
  (`src/engine/printSheet.ts`: vector sketch + dimensions + notes plus all the lists on one
  A4 document).

See `MILESTONE.md` for what comes next and `PLAN.md` for the longer-term design.
