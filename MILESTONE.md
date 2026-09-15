# MILESTONE.md

Sequenced milestones for **Draw-Try**. Status reflects the current code. See `PLAN.md`
for the design behind these and `AGENTS.md` for repo conventions.

Legend: `[x]` done · `[ ]` not started · `[~]` partial

## M0 — Foundation (done)

**Goal:** a working board whose parts generate lists.

- [x] Vite + React 18 + TypeScript (strict) scaffold; `typecheck` + `build` pass.
- [x] Domain model: `Profile`, `Material`, `PartKind`, `Part`, `Anchor`, `Dimension`,
      `Template`.
- [x] Observable `Scene` (subscribe + `version`); no derived data stored.
- [x] Canvas engine: grid, snapping, wheel zoom, pan, select/move/resize.
- [x] Measure tool with part-anchored dimensions (follow parts on move).
- [x] Garden-furniture profile + bench/planter templates.
- [x] Derived BOM (costed) and cut list; inspector to edit parts.
- [x] PNG export of the viewport (export menu: PNG + viewport PDF — the PDF landed later, see M6).

## M1 — Safety and the sketch model (next)

**Goal:** no silent loss of work; the board is a sketch, not a parts drawing.

- [x] Snapshot undo/redo in `Scene` (undoes `parts`, `dimensions` and selection; `notes`
      land with M3).
- [x] Fix known bugs: `addTemplate` must call `touch()`; global Delete/Backspace is
      ignored while typing in inputs.
- [x] Decouple `Part.size` (visual footprint) from `Part.dimensions` (physical
      cut/surface); the Inspector edits physical dims without resizing the board rect.
- [x] Acceptance: every mutation is undoable; nothing can be deleted by accident.

## M2 — Project files and profiles

**Goal:** projects survive reloads, and extra crafts prove the model.

- [x] Schema-versioned project JSON — `ProjectFile` (`format` + `version`, parts, dimensions,
      notes (with items), custom materials/templates, `profileId`, `displayUnit` override);
      document lives in `Scene.serialize()`/`Scene.load()` (`src/engine/scene.ts`).
- [x] Local persistence: auto-saved to localStorage on change (debounced, flushed on
      `pagehide`) and restored on boot (`src/engine/persistence.ts`).
- [x] File open/save: download/upload the schema-versioned `.diy.json` (Save project /
      Open project in the export menu).
- [x] All formatting routes through `Profile.displayUnit`/`precision` — furniture and
      construction in mm, gardening and clothes in cm, jewelry at 0.1 mm precision — with a
      **per-project override** (Auto/mm/cm/m/in) resolved in `Scene.displayUnit` and honoured
      everywhere (M4).
- [x] Profile switcher in the UI (switching asks: new board or keep the parts); the
      hardcoded `gardenFurniture` import is replaced.
- [x] Twelve profiles shipped **as data only**: gardening, furniture, jewelry, clothes,
      construction, woodworking, tiling, landscaping, plumbing, electrical, metalwork,
      leatherworking.
- [x] Materials carry `category`; the shipped profiles have categorized catalogs surfaced as
      `<optgroup>` in the material picker and group rows in the BOM/cut list.
- [~] Acceptance: adding a profile requires **no** `engine/` changes (proven, twelve times);
      a saved board survives reload (localStorage auto-save/restore).

## M3 — Notes, arrows and tasks

**Goal:** the board becomes a project plan for both the garden ladder *and* the tomatoes.

- [x] Board-anchored notes (positioned text on the board).
- [x] Project-level notes (live in the project, not on the board).
- [x] Note checkboxes; derived **Tasks panel** (unchecked notes = to-dos, computed like
      the BOM, never stored).
- [x] Arrows linking notes to parts; an arrow stores a `partId` and its endpoint follows
      the part like a dimension anchor.
- [x] Acceptance: a garden-ladder and a tomato-planting board both end as sketch + notes
      + measurements + tasks + purchasing list.

## M4 — Editing ergonomics

