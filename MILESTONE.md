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
- [x] Acceptance: adding a profile requires **no** `engine/` changes (proven, twelve times);
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
- [x] Multi-select and marquee selection.
- [x] Copy / paste / duplicate; align and distribute.
- [x] Rotation (rendering, hit-testing, resize, anchors) — Inspector field + rotate handle,
       rotation-aware `Part` → world transforms in `geometry.ts`; dimensions follow rotation.
- [x] Snap to other parts' edges, not just grid.
- [x] Arrow-key nudge; dimension offset drag.
- [x] Acceptance: `AGENTS.md` limitations updated; rotation fully wired.

## M5 — Layers and history polish

**Goal:** safety and organization for larger projects.

- [x] Layers shipped (v0.2): group selected parts into layers, rename (inline, double-click or
      pencil), show/hide, find (search filters part rows; a click jumps to and fits the part),
      and delete a layer without destroying its parts; part rows offer rename/delete.
- [x] Layers ride the undo history and survive save/load (`ProjectFile.layers`).
- [x] Hidden layers are excluded from hit-testing, marquee selection, edge-snapping and exports.
- [x] Layer reorder (up/down buttons → z-order on the canvas) and layer lock (locked layer's
      parts can't be selected, moved, resized, rotated or edited; locking deselects them).
      Reorder and lock ride the undo history and survive save/load.
- [x] Keep snapshot undo unless it outgrows the scene; only then move to a command pattern.
- [x] Acceptance: layers included in save/load and undo.

## M6 — Output

**Goal:** make the board workshop-ready.

- [x] SVG export (vector, scale-safe — world-space shapes, dimensions, notes and grid).
- [x] **Viewport PDF export** — embeds a JPEG of the canvas (hand-rolled writer in
      `src/engine/pdf.ts`, ~96 dpi). The full printable **project sheet** is done too:
      `src/engine/printSheet.ts` `buildPrintSheetPdf` puts the vector sketch (grid, parts,
      dimensions, notes) on one A4 page with the BOM, stock plan, cut list and tasks.
- [x] CSV/PDF export of BOM, cut list and task list (CSV + printable multi-page PDF shipped,
      grouped by material with cost totals; tasks carry their assembly-step number).
- [x] Acceptance: a printed sheet is enough to buy, cut and plant — the project sheet plus
      the 1:1 cut templates hand off the whole build.
- [x] The DIY hand-off pieces (stock-sheet-optimized BOM, 1:1 print templates, build
      sequence) shipped in **M8** below.

## M7 — Collaboration (deferred)

**Goal:** multiple makers on one board.

- [ ] CRDT (Yjs) document sync; presence cursors.
- [ ] Server + auth; assets in object storage.
- [ ] Acceptance: two clients edit concurrently with convergent state.

## M8 — DIY hand-off (proposed)

**Goal:** the board becomes something you can build from and take to the store.

- [x] **Persistence**: schema-versioned JSON project file + localStorage auto-save/restore
      survive reload (extended M2); file open/save (download/upload `.diy.json`) is done.
- [x] **Stock-sheet optimization** for the BOM/cut list: given standard stock sizes, compute
      how many sheets/lengths to buy; show cost totals per material. `computeStockPlan`
      (`src/domain/bom.ts`) packs linear cuts with first-fit-decreasing bin packing and estimates
      sheet counts by area, per material with a `stock` list; a **Stock plan** buy-list table
      (Buy / Pieces / Waste / Cost) feeds `purchaseTotal` — the per-material cost totals in the
      BOM remain priced at the per-unit rate.
- [x] Export BOM, cut list and tasks to **CSV and printable PDF**, grouped by material.
      CSV (`src/domain/export.ts` `buildListsCsv`) and a multi-page A4 PDF
      (`src/engine/pdfLists.ts` `buildListsPdf`, hand-rolled writer in `src/engine/pdf.ts`)
      are wired to the export menu; the PDF repeats column headers across pages and shows the
      purchase total.
- [x] **Print-to-scale part templates** (1:1) for marking/cutting stock —
      `src/engine/printTemplate.ts` `buildPrintTemplatePdf`: one sheet per selected part at
      true scale (shape outline from the physical dimensions, length/width dimension lines,
      a 100 mm verification scale bar); parts that don't fit a sheet are skipped with a status
      notice.
- [x] **Rotation** (render, hit-test, resize, anchors) — delivered in M4; dimensions follow a
       rotated part. Constraining dimensions (drive geometry) remains as PLAN §10 / M8 backlog.
- [x] **Build sequence**: a note can be marked as an *assembly step* (`Note.step`, set and
      reordered with the ↑/↓ controls in the Notes panel); steps read "step 1 … step N" and
      their items flow into the BOM/cut/task lists, CSV and lists PDF in order.
- [x] Acceptance: a printed/exported sheet is enough to buy the materials, lay them out, cut
      and assemble — no spreadsheet re-entry.

## M9 — Appearance and mobile (v0.2)

**Goal:** the board looks right on any screen and matches the maker's taste.

- [x] Light / grey / dark appearance modes (Board menu → Theme), persisted per browser
      (`draw-try:theme`) and applied via `data-theme` CSS tokens.
- [x] Mobile-friendly layout: bottom sheet ("Tools & lists") with a persistent pill tab on
      small screens; the right-hand panels slide up instead of squeezing inline.

## Backlog / ideas

- Parameterized templates (set a length, parts recompute) — PLAN §10.
- Constraining dimensions (drive geometry) — PLAN §10 (only unsent M8 item).
- Board feet / metal weight helpers per profile.
- Mobile / touch pointer support (incl. pinch zoom).
- Test runner wired into `package.json` (none exists yet).

## Media (aspirational, off the critical path)

Photo import + background removal and the paint/annotate layer (was the old M5). Kept
out of the roadmap until validated against a real need — see PLAN §7 for the design.
