# Profile ideas

Candidate DIY domains for Draw-Try. This file is a design catalogue: it explains how
parts and materials fit together and specifies each candidate profile so it can be
dropped into `src/domain/profiles/<id>.ts` and registered in `profiles/index.ts` with no
engine changes.

Twelve profiles now ship as data:

`gardening`, `furniture`, `jewelry`, `clothes`, `construction` (original five) plus
`woodworking`, `tiling`, `landscaping`, `plumbing`, `electrical`, `metalwork`,
`leatherworking` (the strong fits below, implemented in code).

Remaining candidates are specified here for later. If a domain ever needs behaviour
beyond the data fields, the model is wrong — don't special-case the engine.

---

## How parts and materials relate

Two distinct concepts, deliberately decoupled:

- **`Material`** is *what you buy*. Its `measure` decides the BOM quantity formula
  (`materialQuantity` in `domain/bom.ts`):
  - `linear` → `length / 1000 * quantity` (metres)
  - `area` → `length * width / 1_000_000 * quantity` (square metres)
  - `count` → `quantity` (pieces, bags, spools…)
  `unitLabel` must match the measure: `m` for linear, `m2` for area, and a concrete noun
  (`pc`, `bag`, `spool`, `pair`, `bottle`, `tray`, `roll`, `sheet`) for count.
  `costPerUnit` is the price for one of those units, so BOM cost = `qty * costPerUnit`.
- **`Material.role`** separates the three jobs a purchased material does:
  - `stock` — the body of a part, cut/shaped/fitted; the only role that feeds the cut
    list (`computeCutList` skips everything else and any `count` line).
  - `fixing` — fasteners, hardware, fittings and other bought-in components.
  - `finish` — coatings and adhesives applied to a surface (paint, oil, glue, grout).
  A material is still *one purchase line*: role classifies it, it does not split the BOM.
- **`PartKind`** is *how you draw it*: a label plus default material and default
  `defaultLength/Width/Thickness` for a freshly drawn part.
- **`Part`** is an instance: `dimensions` are the physical cut (what feeds the cut list /
  BOM), while `size` is only the visual footprint on the board. `quantity` multiplies the
  material demand, so a "Leg, qty 4" line is one object.

### Rules of thumb

- Keep world units in **mm** always. `displayUnit`/`precision` only affect rendering.
- `category` controls ordering in the BOM and cut list: the first material of a category
  sets where that whole category sorts. Order categories roughly by build sequence
  (stock → sheet → fixing → finish).
- Tag every material with a `role`. Body materials are `stock`; bolts, screws, hinges,
  fittings and bought components are `fixing`; paint, oil, glue, grout and sealant are
  `finish`.
- Give every material a distinct `color` — it tints parts on the canvas and the BOM.
- A part kind's `measure` should normally match its default material's measure.
- Prefer one material per real purchase line (a specific board size, a specific pipe
  diameter, a specific gauge), not generic "wood" / "metal".
- For `count` materials, `dimensions` are usually symbolic (placeholder box sizes); only
  `quantity` matters.

---

## Strong fits (shipped)

### Woodworking / cabinetry — `woodworking.ts`

Joinery, casework and bench work. Timber by length, sheet goods by area, hardware by
piece. Distinguishable from `furniture` (outdoor/garden focus) and `construction`
(structural framing, no decorative joinery).

**Materials (16):**

| id | name | category | measure | unit | cost |
| --- | --- | --- | --- | --- | --- |
| `oak-25` | Oak board 25 mm | hardwood | linear | m | 32.0 |
| `walnut-20` | Walnut board 20 mm | hardwood | linear | m | 45.0 |
| `pine-18` | Pine board 18 mm | softwood | linear | m | 8.0 |
| `cedar-20` | Cedar board 20 mm | softwood | linear | m | 14.0 |
| `ply-12` | Birch plywood 12 mm | sheet | area | m2 | 38.0 |
| `ply-18` | Birch plywood 18 mm | sheet | area | m2 | 52.0 |
| `mdf-16` | MDF 16 mm | sheet | area | m2 | 11.0 |
| `veneer` | Iron-on veneer | sheet | area | m2 | 16.0 |
| `dowel-10` | Dowel 10 mm | joinery | linear | m | 1.2 |
| `biscuit` | Biscuit | joinery | count | pc | 0.05 |
| `hinge-35` | Cabinet hinge 35 mm | hardware | count | pc | 2.4 |
| `drawer-slide` | Drawer slide pair | hardware | count | pair | 7.5 |
| `handle` | Handle | hardware | count | pc | 4.5 |
| `screw-50` | Wood screw 50 mm | fasteners | count | pc | 0.09 |
| `glue` | Wood glue | finish | count | bottle | 6.0 |
| `hardwax` | Hard wax oil | finish | area | m2 | 9.5 |