**Goal:** the board feels solid for real use.

- [x] Custom part builder tool (drag-to-draw, click = spec size) with user-defined
      materials registered on the scene (`customMaterials`).
- [x] Board colour picker (toolbar) and per-part colour overrides; grid/label contrast
      adapts to light/dark canvases.
- [x] Part shapes: `rect | circle | triangle | line` — shape-aware rendering, hit-testing
      and anchor candidates; shapes selectable in the Inspector and Custom builder.
- [x] Board options menu (toolbar): per-project display-unit override, grid on/off +
      vertical/horizontal line toggles + opacity, snap on/off, rulers with labelled ticks in
      the chosen unit, board colour.
- [ ] Multi-select and marquee selection.
- [ ] Copy / paste / duplicate; align and distribute.
- [ ] Rotation (rendering, hit-testing, resize, anchors) — currently stubbed.
- [ ] Snap to other parts' edges, not just grid.
- [ ] Arrow-key nudge; dimension offset drag.
- [~] Acceptance: `AGENTS.md` limitations are updated; `rotation` stubs remain.

## M5 — Layers and history polish

**Goal:** safety and organization for larger projects.

- [ ] Layers: reorder, show/hide, lock.
- [ ] Keep snapshot undo unless it outgrows the scene; only then move to a command pattern
      in `Scene`.
- [ ] Acceptance: layers included in save/load and undo.

## M6 — Output

**Goal:** make the board workshop-ready.

- [x] SVG export (vector, scale-safe — world-space shapes, dimensions, notes and grid).
- [~] **Viewport PDF export** — embeds a JPEG of the canvas (hand-rolled writer in
      `src/engine/pdf.ts`, ~96 dpi); the full printable sheet (vector sketch + dimensions +
      notes + cut list) is still missing.
- [ ] CSV/PDF export of BOM, cut list and task list.
- [ ] Acceptance: a printed sheet is enough to buy, cut and plant.
- [~] The DIY hand-off pieces (stock-sheet-optimized BOM, 1:1 print templates, build
      sequence) are broken out into **M8** below.

## M7 — Collaboration (deferred)

**Goal:** multiple makers on one board.

- [ ] CRDT (Yjs) document sync; presence cursors.
- [ ] Server + auth; assets in object storage.
- [ ] Acceptance: two clients edit concurrently with convergent state.

## M8 — DIY hand-off (proposed)

**Goal:** the board becomes something you can build from and take to the store.

- [x] **Persistence**: schema-versioned JSON project file + localStorage auto-save/restore
      survive reload (extended M2); file open/save (download/upload `.diy.json`) is done.
- [ ] **Stock-sheet optimization** for the BOM/cut list: given standard stock sizes, compute
      how many sheets/lengths to buy; show cost totals per material.
- [ ] Export BOM, cut list and tasks to **CSV and printable PDF**, grouped by material.
- [ ] **Print-to-scale** part templates (1:1) for marking/cutting stock.
- [ ] **Rotation** (render, hit-test, resize, anchors) and a decision on constraining
      dimensions (drive geometry) — extends M4.
- [ ] **Build sequence**: notes become ordered assembly steps with part links.
- [ ] Acceptance: a printed/exported sheet is enough to buy the materials, lay them out, cut
      and assemble — no spreadsheet re-entry.

## Backlog / ideas

- Parameterized templates (set a length, parts recompute) — PLAN §10.
- Constraining dimensions (drive geometry) — PLAN §10 / M8.
- Board feet / metal weight helpers per profile.
- Mobile / touch pointer support (incl. pinch zoom).
- Test runner wired into `package.json` (none exists yet).
- The DIY hand-off loop (persistence, stock-optimized BOM export, 1:1 print, rotation/
  constraints, build sequence) — see **M8**.

## Media (aspirational, off the critical path)

Photo import + background removal and the paint/annotate layer (was the old M5). Kept
out of the roadmap until validated against a real need — see PLAN §7 for the design.
