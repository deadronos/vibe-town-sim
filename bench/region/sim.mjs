import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { execute, restore, snapshot } from "../../src/core/sim/city.ts";
import { services, zones } from "../../src/core/sim/development.ts";
import { denseCity } from "./fixture.mjs";

const city = denseCity();

function act(command) {
  const result = execute(city, command);
  assert.ok(result.ok, JSON.stringify({ command, result }));
}

const developed = city.parcels.filter((lot) => lot.built);
const population = developed.reduce((sum, lot) => sum + zones[lot.zone].residents, 0);
assert.ok(developed.length >= 1000, `Expected 1000 buildings, got ${developed.length}`);
assert.ok(population >= 5000);
assert.ok(
  city.facilities.reduce((sum, lot) => sum + services[lot.service].capacity, 0) > population,
);

const durations = [];
const ticks = Number(process.env.REGIONAL_TICKS ?? 3600);
const started = performance.now();
for (let advanced = 0; advanced < ticks; advanced += 16) {
  const before = performance.now();
  act({ kind: "step", count: Math.min(16, ticks - advanced) });
  durations.push(performance.now() - before);
}
assert.deepEqual(restore(snapshot(city)), city);
const posts = city.economy.receipts - city.economy.expenses;
assert.equal(city.cash, 280_000 + posts);
const times = [...durations].sort((a, b) => a - b);
console.log(
  JSON.stringify({
    ticks,
    buildings: developed.length,
    population,
    elapsedMs: Math.round(performance.now() - started),
    p95BatchMs: times[Math.ceil(times.length * 0.95) - 1],
    maxBatchMs: Math.max(...durations),
    queued: city.economy.queued,
    cash: city.cash,
  }),
);
