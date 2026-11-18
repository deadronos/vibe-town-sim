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

test("junction splits persist existing frontage addresses and utility-enabled growth", () => {
  const city = createCity(7);
  const act = (command) => assert.equal(execute(city, command).ok, true);
  act({
    kind: "road",
    points: [
      { x: -800, z: -600 },
      { x: -600, z: -590 },
      { x: -400, z: -600 },
    ],
    road: "street",
  });
  const road = city.roads.at(-1).id;
  act({ kind: "zone", roadId: road, zone: "homes", side: "both" });
  const addresses = city.parcels.map((parcel) => parcel.id);
  assert.ok(addresses.length > 3);
  act({
    kind: "road",
    points: [
      { x: -600, z: -800 },
      { x: -600, z: -450 },
    ],
    road: "street",
  });
  assert.equal(city.roads.length, 4);
  assert.deepEqual(
    city.parcels.map((parcel) => parcel.id),
    addresses,
  );
  for (const parcel of city.parcels)
    assert.ok(city.roads.some((segment) => segment.id === parcel.roadId));
  act({ kind: "facility", at: { x: -650, z: -590 }, service: "power" });
  act({ kind: "facility", at: { x: -600, z: -640 }, service: "water" });
  act({ kind: "facility", at: { x: -600, z: -680 }, service: "sewage" });
  act({ kind: "step", count: 120 });
  assert.ok(city.parcels.some((parcel) => parcel.built));
  act({ kind: "upgrade", roadId: road, road: "avenue" });
  assert.deepEqual(restore(snapshot(city)).parcels, city.parcels);
});
