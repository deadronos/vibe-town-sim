import { createCity, execute, type Command } from "./city.ts";
import type { RoadClass } from "../network/roads.ts";
import type { Point } from "../world/terrain.ts";

export function createOpening(seed: number) {
  const city = createCity(seed);
  const commuter = seed !== 7;
  function play(command: Command) {
    const result = execute(city, command);
    if (!result.ok) throw new Error(`Opening roadbook: ${command.kind} — ${result.reason}`);
  }

  function street(points: Point[], road: RoadClass = "street") {
    play({ kind: "road", road, points });
    return city.roads.at(-1)!.id;
  }

  const centerZ = commuter ? -710 : -760;
  const gateway = street(
    [
      { x: -1795, z: centerZ },
      { x: -1170, z: centerZ },
    ],
    "highway",
  );
  play({ kind: "gateway", roadId: gateway });
  const west = street(
    [
      { x: -1170, z: centerZ },
      { x: -865, z: centerZ },
    ],
    "avenue",
  );
  const center = street(
    [
      { x: -865, z: centerZ },
      { x: -540, z: centerZ },
      { x: -375, z: centerZ - 25 },
    ],
    "avenue",
  );
  const north = street([
    { x: -865, z: centerZ },
    { x: -885, z: centerZ - 140 },
    { x: -842, z: centerZ - 315 },
  ]);
  const east = street([
    { x: -375, z: centerZ - 25 },
    { x: -319, z: centerZ + 62 },
    { x: -365, z: centerZ + 260 },
  ]);
  const bend = street([
    { x: -865, z: centerZ },
    { x: -815, z: centerZ + 126 },
    { x: -701, z: centerZ + 170 },
    { x: -521, z: centerZ + 153 },
  ]);
  const southern = street([
    { x: -521, z: centerZ + 153 },
    { x: -499, z: centerZ + 247 },
    { x: -365, z: centerZ + 260 },
  ]);
  for (const [roadId, zone, side] of [
    [west, commuter ? "offices" : "industry", "left"],
    [center, "shops", "left"],
    [center, "apartments", "right"],
    [north, commuter ? "mixed" : "homes", "both"],
    [east, "apartments", "both"],
    [bend, "homes", "both"],
    [southern, commuter ? "towers" : "mixed", "left"],
  ] as const)
    play({ kind: "zone", roadId, zone, side });

  for (const [x, z, service] of [
    [-1130, centerZ - 94, "power"],
    [-1100, centerZ - 94, "water"],
    [-1070, centerZ - 94, "sewage"],
    [-1040, centerZ - 94, "sewage"],
    [-1010, centerZ - 94, "water"],
    [-980, centerZ - 94, "power"],
    [-943, centerZ + 110, "garbage"],
  ] as const)
    play({ kind: "facility", at: { x, z }, service });

  play({ kind: "tax", rate: 15 });
  play({ kind: "step", count: 270 });
  return city;
}
