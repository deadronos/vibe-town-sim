import assert from "node:assert/strict";
import { createCity, execute } from "../../src/core/sim/city.ts";
import { suppliedParcels } from "../../src/core/sim/development.ts";
import { transfer } from "../../src/core/sim/economy.ts";

export function denseCity() {
  const city = createCity(7);
  transfer(city, "regional", "city", 3_000_000, "Density benchmark grant");

  function act(command) {
    const result = execute(city, command);
    assert.ok(result.ok, JSON.stringify({ command, result }));
  }

  const positions = Array.from({ length: 14 }, (_, i) => -1850 + i * 95);
  for (const [i, z] of positions.entries()) {
    const end = { x: -223, z };
    act({ kind: "road", points: [{ x: -1900, z }, end], road: "avenue" });
    const roadId = city.roads.at(-1).id;
    act({ kind: "zone", roadId, zone: i < 6 ? "homes" : "apartments", side: "left" });
    act({
      kind: "zone",
      roadId,
      zone: i < 6 ? "homes" : i % 2 ? "offices" : "shops",
      side: "right",
    });
    if (i > 0)
      act({
        kind: "road",
        points: [
          { x: -1900, z: positions[i - 1] },
          { x: -1900, z },
        ],
        road: "avenue",
      });
  }

  for (const z of positions) {
    for (const [i, service] of [
      "power",
      "water",
      "sewage",
      "power",
      "water",
      "sewage",
      "power",
      "water",
      "sewage",
    ].entries()) {
      act({ kind: "facility", at: { x: -1850 + i * 26, z: z + 47 }, service });
    }
  }
  const supplied = suppliedParcels(city);
  for (const parcel of city.parcels) parcel.built = supplied.has(parcel.id);
  const reply = execute(city, { kind: "step", count: 1 });
  assert.ok(reply.ok);
  return city;
}
