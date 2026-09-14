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
| Output | PNG/SVG sketches, printable notes + cut lists, shareable project files. |
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

Status: gardening, furniture, jewelry, clothes and construction all ship as data-only
profiles today (MILESTONE M2); `displayUnit`/`precision` drive every length readout.

| Profile | Units | Parts | Materials | Distinct features |
|---|---|---|---|---|
| Garden furniture (v1) | mm | timber, panel, fastener | pine, plywood, screws, oil | cut list, board feet |
| Woodworking | mm | board, sheet | hardwood, glue | joinery notes, grain direction |
| Jewelry | mm, 0.1 | ring, bezel, clasp | silver, gold | metal weight, ring sizes |
| Clothing | cm | pattern piece, seam | fabric, thread | 1:1 scale, seam allowance, yardage |
| 3D printing | mm | part | filament | grams, print time |

If adding a row needs engine changes, the abstraction is wrong — change the model.

## 6. Collaboration and persistence (later)

- **Persistence first** (local project file / localStorage), then a server.
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

- Sketch: PNG (done), then SVG (vector, scale-safe), then printable PDF with dimensions.
- Lists: BOM and cut list to CSV/PDF.
- Project file: JSON (schema-versioned) that round-trips a `Scene`.

## 9. Explicit non-goals (for now)

- General-purpose whiteboard features (freeform shapes, arbitrary paint) as a goal in
  themselves.
- Full CAD constraints/solver.
- Real-time multiplayer before single-user persistence and undo/redo exist.
- Photo import / background removal: aspirational, kept out of the critical path until
  validated against a real need (was the old M5).

## 10. Open questions

Decided so far (see MILESTONE.md for sequencing):

- **Notes/tasks**: one `Note` entity (text + optional checkbox), board-anchored or
  project-level, optional arrows at parts; the Tasks panel is derived via `computeTasks`.
- **Undo/redo**: snapshot-based in `Scene` first; command pattern only if it outgrows
  snapshots.
- **Paint layer**: deferred with the media milestone, not a part kind.
- **Media**: photo import + background removal deferred until validated against a real
  need.

Still open:

- Should a `Dimension` optionally carry a **constraint** (drive geometry) or stay
  visual forever?
- Do profiles need **parameterized templates** (set length → parts recompute)?
- Do notes need **multi-item checklists**, or is one checkbox per note enough?
