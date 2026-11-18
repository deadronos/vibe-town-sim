# Vibe Town

A regional 3D city builder for the web. Plan roads, grow neighborhoods and connect households, businesses and public services across an 8 × 8 km region.

## Run

Use Node.js 24 or newer and pnpm.

```sh
pnpm install
pnpm dev
```

Open [Vibe Town](http://127.0.0.1:4173/). Set `PORT` to choose another port.

- `pnpm build` produces a static site in `dist/`.
- `pnpm test` runs the simulation tests.
- `pnpm check` checks TypeScript, lint and formatting.

The game uses Three.js for the viewport, React for the interface and a TypeScript Web Worker for the simulation.

## Playing

Juniper Reach opens with an industrial town. **Start a new city** offers Cedar Crossing, a commuter-focused map, and empty sandboxes on either seed. **City objectives** lists the next construction and expansion steps. Use **Land** to select a neighboring tile and preview acquisition and upkeep.

- **Road** uses a start and end point. **Curve** adds a control point. The road inspector offers upgrades, and the bridge option supports water crossings.
- **Zone** paints one or both sides of a road. The brush applies zoning near the pointer. New development needs power, potable water and sewage service. **Layers** shows these networks, traffic queues, transit, noise, pollution and land value.
- **Transit** puts stops on streets or avenues. Select at least two stops in route order before opening a bus or tram line.
- Regional **Save** writes an isolated IndexedDB checkpoint. The regional game opens the saved checkpoint on a normal reload. **Export** downloads a JSON checkpoint and **Import** validates it before replacing the active session. The regional format requires a new city or an imported regional checkpoint.

[Regional implementation and verification notes](docs/rewrite-plan/regional-preview.md) list benchmark commands and the current preview limits.
