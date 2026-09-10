# Ruin Lab

A static Three.js voxel-ruins simulator. Pick a structure, set the conditions, and explore a deterministic history across centuries.

## Run

```sh
bun install
bun run dev
```

Open the URL Vite prints. Node 20.19+/22.12+ with npm also works (`npm install && npm run dev`).

```sh
bun run build       # production files in dist/
bun run preview     # serve the production build locally
```

Deploy **the contents of `dist/`** to any static HTTP host (GitHub Pages, Netlify, Cloudflare Pages, etc.). Relative asset paths support hosting under a subdirectory. No runtime backend, API key, or CDN dependency; fonts and examples are bundled locally. Serve over HTTP rather than opening `index.html` with `file://`, because ES modules, fetch, and workers need an HTTP origin.

## Features

- Four actual JSON example builds: coastal watchtower, hillside chapel, courtyard villa, and forest cottage.
- Instanced voxel rendering, directional shadows, orbit/pan/zoom, top view, grid toggle, fullscreen, and PNG snapshots.
- A responsive interface with climate presets, independent pass toggles, material-aware parameters, a random seed, 6–30 keyframes, and 25–500 years per step.
- Worker-based simulation keeps the interface responsive.
- Timeline scrubbing, playback, playback speed, and restart.
- Local file import, drag-and-drop, and remote JSON import (source must permit CORS).
- Export complete timelapses or the currently displayed standalone structure; both can be re-imported.
- Pure JavaScript engine usable offline without Three.js or a browser.

## JSON interchange

Coordinates are **X, Y (up), Z**. Size defines the valid coordinate bounds, not the occupied extents. Voxel tuples are `[x, y, z, materialID]`. Air is always material `0`; absent cells are air.

```json
{
  "version": 1,
  "size": [12, 8, 10],
  "materials": {
    "0": { "name": "air" },
    "1": { "name": "stone", "color": "#8a8a85", "durability": 1.0, "decays_to": "3" },
    "2": { "name": "wood", "color": "#8b5a2b", "durability": 0.25, "decays_to": "0" },
    "3": { "name": "rubble", "color": "#6e6a63", "durability": 0.6, "decays_to": "0", "loose": true },
    "4": { "name": "thatch", "color": "#c9a24b", "durability": 0.05, "decays_to": "0" },
    "5": { "name": "soil", "color": "#5b4a2f", "durability": 2.0, "ground": true }
  },
  "voxels": [[0, 0, 0, 1], [1, 0, 0, 1], [0, 1, 0, 1], [3, 4, 2, 2], [3, 5, 2, 4]]
}
```

### Material properties

| Property | Meaning |
|---|---|
| `name` | Required material name. |
| `color` | Six-digit hex color, required for non-air materials. |
| `durability` | Positive resistance to decay. Defaults to 1. |
| `decays_to` | Next material ID, as a string or number. Missing means no weathering transition. Multi-stage graphs and self-loops are supported. |
| `ground` | Protected from weathering; serves as structural support and a sediment material. |
| `loose` | Cannot bridge spans; settles under gravity and spreads as talus. The first loose material is used for impact rubble. |
| `span` | Optional per-material horizontal support distance, overriding the global setting. |
| `organic` | Non-load-bearing vegetation. Generated plant materials use this. |
| `render` | Optional plant appearance: `moss`, `tuft`, or `vine`. |

The engine adds moss, wild grass, and ivy to the exported palette when overgrowth is enabled and palette slots are available; it does **not** modify the original voxel list. Vegetation is represented by real voxel IDs so it survives JSON export. Ground and organic materials do not carry engineering-grade physical properties.

### Timelapses

```json
{
  "structure": { "version": 1, "size": [1, 2, 1], "materials": { "0": { "name": "air" }, "1": { "name": "stone", "color": "#8a8a85", "decays_to": "0" } }, "voxels": [[0, 0, 0, 1], [0, 1, 0, 1]] },
  "step_years": 100,
  "seed": 1847,
  "frames": [
    { "t": 100, "set": [[0, 1, 0, 0]] },
    { "t": 200, "set": [[0, 0, 0, 0]] }
  ]
}
```

`structure` is year zero. Apply each `set` patch **in order** to the previous state; ID `0` deletes a cell. Patches include additions and replacements as well as removals. Empty patches are valid. `t` is elapsed years and must strictly increase. The app also exports `settings` and per-frame `stats` as optional metadata. Imported frame times need not be evenly spaced.

Validation rejects duplicate coordinates, unknown materials, invalid colors, nonpositive durability, out-of-bounds cells, and unordered timelapses. Limits: dimensions ≤128, volume ≤2,000,000, 150,000 input voxels, 256 materials, 100 imported frames, 2,000,000 imported patch updates, and 50 MB per file. Very large or dense models will still cost more memory and render time; this is a diorama tool, not a world-save viewer.

