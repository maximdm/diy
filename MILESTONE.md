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
- [x] PNG export of the viewport.

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

- [ ] Schema-versioned project JSON (parts, dimensions, notes, `displayUnit`).
- [ ] Local persistence (localStorage now, file open/save later).
- [x] All formatting routes through `Profile.displayUnit`/`precision`: furniture and
      construction in mm, gardening and clothes in cm, jewelry at 0.1 mm precision.
- [x] Profile switcher in the UI (switching asks: new board or keep the parts); the
      hardcoded `gardenFurniture` import is replaced.
- [x] Five profiles shipped **as data only**: gardening, furniture, jewelry, clothes,
      construction.
- [x] Materials carry `category`; the five shipped profiles have categorized catalogs
      surfaced as `<optgroup>` in the material picker and group rows in the BOM/cut list.
- [~] Acceptance: adding a profile requires **no** `engine/` changes (proven); restoring
      a saved project still waits on persistence.

## M3 — Notes, arrows and tasks

**Goal:** the board becomes a project plan for both the garden ladder *and* the tomatoes.

- [ ] Board-anchored notes (positioned text on the board).
- [ ] Project-level notes (live in the project, not on the board).
- [ ] Note checkboxes; derived **Tasks panel** (unchecked notes = to-dos, computed like
      the BOM, never stored).
- [ ] Arrows linking notes to parts; an arrow stores a `partId` and its endpoint follows
      the part like a dimension anchor.
- [ ] Acceptance: a garden-ladder and a tomato-planting board both end as sketch + notes
      + measurements + tasks + purchasing list.

## M4 — Editing ergonomics

**Goal:** the board feels solid for real use.

- [x] Custom part builder tool (drag-to-draw, click = spec size) with user-defined
      materials registered on the scene (`customMaterials`).
- [x] Board colour picker (toolbar) and per-part colour overrides; grid/label contrast
      adapts to light/dark canvases.
- [x] Part shapes: `rect | circle | triangle | line` — shape-aware rendering, hit-testing
      and anchor candidates; shapes selectable in the Inspector and Custom builder.
- [ ] Multi-select and marquee selection.
- [ ] Copy / paste / duplicate; align and distribute.
- [ ] Rotation (rendering, hit-testing, resize, anchors) — currently stubbed.
- [ ] Snap to other parts' edges, not just grid.
- [ ] Arrow-key nudge; dimension offset drag.
- [ ] Acceptance: no `rotation` stubs remain; `AGENTS.md` limitations updated.

## M5 — Layers and history polish

**Goal:** safety and organization for larger projects.

- [ ] Layers: reorder, show/hide, lock.
- [ ] Keep snapshot undo unless it outgrows the scene; only then move to a command pattern
      in `Scene`.
- [ ] Acceptance: layers included in save/load and undo.

## M6 — Output

**Goal:** make the board workshop-ready.

- [ ] SVG export (vector, scale-safe).
- [ ] Printable PDF: sketch + dimensions + notes + cut list.
- [ ] CSV/PDF export of BOM, cut list and task list.
- [ ] Acceptance: a printed sheet is enough to buy, cut and plant.

## M7 — Collaboration (deferred)

**Goal:** multiple makers on one board.

- [ ] CRDT (Yjs) document sync; presence cursors.
- [ ] Server + auth; assets in object storage.
- [ ] Acceptance: two clients edit concurrently with convergent state.

## Media (aspirational, off the critical path)

Photo import + background removal and the paint/annotate layer (was the old M5). Kept
out of the roadmap until validated against a real need — see PLAN §7 for the design.

## Backlog / ideas

- Parameterized templates (set a length, parts recompute) — PLAN §10.
- Constraining dimensions (drive geometry) — PLAN §10.
- Board feet / metal weight helpers per profile.
- Mobile / touch pointer support (incl. pinch zoom).
- Test runner wired into `package.json` (none exists yet).
