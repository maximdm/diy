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
