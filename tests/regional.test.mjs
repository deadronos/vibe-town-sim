import assert from "node:assert/strict";
import { test } from "node:test";
import { createCity, execute, snapshot, restore } from "../src/core/sim/city.ts";

test("regional commands replay exactly across checkpoint boundaries", () => {
  const commands = [
    {
      kind: "road",
      points: [
        { x: -400, z: -300 },
        { x: -200, z: -300 },
      ],
      road: "street",
    },
    { kind: "step", count: 30 },
    {
      kind: "road",
      points: [
        { x: -200, z: -300 },
        { x: -200, z: -450 },
      ],
      road: "avenue",
    },
  ];
  const city = createCity(7);
  for (const command of commands) assert.equal(execute(city, command).ok, true);
  let replay = createCity(7);
  for (const command of commands) {
    assert.equal(execute(replay, command).ok, true);
    replay = restore(snapshot(replay));
  }
  assert.deepEqual(snapshot(replay), snapshot(city));
});

test("invalid gestures preserve funds, topology, and the world revision", () => {
  const city = createCity(7);
  const before = snapshot(city);
  assert.equal(
    execute(city, {
      kind: "road",
      points: [
        { x: 0, z: 0 },
        { x: 0, z: 0 },
      ],
      road: "street",
    }).ok,
    false,
  );
  assert.deepEqual(snapshot(city), before);
  assert.throws(() => restore({ version: 1 }));
  assert.throws(() => restore({ ...before, cash: NaN }));
});
