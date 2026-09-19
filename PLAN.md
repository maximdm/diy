# PLAN.md

Long-term product and technical design for **Draw-Try**, an extensible canvas for DIY
project boards. `AGENTS.md` covers how to work in the repo; this file covers where the
project is going and why.

## 1. Vision

A single board where a maker sketches a project, measures it, and immediately gets the
shopping list and cut list — without re-typing anything into a spreadsheet.

Three promises:

1. **The board and the lists are one.** Every part on the canvas is a line item. Edit
   geometry → the BOM/cut list changes.
2. **Profiles make it fit your craft.** A garden-furniture board and a jewelry board
   share one engine but differ in units, part libraries, materials and templates.
3. **Sketches become build instructions.** Dimensions, notes, tasks and exports turn a
   drawing into a project the maker can actually follow.

Non-goal: being a general-purpose whiteboard. The value is domain awareness
(materials, cuts, quantities) and project structure, not freeform drawing.

Two concrete scenarios drive the model:

- **A garden ladder.** Sketch it, add measurements and notes, and the board yields a
  purchasing list and a to-do list for building it.
- **Planting 20 tomato bushes.** Sketch the bed, add notes (season, planting conditions,
  spacing), and the project yields a purchasing list and a planting to-do list.

Both are the same shape: **sketch + notes + measurements → derived lists (purchasing,
tasks)**. The woodworking BOM/cut list is one specialization of that shape.

## 2. Product pillars

| Pillar | What it means |
|---|---|
| Board | Infinite canvas, grid + snapping, parts, linked dimensions. |
| Lists | Derived BOM, cut list, cost. Never manually maintained. |
| Profiles | Data bundles per domain. Adding a craft is a data file. |
| Output | PNG + viewport PDF sketches, printable notes + cut lists, shareable project files. |
| Notes & Tasks | Board-anchored and project-level notes, checkboxes, arrows to parts, derived to-do list. |
| Media | Import images, remove backgrounds, annotate/paint on them (aspirational). |

## 3. Domain model

The whole app hangs off a few portable types in `domain/types.ts`.

```
Profile
  ├─ materials[]   measure: linear | area | count  + category
  ├─ partKinds[]   defaults for new parts (length/width/thickness/shape)
  └─ templates[]   starter part sets

Part        geometry (mm) + materialId + quantity + dimensions + shape? + color?
Dimension   anchors (free | part u,v) + offset + axis
Note        text + checked + board position (or project-level) + arrows→parts
Template    parts without ids
```

Key decisions (and why):

- **World units are always millimetres.** Precision issues disappear; display
  conversion happens at the edges (`format.ts`). Every profile uses the same internal
  unit.
- **Display unit is per project, overridable.** Every length readout goes through
  `Profile.displayUnit`/`precision`, and a per-project override (`scene.setDisplayUnit`,
  Auto/mm/cm/m/in) wins where set — a mm profile can be read as inches without touching
  the data. Always read the unit via `scene.displayUnit`, never `profile.displayUnit`
  directly.
- **Profiles are data, not code.** No behaviour in a profile. This is what lets a new
  craft ship as one file.
- **Derived data is never stored.** BOM/cut list are pure functions of `parts`. This
  removes an entire class of sync bugs.
- **Dimensions store anchors, not points.** A `part` anchor follows the part; that is
  what makes measurements "linked" rather than decorative.
- **`measure` drives BOM math.** linear → length × qty; area → L×W × qty; count → qty.
  A new material never needs new BOM code.
- **`category` groups the boards.** Materials are categorised; the BOM/cut list and the
  material picker group by category so a long catalog stays scannable.
- **Parts can be non-rectangular.** A `Part.shape` (`rect | circle | triangle | line`)
  changes only rendering, hit-testing and anchor candidates — dimensions, size and the
  BOM math are shape-agnostic, so shapes never fork the derived-data path.
- **`size` ≠ `dimensions`.** `Part.size` is the visual footprint on the board; the
  physical cut/surface lives in `Part.dimensions`. They coincide for wood-like parts but
  diverge on purpose (a finish part is drawn small yet covers a big area).
- **Notes drive tasks.** A `Note` is text + optional checkbox, board-anchored or
  project-level, optionally with arrows at parts. The to-do list is just the unchecked
  notes, computed on render like the BOM — never stored separately.

