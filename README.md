# Vibe Town

A single-player, perspective 3D city builder for the web. Juniper Bay opens with a developed coastal town. Choose **Town menu → Start an empty island** to build from scratch with $18,000.

## Run

Use Node.js 24 or newer and pnpm.

```sh
pnpm install
pnpm dev
```

Open http://127.0.0.1:4173. Vite serves the game and reloads local edits. Set `PORT` to choose another port.

- `pnpm build` produces a static site in `dist/`. Serve this directory on any static host.
- `pnpm test` runs the simulation tests using Node’s built-in test runner.
- `pnpm check` checks TypeScript, lint and formatting.

The game uses native ES modules, DOM controls and a small WebGL2 renderer. All geometry is procedural. Vite, TypeScript 7, Oxlint and Oxfmt are development tools. The browser downloads only the game’s own HTML, CSS and JavaScript.

## Playing

1. Build a continuous road. Place a wind turbine and a water tower directly beside it.
2. Zone land along the same road for homes, shops and industry. Occupied lots progress through three development levels. Each utility supplies up to 200 levels on its road network.
3. Inspect tiles to check utility access. Add parks to improve happiness. Open Treasury to compare monthly income and upkeep or change the tax rate.
4. Pause while planning, or advance time at 1×, 2× or 4×. Building and monthly changes autosave in this browser for this site address.

Choose **Town menu → Try the commute district** to play two streets with independent utilities. Inspect the homes, build a road across the one-tile gap, then check the homes and Treasury again. Cars follow the roads linking assigned workers to their jobs. Removing that link interrupts the commutes and their tax contribution.

If the game cannot read a save, it protects the original and lets you play temporarily. Open **Town menu → Recover original save** to download it or explicitly replace it with the current town.

## Controls

| Action                                 | Control                                        |
| -------------------------------------- | ---------------------------------------------- |
| Build or bulldoze                      | Select a tool, then click or drag across tiles |
| Select a tool                          | 1–8                                            |
| Inspect a tile                         | I, then click                                  |
| Pan                                    | Drag in inspect mode or Shift-drag             |
| Zoom                                   | Scroll, + or −                                 |
| Orbit and tilt                         | Right-drag, or select Orbit (O) and drag       |
| Rotate a quarter turn                  | R                                              |
| Toggle zone colors                     | L                                              |
| Pause or resume                        | Space                                          |
| Deselect                               | Escape                                         |
| Undo construction in the current month | Ctrl/Cmd+Z or Town menu                        |

The toolbar scrolls horizontally on small screens. Touch users can switch to the pointer tool to pan and use the Orbit tool to rotate and tilt with one finger.

## Regional preview

Open [the regional preview](http://127.0.0.1:4173/regional.html) or follow **Play the regional preview** from the classic game. Juniper Reach opens with an industrial town. **Start a new city** offers Cedar Crossing, a commuter-focused map, and empty sandboxes on either seed. **City objectives** lists the next construction and expansion steps. Use **Land** to select a neighboring tile and preview acquisition and upkeep.

- **Road** uses a start and end point. **Curve** adds a control point. The road inspector offers upgrades, and the bridge option supports water crossings.
- **Zone** paints one or both sides of a road. The brush applies zoning near the pointer. New development needs power, potable water and sewage service. **Layers** shows these networks, traffic queues, transit, noise, pollution and land value.
- **Transit** puts stops on streets or avenues. Select at least two stops in route order before opening a bus or tram line.
- Regional **Save** writes an isolated IndexedDB checkpoint. The regional game opens the saved checkpoint on a normal reload. **Export** downloads a JSON checkpoint and **Import** validates it before replacing the active session. Classic saves use their existing storage and recovery controls.

[Regional implementation and verification notes](docs/rewrite-plan/regional-preview.md) list benchmark commands and the current preview limits.