**Part kinds:** `board` (linear, 1200×140×18), `panel` (area, 600×400×12),
`joinery` (linear, 300×10×10), `hardware` (count, 60×60×20), `finish` (area, 400×300×1).

**Templates:**

- **Wall shelf** — 3 shelves + 2 sides (oak), back rail, 12 dowels, 24 screws, finish.
- **Workbench** — 2 top slabs (oak), 2 aprons, 4 legs, 2 stretchers (pine), biscuits,
  40 screws, finish.
- **Base cabinet** — 2 carcass sides + 2 shelves + back (ply), oak door, 2 hinges,
  handle, drawer slide, finish.

### Tiling & flooring — `tiling.ts`

Floors, walls and splashbacks. Tiles/adhesive/grout by area, trim by length, spacers and
clips by piece.

**Materials (13):**

| id | name | category | measure | unit | cost |
| --- | --- | --- | --- | --- | --- |
| `tile-ceramic` | Ceramic tile | tile | area | m2 | 22.0 |
| `tile-porcelain` | Porcelain tile | tile | area | m2 | 35.0 |
| `tile-natural` | Natural stone tile | tile | area | m2 | 60.0 |
| `mosaic` | Mosaic sheet | tile | area | m2 | 48.0 |
| `adhesive` | Tile adhesive | adhesive | area | m2 | 6.5 |
| `grout` | Grout | adhesive | area | m2 | 2.8 |
| `underlay` | Underlay / membrane | subfloor | area | m2 | 8.0 |
| `backerboard` | Backer board | subfloor | area | m2 | 12.0 |
| `trim` | Edge trim | trim | linear | m | 4.5 |
| `movement` | Movement joint | trim | linear | m | 6.0 |
| `spacer` | Tile spacer | consumable | count | pc | 0.03 |
| `clip` | Levelling clip | consumable | count | pc | 0.12 |
| `sealer` | Stone sealer | finish | area | m2 | 7.0 |

**Part kinds:** `tile` (area, 300×300×8), `trim` (linear, 1000×20×8),
`fix` (count, 20×20×5), `substrate` (area, 1200×800×6), `finish` (area, 400×300×1).

**Templates:** bathroom floor, kitchen splashback, patio.

### Landscaping & paving — `landscaping.ts`

Paths, beds and walls. Paving/aggregate by area, edging by length, plants by count.

**Materials (12):**

| id | name | category | measure | unit | cost |
| --- | --- | --- | --- | --- | --- |
| `paver` | Concrete paver | paving | area | m2 | 28.0 |
| `flagstone` | Flagstone | paving | area | m2 | 55.0 |
| `brick` | Paving brick | paving | area | m2 | 32.0 |
| `sand` | Bedding sand | aggregate | area | m2 | 4.0 |
| `gravel` | Decorative gravel | aggregate | area | m2 | 9.0 |
| `topsoil` | Topsoil | aggregate | area | m2 | 12.0 |
| `membrane` | Weed membrane | subbase | area | m2 | 2.5 |
| `edging` | Edging / kerb | edge | linear | m | 7.0 |
| `sleeper` | Timber sleeper | edge | count | pc | 18.0 |
| `plant` | Plant / shrub | planting | count | pc | 6.0 |
| `bulb` | Bulbs | planting | count | pc | 0.35 |
| `drip-line` | Drip irrigation line | irrigation | linear | m | 1.4 |

**Part kinds:** `paved` (area, 600×600×50), `bed` (area, 1200×1200×100),
`edge` (linear, 1000×50×150), `plant` (count, 200×200×200),
`irrigation` (linear, 1000×16×16).

**Templates:** garden path, raised bed, retaining wall.

### Plumbing / irrigation — `plumbing.ts`

Supply, waste and garden watering. Pipe/insulation by length, fittings/fixtures by piece.

**Materials (13):**

| id | name | category | measure | unit | cost |
| --- | --- | --- | --- | --- | --- |
| `pipe-15` | Copper pipe 15 mm | pipe | linear | m | 6.5 |
| `pipe-22` | Copper pipe 22 mm | pipe | linear | m | 9.0 |
| `pex-16` | PEX pipe 16 mm | pipe | linear | m | 1.6 |
| `waste-40` | Waste pipe 40 mm | waste | linear | m | 3.2 |
| `insul-15` | Pipe insulation 15 mm | insulation | linear | m | 1.8 |
| `elbow-15` | Elbow 15 mm | fitting | count | pc | 1.2 |
| `tee-15` | Tee 15 mm | fitting | count | pc | 1.6 |
| `coupler` | Straight coupler | fitting | count | pc | 0.9 |
| `valve` | Isolation valve | fitting | count | pc | 5.5 |
| `clip` | Pipe clip | fixing | count | pc | 0.15 |
| `tap` | Outdoor tap | fixture | count | pc | 14.0 |
| `sink-trap` | Sink trap | fixture | count | pc | 8.5 |
| `ptfe` | PTFE tape | consumable | count | roll | 1.0 |

