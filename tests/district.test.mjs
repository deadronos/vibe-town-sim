import test from "node:test";
import assert from "node:assert/strict";
import { createCity, createCommuteDistrict, place, id, stats, restore, tick } from "../src/sim.ts";
import { matchCommutes } from "../src/commutes.ts";
import { openSave } from "../src/saves.ts";

test("commuters, routes and income follow a road link through cut, reload and reconnection", () => {
  const city = createCommuteDistrict(),
    home = id(13, 19),
    work = id(23, 19);
  const disconnected = stats(city);
  assert.deepEqual(
    [
      disconnected.population,
      disconnected.jobs,
      disconnected.commute.employed,
      disconnected.income,
    ],
    [24, 48, 0, 12],
  );
  for (let round = 0; round < 2; round++) {
    assert.equal(place(city, 18, 18, "road"), undefined);
    const connected = stats(city);
    assert.equal(connected.commute.employed, 14);
    assert.equal(connected.employmentTax, 8);
    assert.deepEqual(connected.commute.routes, [
      {
        home,
        workplace: work,
        workers: 14,
        path: Array.from({ length: 11 }, (_, i) => id(13 + i, 18)),
      },
    ]);
    assert.deepEqual(stats(restore(JSON.stringify(city))).commute, connected.commute);
    place(city, 18, 18, "bulldoze");
    assert.deepEqual(stats(city).commute, disconnected.commute);
    assert.equal(stats(city).income, 12);
  }
});
test("households share vacancies without exceeding supply and use all road entrances", () => {
  // Road 0 is isolated. Road 1 reaches road 2. Home 3 can enter either.
  const result = matchCommutes(
    [[], [2], [1], [0, 1], [1], [2], [0]],
    [0, 0, 0, 4, 4, 0, 0],
    [0, 0, 0, 0, 0, 5, 2],
  );
  assert.deepEqual(
    result.routes.map((r) => [r.home, r.workplace, r.workers, r.path]),
    [
      [3, 6, 2, [0]],
      [3, 5, 2, [1, 2]],
      [4, 5, 3, [1, 2]],
    ],
  );
  assert.equal(result.employed, 7);
  assert.equal(result.hasReachableJobs[4], true);
});
test("a road stub cannot steal utility access in any rotation", () => {
  for (let rotation = 0; rotation < 4; rotation++) {
    const c = createCity(false);
    function at(x, z) {
      for (let j = 0; j < rotation; j++) [x, z] = [-z, x];
      return [18 + x, 18 + z];
    }
    for (const [x, z, kind] of [
      [0, 0, "residential"],
      [0, -1, "road"],
      [0, -2, "power"],
      [-1, -1, "water"],
    ])
      place(c, ...at(x, z), kind);
    c.tiles[id(18, 18)].level = 3;
    place(c, ...at(-1, 0), "road");
    assert.equal(stats(c).population, 24);
    place(c, ...at(0, -1), "bulldoze");
    assert.equal(stats(c).population, 0);
  }
});
test("a plant touching two overloaded networks shares 200 levels, counting corner lots once", () => {
  const c = createCity(false);
  // Two long disconnected combs, each bordering the central utility pair.
  for (const z of [12, 14, 16, 18, 20, 22, 24]) {
    for (const x of [...Array(7)]
      .map((_, i) => i + 10)
      .concat([...Array(7)].map((_, i) => i + 18))) {
      c.tiles[id(x, z)] = { kind: "road", level: 0 };
      c.tiles[id(x, z + 1)] = { kind: "residential", level: 3 };
    }
  }
  for (let z = 12; z <= 24; z++)
    for (const x of [10, 24]) c.tiles[id(x, z)] = { kind: "road", level: 0 };
  for (const [z, kind] of [
    [16, "power"],
    [18, "water"],
  ])
    c.tiles[id(17, z)] = { kind, level: 1 };
  c.tiles[id(17, 14)] = { kind: "residential", level: 3 };
  const s = stats(c);
  let served = 0;
  c.tiles.forEach((t, i) => {
    if (t.kind === "residential") served += t.level * s.service[i];
  });
  assert.ok(s.service[id(17, 14)] > 0 && s.service[id(17, 14)] < 1);
  assert.ok(Math.abs(served - 200) < 1e-8);
});
for (const raw of ["{bad", '{"version":2,"keep":"original"}', ""]) {
  test("preserve rejected save until explicit replacement " + JSON.stringify(raw), () => {
    let value = raw;
    const storage = { getItem: () => value, setItem: (_, v) => (value = v) };
    const session = openSave(() => storage),
      city = createCity();
    assert.equal(session.protectedSave, true);
    session.write(city);
    tick(city);
    session.write(city);
    assert.equal(session.original, raw);
    assert.equal(value, raw);
    session.write(city, true);
    assert.deepEqual(restore(value), city);
    assert.equal(session.protectedSave, false);
  });
}
test("missing and valid saves persist edits, and a stale session respects a newer save", () => {
  let value = null;
  const storage = { getItem: () => value, setItem: (_, v) => (value = v) };
  const a = openSave(() => storage),
    city = createCity(false);
  assert.equal(a.protectedSave, false);
  a.write(city);
  const b = openSave(() => storage);
  assert.deepEqual(b.city, city);
  place(b.city, 18, 18, "road");
  b.write(b.city);
  a.write(city);
  assert.deepEqual(restore(value), b.city);
});