## 4. Architecture

```
domain/   pure model + derivations        (no DOM, no React, no engine)
engine/   Scene (document) + CanvasEngine (render/interaction)   (no React)
components/  React UI; reads Scene, calls Scene/engine methods
App.tsx   composition root
```

Dependency direction is one-way: `components → engine → domain`. Enforce it.

`Scene` is the document and the single source of truth. It is vanilla and observable
(`subscribe` + `version`), so React re-renders via `useSyncExternalStore` while the
canvas redraws imperatively on `requestAnimationFrame`. This keeps 60fps interaction out
of React's render loop.

### Interaction model

`CanvasEngine` is one state machine: `idle | pan | move | resize | draw | dim`. New
tools are new `Mode` variants. All drawing is in screen space (crisp text/hairlines),
with world↔screen conversion via `toWorld`/`toScreen`.

## 5. Profiles roadmap

Status: **twelve data-only profiles** ship today (MILESTONE M2/M4); `displayUnit`/
`precision` drive every length readout with an optional per-project override.

| Profile | Units | Parts | Materials | Distinct features |
|---|---|---|---|---|
| Furniture | mm, 0 | timber, sheet, fastener, finish | pine, plywood, screws, oil | cut list, board feet |
| Woodworking | mm, 0 | board, panel, joinery, hardware, finish | hardwood, ply, dowels, glue | joinery notes, grain direction |
| Jewelry | mm, 0.1 | band, bezel, wire, sheet, stones | silver, gold, beads | metal weight, ring sizes |
| Clothing | cm, 1 | pattern piece, band, pocket, trim | fabric, thread, elastic | seam allowance, yardage |
| Construction | mm, 0 | timber, board, footing, fastener | timber, ply, concrete, screws | footings, decking |
| Gardening | cm, 0 | bed, plant, seeds, soil, pot | soil, plants, stakes | planting counts, raised beds |
| Tiling | mm, 0 | tile, trim, fix, substrate, finish | ceramic, adhesive, grout | coverage, grout |
| Landscaping | mm, 0 | paved, bed, edge, plant, irrigation | pavers, membrane, sleeper | paving, edging |
| Plumbing | mm, 0 | pipe, fitting, fixture, insulation | copper/pex, elbows, taps | pipe runs, fittings |
| Electrical | mm, 0 | cable, containment, accessory, lighting, protection | cable, conduit, sockets | circuits, cable runs |
| Metalwork | mm, 0 | stock, plate, fixing, consumable, finish | steel tube/angle, bolts | stock steel, welding consumables |
| Leatherworking | mm, 0 | panel, strap, lining, hardware, finish | veg-tan, buckles, rivets | seam/hide allocation |

If adding a row needs engine changes, the abstraction is wrong — change the model.

## 6. Collaboration and persistence (later)

- **Persistence is landed for the single board** — a `ProjectFile` (schema-versioned JSON)
  is auto-saved on every change (debounced, flushed on `pagehide`) and restored on boot via
  localStorage (`src/engine/persistence.ts`; `Scene.serialize()`/`Scene.load()`). It round-trips
  parts, dimensions, notes, custom materials/templates, `profileId` and the `displayUnit`
  override. File open/save is done too (`Save project` / `Open project`, `.diy.json`
  download/upload in the export menu). Still open: project files on disk (multi-board
  library).
- **Collaboration** via a CRDT (Yjs) rather than a hand-rolled sync protocol. Store
  `parts`/`dimensions` as the synced document; keep assets (images) in object storage
  and reference them by id.
- CRDT choice stays out of `domain/` — the Scene should be adaptable to it.

## 7. Media pipeline (images, background removal, paint)

Two different jobs, two layers:

1. **Background removal** — a one-shot segmentation job, not realtime.
   - Start: Python service (`rembg`/BiRefNet), queue-backed, `POST` an asset id.
   - Later: export the model to ONNX once and run it from a Go service via ONNX
     Runtime, or ship a client-side ONNX/WASM model as a "fast" option.
   - A cheap luminance/threshold filter can exist as an instant "basic" mode; it is
     **not** a substitute for segmentation.
2. **Paint / annotate** — raster editing on the client.
   - Draw strokes as **vector paths** in the document while drawing, flatten to a
     raster asset on export. Never sync raw pixels per frame.

