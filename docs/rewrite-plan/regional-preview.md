# Regional preview

The regional game is available at `/regional.html` and from the classic game’s city overview. Build outputs contain both pages. The published entry point can stay on the classic game while the remaining regional release checks run.

The implementation plan describes the intended architecture and scale. This report records what the preview can do and what was exercised.

## Playable coverage

| Milestone | Implemented behavior and fixture                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A         | Versioned worker protocol, deterministic day batches and checkpoint replay, separate panel and scene messages, typed vehicle poses, React HUD and inspector, and eight-by-eight-kilometre terrain with a four-square-kilometre starter tile. The Three.js renderer uses chunk LOD, incremental road meshes, repeated building geometry and vehicle interpolation. The browser fixture aborts an IndexedDB write and reloads the preceding checkpoint. |
| B         | Straight and quadratic roads, snap, junction splitting, grade and cost preview, upgrades, sidewalks, bridges, strip and brush zoning, stable parcel IDs, utility-connected development, and original Blender and procedural buildings. The scenario checks junctions, utility development, upgrades and exact reload. Browser tests pick and demolish the same road at planning and low angles.                                                       |
| C         | Household and firm accounts, vacancy and job access signals, capacity-aware road cohorts, trip arrivals, factory-to-shop cargo escrow, retail sales, an integer ledger and a regional highway connection. The fixture cuts the only connecting road, observes sales stop, reconnects over a longer path and reconciles cash and cargo across checkpoint replay.                                                                                       |
| D         | Power, potable water and sewage capacity, budgeted garbage, clinic, fire and school services with road-based round trips, land purchase, tile district policies, bus and tram lines, congestion and field overlays, and an introductory objectives panel. The scenario buys the east river bank, diagnoses missing sewage, adds capacity and boards passengers after opening a bus line.                                                              |
| E         | Industry and commuter openings on separate seeds, empty sandboxes, medium and high-density zoning, mixed use, offices, connected road freight and terminals, trams and one-time recovery financing. Both openings replay year by year over ten additional in-game years. The overbuilding scenario takes a recovery loan, trims service spending and verifies repayments and the ledgers.                                                             |

The industrial opening begins with 1,254 residents and $117,345, ending the ten-year idle run with $192,864. The commuter opening begins with 860 residents and $119,966, ending with $10,026. The commuter opening leaves a much narrower margin for further infrastructure spending. The tests use integer dollars at gameplay scale.

## Reproduce

```sh
pnpm install
pnpm check
pnpm test
pnpm build

# In a separate terminal
PORT=4177 pnpm dev

pnpm exec playwright install firefox webkit
node tests/browser/regional.mjs chrome firefox webkit
node bench/region/render.mjs
node bench/region/sim.mjs
REGIONAL_TICKS=19200 node bench/region/sim.mjs

# Run the browser soak against a separate Vite preview process
PORT=4178 pnpm preview
node bench/region/soak.mjs
```

The Chrome checks use the locally installed Google Chrome. The benchmark uses macOS ANGLE Metal flags. `REGIONAL_URL` can target an equivalent local preview server. Browser checks use disposable browser profiles. The `qa` and `benchmark` query modes are for local fixtures.

## Browser and scale measurements

- Chrome 144.0.7559.133 using ANGLE Metal on Apple M4, Playwright Firefox 159.0 and Playwright WebKit 27.2 passed the construction, camera angles, rejected import, interrupted write, reload, land purchase and utility-layer walkthrough. Firefox reported `Apple M1, or similar` and Playwright WebKit reported `Apple GPU`.
- Installed Safari was checked manually in a private window. It rendered the populated starter and map layers and saved and loaded its checkpoint. Safari WebDriver could not create a session while Allow Remote Automation was off. The expanded automated walkthrough for WebKit used Playwright’s browser build.
- The synthetic renderer workload has 10,000 building slots and 2,000 moving vehicle instances across the full map. It measures rendering with fabricated geometry and vehicle paths. Browser memory values are reported JS heap, and frame intervals are animation callbacks.
- The separate density fixture uses 1,204 developed, utility-supplied lots and 17,888 modeled residents. It uses a benchmark construction grant and advances 16 simulated days per batch. It verifies checkpoint and balance invariants under load. It is deliberately congested and runs a deficit, so use the two opening fixtures for balance comparisons.

## Preview limits

- Roads are bidirectional and use a capacity budget per segment. Lane-level turning reservations, parking and detailed walking paths remain follow-up work. Freight routes can pass through a terminal with a larger outbound batch. Terminal warehouse inventory and intermodal transfers are future work.
- Public services have shared dispatch and return, funding and capacity, and measured residents served. Detailed fire incidents, healthcare outcomes and school cohorts are later service simulation work. Spatial fields visualize proximity and land-use effects at lots. Objectives introduce systems, while the tools are available throughout the game.
- Both renderers were measured on the same Apple M4. A second integrated GPU, 50,000 simulated residents and 10,000 occupied simulation lots are unverified. Render fixture counts describe geometry workload. They provide no estimate of the production city’s maximum sustainable population.
- Later parity work includes household lifecycles, intermodal rail and port networks, terrain editing, seasons, audio, photo mode, asset editing and mods.

## Assets

`public/region/coastal-{sand,cedar,sage}.glb` are original procedural rowhouses created for Vibe Town. The models contain project-generated geometry and solid materials. Asset rights follow the project’s repository terms. The source and one-command regeneration use Blender’s factory defaults and a background process.

```sh
blender --background --factory-startup --python tools/assets/build_coastal_kit.py -- public/region
```
