import test from "node:test";
import assert from "node:assert/strict";
import { createCity, place, stats, tick, id, restore } from "../src/sim.ts";
test("starter town has residents, workplaces and a positive monthly balance", () => {
  const c = createCity(),
    s = stats(c);
  assert.ok(s.population > 0 && s.jobs > 0 && s.net > 0);
  const initial = c.funds;
  tick(c);
  assert.equal(c.funds, initial + s.net);
  assert.equal(c.month, 1);
  assert.deepEqual(restore(JSON.stringify(c)), c);
});
test("development requires road access to both utilities and responds to a broken connection", () => {
  const c = createCity(false);
  for (let x = 13; x <= 21; x++) assert.equal(place(c, x, 15, "road"), undefined);
  for (const [x, k] of [
    [13, "power"],
    [14, "water"],
    [20, "residential"],
    [21, "industrial"],
  ])
    assert.equal(place(c, x, 16, k), undefined);
  for (let i = 0; i < 80; i++) tick(c);
  assert.equal(c.tiles[id(20, 16)].level, 3);
  assert.ok(stats(c).population > 0);
  assert.ok(stats(c).jobs > 0);
  place(c, 17, 15, "bulldoze");
  assert.equal(stats(c).service[id(20, 16)], 0);
  assert.equal(stats(c).population, 0);
});
test("ocean, occupied tiles, insufficient funds, and corrupt saves are handled", () => {
  const c = createCity(false),
    start = c.funds;
  assert.ok(place(c, 0, 0, "road"));
  assert.equal(c.funds, start);
  place(c, 18, 18, "road");
  assert.ok(place(c, 18, 18, "power"));
  assert.equal(c.funds, start - 20);
  c.funds = 0;
  assert.ok(place(c, 17, 18, "power"));
  assert.equal(c.tiles[id(17, 18)].kind, "empty");
  assert.equal(restore("garbage"), undefined);
  c.tiles[0].kind = "road";
  assert.equal(restore(JSON.stringify(c)), undefined);
});