## How the simulation works

Each coarse step runs:

1. **Exposure decay** — A column heightfield estimates sky access and shelter. Exposed side faces, prevailing wind, elevation, and spatially correlated weak areas contribute to a material transition probability. Durability reduces that probability. Elapsed years scale the hazard exponentially.
2. **Optional water erosion** — Rain particles sample the heightfield, advance surface materials along their decay graphs, and walk downhill. This is a lightweight erosion approximation, not a fluid or mineral-transport solver.
3. **Structural collapse** — Support propagates upward from ground and across each course within material span limits. Unsupported connected fragments drop as clusters; hard impacts can create rubble. Loose blocks settle and spread locally.
4. **Burial / sediment** — A smooth distance-field apron around the original structure grows with time. Soil fills reachable empty lower cells, burying the bottom courses without overwriting them or piling sediment on roofs. Requires a `ground` material.
5. **Overgrowth** — Sky-lit surfaces seed grass or moss; ivy clings to vertical walls. Plants are non-load-bearing and detached plants are removed.

This is **artistic procedural weathering, not a physical prediction**. Current simplifications: no stress/force solver or true cantilever mechanics; no trees, root displacement, face-texture moss, water penetration, mineral transport, or semantic preservation of chests/signs. Falling hard materials are distinguished from timber/thatch by their names. Sediment and rubble stay inside the declared grid: leave a margin when authoring structures. Decay updates use the start-of-step state; later passes use the result of earlier passes.

The same structure, seed, settings, and engine version produce the same patches. There is no `Math.random()` in the engine. Disabled passes do not alter the state.

## Add structures

1. Add a schema-compatible JSON file to `public/examples/`, or host it remotely with CORS.
2. Add an entry to `public/examples/manifest.json`:

```json
{
  "id": "my-keep",
  "name": "My keep",
  "period": "14th century · Military",
  "description": "A small stone keep.",
  "file": "examples/my-keep.json",
  "tags": ["Stone", "Timber"],
  "dimensions": [24, 28, 24],
  "voxelCount": 2000
}
```

`file` may also be an absolute HTTPS URL. Add a matching thumbnail at `public/examples/my-keep.svg`. The library is fetched at runtime, so deployed JSON and manifest files can be updated without rebuilding the JS. Keep remote JSON endpoints under your control.

The supplied builds are generated reproducibly by `scripts/generate-examples.mjs`. `bun run examples` regenerates the built-in JSON, manifest, and SVG thumbnails (and overwrites manual edits to those built-ins). `node scripts/generate-thumbnails.mjs` regenerates thumbnails from local manifest entries.

## Offline / batch usage

```sh
bun scripts/simulate.mjs public/examples/coastal-watchtower.json /tmp/watchtower-history.json
# Optional third argument: a JSON object of settings
bun scripts/simulate.mjs structure.json history.json settings.json
```

Or import the engine directly:

```js
import { simulate } from './src/engine.js';
import { replayFrame } from './src/schema.js';

const history = simulate(structure, {
  seed: 1847,
  steps: 20,
  stepYears: 100,
  weathering: 1.2,
  exposure: true,
  collapse: true,
  sediment: true,
  overgrowth: true,
  water: false,
  sedimentRate: 0.45,
  growthRate: 0.65,
  rainfall: 0.6,
  span: 3,
  wind: 'NW'
});
const finalVoxels = replayFrame(history.structure, history.frames, history.frames.length);
```

A future game-save integration can invoke this per structure or chunk, but this project does not read or write Vintage Story save files. Chunk boundaries need halo/support handling and game-specific material mappings before use on real worlds.

## Tests

```sh
bun run test
bunx playwright install chromium
bun run test:browser
# Or use an installed browser:
CHROMIUM_PATH=/path/to/chromium bun run test:browser
```

Unit tests cover determinism, immutable inputs, all-pass-off behavior, support/gravity, material graph edges, ground preservation, schema validation, generated vegetation, and frame replay. Browser tests cover all examples, real WebGL startup, mobile overflow, simulation controls, playback, file/URL import, JSON round trips, and PNG export.

## Project map

- `src/engine.js` — deterministic simulation, no browser dependencies
- `src/schema.js` — validation and patch replay
- `src/simulation.worker.js` — worker adapter
- `src/viewer.js` — Three.js instanced renderer
- `src/main.js` — interface and application state
- `src/style.css`, `index.html` — responsive UI
- `public/examples/` — runtime structure library
- `scripts/` — reproducible builds, thumbnails, offline simulation

Bundled DM Sans and Manrope fonts use the SIL Open Font License; license texts are in `public/fonts/`.
