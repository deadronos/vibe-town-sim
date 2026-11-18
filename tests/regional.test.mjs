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

test("a road cut stops arrivals, rerouting restores sales, and inventory and cash reconcile", () => {
  const city = createCity(7);
  const act = (command) => {
    const reply = execute(city, command);
    assert.ok(reply.ok, JSON.stringify(reply));
  };
  const line = (a, b) => {
    act({
      kind: "road",
      points: [
        { x: a, z: -570 },
        { x: b, z: -570 },
      ],
      road: "street",
    });
    return city.roads.at(-1).id;
  };
  const west = line(-950, -750);
  const link = line(-750, -550);
  const east = line(-550, -350);
  act({ kind: "zone", roadId: west, zone: "industry", side: "left" });
  act({ kind: "zone", roadId: west, zone: "homes", side: "right" });
  act({ kind: "zone", roadId: east, zone: "shops", side: "left" });
  act({ kind: "zone", roadId: east, zone: "apartments", side: "right" });
  act({ kind: "facility", at: { x: -830, z: -460 }, service: "power" });
  act({ kind: "facility", at: { x: -800, z: -460 }, service: "water" });
  act({ kind: "facility", at: { x: -890, z: -460 }, service: "sewage" });
  act({ kind: "step", count: 210 });
  assert.ok(city.economy.consumed > 0);
  act({ kind: "demolish", id: link });
  act({ kind: "step", count: 30 });
  const disconnected = city.economy.consumed;
  assert.equal(
    city.economy.trips.some((trip) => trip.edges.includes(link)),
    false,
  );
  act({ kind: "step", count: 30 });
  assert.equal(city.economy.consumed, disconnected);
  for (const points of [
    [
      { x: -750, z: -570 },
      { x: -690, z: -680 },
    ],
    [
      { x: -690, z: -680 },
      { x: -560, z: -675 },
    ],
    [
      { x: -560, z: -675 },
      { x: -550, z: -570 },
    ],
  ]) {
    act({ kind: "road", points, road: "street" });
  }
  const reloaded = restore(snapshot(city));
  act({ kind: "step", count: 100 });
  execute(reloaded, { kind: "step", count: 100 });
  assert.deepEqual(snapshot(city), snapshot(reloaded));
  assert.ok(city.economy.consumed > disconnected);
  const firms = Object.values(city.economy.firms);
  assert.ok(firms.every((firm) => firm.inventory >= 0 && firm.staff <= firm.jobs));
  const cargo = city.economy.trips
    .filter((trip) => trip.kind === "shipment")
    .reduce((sum, trip) => sum + trip.quantity, 0);
  assert.equal(
    city.economy.produced + city.economy.imported,
    city.economy.consumed +
      city.economy.exported +
      city.economy.scrapped +
      cargo +
      firms.reduce((sum, firm) => sum + firm.inventory, 0),
  );
  assert.equal(city.cash, 280_000 + city.economy.receipts - city.economy.expenses);
});

test("river expansion adds service demand and a bus moves queued commuter cohorts", () => {
  const city = createCity(7);
  const act = (command) => {
    const reply = execute(city, command);
    assert.ok(reply.ok, JSON.stringify(reply));
  };
  const road = (points, bridge = false) => {
    act({ kind: "road", points, road: "avenue", bridge });
    return city.roads.at(-1).id;
  };
  act({ kind: "purchase", tile: "2,1" });
  const west = road([
    { x: -480, z: -570 },
    { x: -195, z: -570 },
  ]);
  road(
    [
      { x: -195, z: -570 },
      { x: 445, z: -570 },
    ],
    true,
  );
  const east = road([
    { x: 445, z: -570 },
    { x: 830, z: -570 },
  ]);
  act({ kind: "zone", roadId: west, zone: "towers", side: "both" });
  act({ kind: "zone", roadId: east, zone: "offices", side: "both" });
  act({ kind: "facility", at: { x: -400, z: -465 }, service: "power" });
  act({ kind: "facility", at: { x: -365, z: -465 }, service: "water" });
  act({ kind: "step", count: 90 });
  assert.equal(
    city.parcels.some((lot) => lot.built),
    false,
  );
  act({ kind: "facility", at: { x: -330, z: -465 }, service: "sewage" });
  act({ kind: "facility", at: { x: 730, z: -465 }, service: "sewage" });
  act({ kind: "facility", at: { x: 695, z: -465 }, service: "power" });
  act({ kind: "facility", at: { x: 660, z: -465 }, service: "water" });
  act({ kind: "facility", at: { x: 625, z: -465 }, service: "garbage" });
  act({ kind: "district", tile: "2,1", name: "East Bank", tax: 12, budget: 100 });
  act({ kind: "step", count: 90 });
  assert.ok(city.economy.commutes > 0);
  assert.ok(city.region.response.garbage > 0);
  const stops = [];
  for (const at of [
    { x: -325, z: -570 },
    { x: 620, z: -570 },
  ]) {
    act({ kind: "stop", at });
    stops.push(city.region.stops.at(-1).id);
  }
  act({ kind: "line", line: "bus", stops });
  act({ kind: "step", count: 90 });
  assert.ok(city.region.lines[0].riders > 0);
  assert.equal(city.region.districts["2,1"].name, "East Bank");
  assert.deepEqual(restore(snapshot(city)), city);
});