**Part kinds:** `pipe` (linear, 1000×15×15), `fitting` (count, 40×40×40),
`fixture` (count, 120×120×120), `insulation` (linear, 1000×25×25).

**Templates:** garden tap, sink waste, drip zone.

### Electrical — `electrical.ts`

Cable runs, lighting and external power. Cable/conduit by length, accessories by piece.

**Materials (13):**

| id | name | category | measure | unit | cost |
| --- | --- | --- | --- | --- | --- |
| `cable-1.5` | Twin & earth 1.5 mm² | cable | linear | m | 1.1 |
| `cable-2.5` | Twin & earth 2.5 mm² | cable | linear | m | 1.7 |
| `cable-6` | Twin & earth 6 mm² | cable | linear | m | 3.6 |
| `conduit-20` | Conduit 20 mm | containment | linear | m | 0.9 |
| `trunking` | Trunking | containment | linear | m | 2.2 |
| `backbox` | Back box | accessory | count | pc | 0.8 |
| `socket` | Double socket | accessory | count | pc | 7.5 |
| `switch` | Light switch | accessory | count | pc | 4.0 |
| `downlight` | LED downlight | lighting | count | pc | 9.0 |
| `breaker` | MCB | protection | count | pc | 6.0 |
| `gland` | Cable gland | fixing | count | pc | 1.4 |
| `clip` | Cable clip | fixing | count | pc | 0.06 |
| `wago` | Connector block | fixing | count | pc | 0.45 |

**Part kinds:** `cable` (linear, 1000×8×3), `containment` (linear, 1000×20×20),
`accessory` (count, 86×86×35), `lighting` (count, 90×90×40),
`protection` (count, 18×80×70).

**Templates:** ring main, lighting circuit, garden power.

### Welding / metalwork — `metalwork.ts`

Frames, gates and brackets. Stock by length, plate by area, fixings and consumables by
piece.

**Materials (14):**

| id | name | category | measure | unit | cost |
| --- | --- | --- | --- | --- | --- |
| `shs-40` | Box section 40×40×3 | stock | linear | m | 12.0 |
| `shs-25` | Box section 25×25×2 | stock | linear | m | 7.0 |
| `tube-33` | Round tube 33 mm | stock | linear | m | 9.0 |
| `angle-40` | Angle iron 40×40 | stock | linear | m | 8.5 |
| `flat-40` | Flat bar 40×5 | stock | linear | m | 6.0 |
| `plate-3` | Steel plate 3 mm | plate | area | m2 | 45.0 |
| `plate-5` | Steel plate 5 mm | plate | area | m2 | 68.0 |
| `bolt-m10` | Bolt M10 | fixing | count | pc | 0.7 |
| `nut-m10` | Nut M10 | fixing | count | pc | 0.15 |
| `electrode` | Welding electrode | consumable | count | pc | 0.4 |
| `wire-mig` | MIG wire | consumable | count | spool | 18.0 |
| `grinder-disc` | Cutting disc | consumable | count | pc | 1.5 |
| `primer` | Etch primer | finish | area | m2 | 8.0 |
| `paint` | Metal paint | finish | area | m2 | 10.0 |

**Part kinds:** `stock` (linear, 1000×40×40), `plate` (area, 300×300×3),
`fixing` (count, 20×20×20), `consumable` (count, 10×10×10),
`finish` (area, 300×200×1).

**Templates:** table frame, garden gate, bracket.

### Leatherworking — `leatherworking.ts`

Belts, bags and wallets. Hides/lining by area, straps/edge paint by length, findings by
piece.

**Materials (13):**