Assets are immutable blobs referenced by id; edits produce new assets and are recorded
as undoable scene updates.

## 8. Output and export

- Sketch: PNG (done), viewport PDF (done — JPEG embedded via the hand-rolled writer in
  `src/engine/pdf.ts`, ~96 dpi, no vector drawing) and **SVG** (done — `CanvasEngine.exportSvg()`,
  world-space vector: board + grid + parts + dimensions + notes). The **printable lists PDF** is
  done too (`src/engine/pdfLists.ts`, multi-page A4: BOM + stock plan + cut list + tasks, grouped
  by material, cost totals, repeated column headers). The **combined vector sheet** is done too —
  `src/engine/printSheet.ts` puts the sketch, dimensions and notes plus all the lists on one
  A4 document.
- **Lists are the real product.** BOM and cut list export to CSV/PDF, grouped by material,
  with cost totals — and the cut list is *buyable*: **stock-sheet optimization** takes
  standard stock sizes (e.g. 2440×1220 plywood, 2400×45×45 pine) and computes how many
  sheets/lengths to actually purchase, not just raw area/length.
- **Print-to-scale part templates.** Done — export any selected part at 1:1
  (`src/engine/printTemplate.ts` `buildPrintTemplatePdf`): shape outline from the physical
  dimensions, dimension lines, a 100 mm verification bar; parts larger than a sheet are
  skipped with a notice.
- Project file: schema-versioned `ProjectFile` JSON that round-trips a `Scene` — auto-saved
  to localStorage and restored on boot (done), plus file download/upload via `Save project` /
  `Open project` in the export menu (done).

## 9. Explicit non-goals (for now)

- General-purpose whiteboard features (freeform shapes, arbitrary paint) as a goal in
  themselves.
- Full CAD constraints/solver.
- Real-time multiplayer before single-user persistence and undo/redo exist.
- Photo import / background removal: aspirational, kept out of the critical path until
  validated against a real need (was the old M5).

## 10. Open questions

Decided so far (see MILESTONE.md for sequencing):

- **Notes/tasks**: a `Note` is now a **multi-item checklist** with a `context`
  (`general | part | measure`); contextual notes anchor to a part/dimension and follow it.
  The Tasks panel expands every item into a task, grouped by context. Assembly **build
  sequence** is done: a note can be marked as a step (`Note.step`, reorderable via ↑/↓ in the
  Notes panel) and its items flow, in order, into the task list and exports.
- **Undo/redo**: snapshot-based in `Scene` first; command pattern only if it outgrows
  snapshots.
- **Paint layer**: deferred with the media milestone, not a part kind.
- **Media**: photo import + background removal deferred until validated against a real
  need.

Still open:

- Should a `Dimension` optionally carry a **constraint** (drive geometry) or stay
  visual forever?
- Do profiles need **parameterized templates** (set length → parts recompute)?

## 11. Next bets: closing the DIY loop

The sketch works; the missing piece is the hand-off from drawing to building. Five
high-value additions, in priority order:

1. **Persistence (save / open).** Local auto-save to localStorage + restore **is done**,
      and **file open/save is done too** (`Save project` / `Open project`, `.diy.json`).
      The board already survives a reload.
2. **Real shopping artifact from the BOM/cut list.** The most valuable output is *"what do
   I buy and what does it cost."* Add **stock-sheet optimization** (given standard sizes,
   compute how many sheets/lengths to buy) and **export the list** to printable PDF + CSV,
   grouped by material with cost totals. Extends M6.
3. **Print-to-scale part templates.** Done (`src/engine/printTemplate.ts`, export-menu
   "PDF cut templates (1:1, selected parts)"); every selected part gets a sheet with its
   true-scale outline and a 100 mm verification bar.
4. **Dimensions that mean something + rotation.** Most real pieces are angled (mitres,
   triangles). **Rotation is done** (render/hit-test/resize/anchors, M4). Open decision:
   can a dimension optionally carry a constraint that drives geometry? Unlocks joinery.
5. **Build sequence in the to-do list.** Done — a note can be marked as an *assembly step*
   (`Note.step`) and reordered; steps and their items render in order in the Notes/tasks
   panel and feed the CSV and lists PDF, so hand-off reads "step 1 … step N".

Recommended first slice: **#1 + #2** — done. Together they turn Draw-Try from a sketchpad into
the thing you plan a build with and take to the store, and the **combined vector sheet**
(`src/engine/printSheet.ts`) puts that sketch and the lists on one printable page.

## 12. Next bets: buy less, build more, waste less

The M8/M6 hand-off is done: a board exports a buyable, cuttable, printable project. Three
bets follow on top of it, ordered by value-per-effort — **cut-optimised buying (M10)**,
**scrap reuse (M11)**, **build pacing (M12)**. M10 and M11 are done; M12 (build pacing) is
the live next bet. All three stay inside the existing rules: derived data is computed, never
stored; the engine and domain stay shape-agnostic; a new domain is still just a profile file.

### Cut-optimised buying (M10)

Where we are: `computeStockPlan` (`src/domain/bom.ts`) already buys stock — linear cuts via
first-fit-decreasing bin packing, sheet counts estimated by area. It answers "how much to
buy" but not "how to cut a sheet to get there", and the sheet count is a rough area ratio.

The upgrade is a cut **layout** engine plus honest waste:

- **2D sheet nesting** for `stock` sheet materials: a shelf-based guillotine heuristic places
  rectangular part footprints (physical `Part.dimensions`, 90° rotation on panels) into the
  chosen sheet size and reports exact sheet counts, a cut layout and remaining usable
  offcuts. Exact nesting is NP-hard — ship the heuristic, keep it a pure function in
  `domain/`, and render the layout in the stock-plan panel and on the lists PDF.
- **Kerf + grain on `Material`**: per-material `kerf` (blade width) widens every cut edge;
  a per-part grain flag forbids 90° rotation for timber while panels stay free. Both are
  data, never hardcoded rules in the engine.
- **Linear stock placement**: already bin-packed lengths gain a cut sequence and per-length
  offcuts in the stock plan.
- Every line that comes out — sheet count, offcut geometry, waste % — is the same input the
  scrap matcher (M11) consumes, so good layouts and good recommendations share one source.
  This is the reason the layout must live in `domain/`, not in a drawing routine.

### Scrap reuse (M11) — done

Two halves, both local-first. A "database" is deliberately *not* introduced.

1. **Scrap log.** Shipped — `ScrapItem` entries (material id + size + qty) live in the
   project file (`ProjectFile.scraps`) and are mirrored to a per-browser inventory
   (`draw-try:scraps`). Offcuts from an M10 layout are captured into the log in one click
   ("+ Save N offcuts to scrap" in the stock plan; `scene.captureOffcuts`).
2. **Suggest micro-projects.** Shipped — `fitTemplates` (`src/domain/scraps.ts`) scores the
   profile's templates by nesting each part's stock requirement into the logged scraps via
   the multi-bin packers `packIntoBins` / `packLinearIntoBins` (`src/domain/nesting.ts`),
   and the Scrap & ideas panel ranks results buildable-first with "Start with these parts"
   dropping the template onto the board. Deterministic, computed like the BOM, never stored.

Scope guard: dimension-type scraps first (timber, sheet, pipe); the fit-test gates only on
`stock` linear/area materials. Count-type leftovers — a spare 12V motor, a box of fixings —
are loggable and pin materials, but have no geometry, so they can't drive fit-based
suggestions. No mechanical/component matching in v1; if the fit-test engine proves itself,
matching count inventory is a separate, later feature. Linear scraps match by length (the
logged cross-section is display metadata only), mirroring the M10 linear cut planner.

### Build pacing (M12)

`Note.step` already orders a build. Add waiting as a first-class state:

- A step can be marked **waiting** with an optional duration (glue cure, paint dry, cool
  down, print). The Tasks panel then renders active vs waiting lanes, and a project day-plan
  reads "next active step after a 4 h glue cure" so the maker can split the build across days
  without losing where they are.
- **Notifications are a browser-only comfort.** Wait timers persist to localStorage so a
  reload resumes the countdown; Web Notifications fire when a wait ends while the tab is
  open. No background scheduler — a closed tab silently loses the notification, and the UI
  should say so rather than pretend otherwise.
- Ship the status/timeline first; notifications last. The timeline is the durable value;
  the ring is the polish.