| id | name | category | measure | unit | cost |
| --- | --- | --- | --- | --- | --- |
| `veg-tan` | Vegetable-tanned hide | leather | area | m2 | 180.0 |
| `chrome-tan` | Chrome-tanned hide | leather | area | m2 | 120.0 |
| `suede` | Suede lining | lining | area | m2 | 90.0 |
| `canvas` | Waxed canvas | lining | area | m2 | 28.0 |
| `strap` | Leather strap | strap | linear | m | 12.0 |
| `edge-paint` | Edge paint | finish | linear | m | 0.8 |
| `wax` | Beeswax finish | finish | area | m2 | 6.0 |
| `thread-waxed` | Waxed thread | thread | count | spool | 8.0 |
| `buckle` | Buckle | hardware | count | pc | 4.5 |
| `d-ring` | D-ring | hardware | count | pc | 1.2 |
| `rivet` | Rivet | hardware | count | pc | 0.1 |
| `snap` | Snap fastener | hardware | count | pc | 0.6 |
| `clasp` | Bag clasp | hardware | count | pc | 6.0 |

**Part kinds:** `panel` (area, 300×200×3), `strap` (linear, 800×25×3),
`lining` (area, 250×150×1), `hardware` (count, 40×40×10), `finish` (area, 300×200×1).

**Templates:** belt, card wallet, tote bag.

---

## Good fits (not yet implemented)

These work in the model but stretch one dimension of the unit story, so they need a
deliberate decision (noted per profile).

### 3D printing / laser cutting

Enclosures, jigs and flat-pack kits. Filament is naturally by mass or spool (`count`),
while laser sheet stock is `area` — pick one measure per material and keep it honest;
never model filament as `linear`.

**Display:** `mm`, precision 1, grid 1.

**Materials:** `pla` (count, spool), `petg` (count, spool), `resin` (count, bottle),
`acrylic-3` (area), `ply-laser` (area), `mdf-laser` (area), `screw-insert` (count),
`bearing` (count), `magnet` (count), `rubber-band` (count), `sandpaper` (area).

**Part kinds:** `printed` (count, 40×40×40), `sheet` (area, 300×200×3),
`hardware` (count, 20×20×10), `panel` (area, 300×300×3).

**Templates:** enclosure, drill jig, flat-pack box.

### Quilting / upholstery

Soft furnishings and quilts, distinct from `clothes` (garment patterns). Fabric, batting
and backing are `area`; binding and piping are `linear`; buttons and tacks are `count`.
Overlaps `clothes` conceptually — keep the category set and templates separate so users
know which to pick.

**Display:** `cm`, precision 1, grid 10.

**Materials:** `quilting-cotton` (area), `batting` (area), `backing` (area),
`binding` (linear), `piping` (linear), `thread` (count), `button-tuft` (count),
`foam` (area), `webbing` (linear), `tack` (count).

**Part kinds:** `quilt-piece` (area, 1200×1200×5), `batting` (area, 1200×1200×20),
`binding` (linear, 2000×50×5), `notion` (count, 30×30×10).

**Templates:** lap quilt, cushion, footstool cover.

### Aquarium / terrarium scaping

Planted tanks, vivariums and paludariums. Substrate and planting area are `area`;
hardscape, livestock and equipment are `count`; CO2/tubing is `linear`. A good showcase
of a `count`-heavy, living-domain profile.

**Display:** `mm`, precision 0, grid 5.

**Materials:** `substrate` (area), `sand` (area), `aquasoil` (area), `driftwood` (count),
`stone` (count), `plant` (count), `moss` (area), `fertiliser` (count), `co2-line` (linear),
`filter-media` (count), `livestock` (count).

**Part kinds:** `substrate` (area, 600×300×50), `hardscape` (count, 200×200×200),
`flora` (count, 100×100×100), `equipment` (count, 150×150×150),
`line` (linear, 1000×4×4).

**Templates:** nano planted, paludarium, goldfish tank.

### Model making / miniatures

Dioramas, scale buildings and tabletop terrain. Styrene sheet and card are `area`; rod,
tube and strip are `linear`; figures and detail parts are `count`. Same shape as
woodworking/leatherworking but with tiny defaults.

**Display:** `mm`, precision 1, grid 1.

**Materials:** `styrene-sheet` (area), `card` (area), `balsa` (linear),
`rod-styrene` (linear), `tube-brass` (linear), `paint` (area), `primer` (area),
`glue` (count), `detail-part` (count), `photo-etch` (count), `static-grass` (area).

**Part kinds:** `sheet` (area, 100×100×1), `strip` (linear, 200×3×3),
`detail` (count, 10×10×10), `terrain` (area, 300×300×20), `paint` (area, 100×100×1).

**Templates:** diorama base, scale building, terrain tile.

---

## Weak fits

Mostly `count`-only assemblies with little linear/area content, so the BOM is a parts
list rather than a materials estimate: **PC builds**, **bicycle building**, **solar panel
installs**, **beekeeping**, **equipment-only aquarium setups**. They could still ship as
profiles, but they mostly exercise `count` and duplicate existing material categories.
Prefer them only if a real user asks.
