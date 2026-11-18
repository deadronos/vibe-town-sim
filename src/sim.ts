import { matchCommutes } from "./commutes.ts";
export const N = 38;
export const prices = {
  road: 20,
  residential: 45,
  commercial: 75,
  industrial: 100,
  park: 65,
  power: 420,
  water: 310,
  bulldoze: 10,
} as const;
export type Build = keyof typeof prices;
export type Kind = Exclude<Build, "bulldoze"> | "empty";
export type Tile = { kind: Kind; level: number };
export type City = { version: 1; tiles: Tile[]; funds: number; month: number; tax: number };
export const id = (x: number, z: number) => z * N + x;
export function noise(x: number, z: number, s = 0) {
  const a = Math.sin(x * 127.1 + z * 311.7 + s * 61.7) * 43758.5453;
  return a - Math.floor(a);
}
export function coast(x: number, z: number) {
  const a = (x - 18) / 16.8,
    b = (z - 18) / 14.7;
  return 1 - Math.hypot(a, b) + 0.071 * Math.sin(z * 0.59) + 0.055 * Math.cos(x * 0.55 + z * 0.19);
}
export const land = (x: number, z: number) =>
  x >= 0 && z >= 0 && x < N && z < N && coast(x, z) > 0.035;
export function neighbors(i: number) {
  return [i % N ? i - 1 : -1, i % N < N - 1 ? i + 1 : -1, i - N, i + N].filter(
    (n) => n >= 0 && n < N * N,
  );
}
export function createCity(starter = true): City {
  const city: City = {
    version: 1,
    tiles: Array.from({ length: N * N }, () => ({ kind: "empty", level: 0 })),
    funds: 18000,
    month: 0,
    tax: 9,
  };
  if (!starter) return city;
  for (let z = 8; z <= 27; z++)
    for (let x = 7; x <= 29; x++) {
      if (!land(x, z)) continue;
      const v = [10, 15, 20, 25].includes(x),
        h = [11, 16, 21, 25].includes(z);
      const t = city.tiles[id(x, z)];
      if ((v && z >= 10 && z <= 25) || (h && x >= 9 && x <= 26)) {
        t.kind = "road";
        continue;
      }
      const near =
        ([9, 11, 14, 16, 19, 21, 24, 26].includes(x) && z >= 11 && z <= 25) ||
        ([10, 12, 15, 17, 20, 22, 24, 26].includes(z) && x >= 10 && x <= 25);
      if (!near || noise(x, z) < 0.28) continue;
      t.kind =
        x > 21 && z < 16
          ? "industrial"
          : x >= 15 && x <= 21 && z >= 15 && z <= 22
            ? "commercial"
            : noise(z, x, 8) < 0.14
              ? "park"
              : "residential";
      t.level = 1 + Math.floor(noise(x, z, 9) * 3);
    }
  city.tiles[id(26, 12)] = { kind: "power", level: 1 };
  city.tiles[id(24, 12)] = { kind: "water", level: 1 };
  return city;
}
// Two self-sufficient streets separated by one missing road tile at (18,18).
export function createCommuteDistrict(): City {
  const c = createCity(false);
  for (let x = 12; x <= 24; x++) if (x !== 18) c.tiles[id(x, 18)].kind = "road";
  for (const x of [13, 23]) {
    c.tiles[id(x, 17)] = { kind: "power", level: 1 };
    c.tiles[id(x + 1, 17)] = { kind: "water", level: 1 };
    c.tiles[id(x, 19)] = { kind: x < 18 ? "residential" : "industrial", level: 3 };
  }
  return c;
}
export const zoned = (k: Kind) => k === "residential" || k === "commercial" || k === "industrial";
function roadServices(c: City) {
  const entrances = c.tiles.map((t, i) =>
    t.kind === "empty" ? [] : neighbors(i).filter((n) => c.tiles[n].kind === "road"),
  );
  const group = new Int32Array(c.tiles.length).fill(-1);
  const loads: number[] = [];
  let roads = 0,
    parks = 0,
    utilities = 0;
  c.tiles.forEach((tile, i) => {
    if (tile.kind !== "road" || group[i] >= 0) return;
    const component = loads.length;
    loads.push(0);
    group[i] = component;
    const queue = [i];
    for (let j = 0; j < queue.length; j++) {
      roads++;
      for (const n of entrances[queue[j]])
        if (group[n] < 0) {
          group[n] = component;
          queue.push(n);
        }
    }
  });
  const touching = entrances.map((e) => [...new Set(e.map((n) => group[n]))].sort((a, b) => a - b));
  const access = touching.map((groups) => groups[0] ?? -1);
  const capacity = 200;
  const suppliers = loads.map(() => ({ power: [] as number[], water: [] as number[] }));
  c.tiles.forEach(({ kind }, i) => {
    if (kind === "park") parks++;
    if (kind === "power" || kind === "water") {
      utilities++;
      for (const g of touching[i]) suppliers[g][kind].push(i);
    }
  });
  // Each shared plant distributes its capacity proportionately to the loads
  // of the networks it touches. Score the effect of assigning a new lot
  // against that same capacity calculation.
  function serviceRatio(g: number, extra: number) {
    const ratio = (plants: number[]) =>
      plants.reduce((sum, plant) => {
        const demand = touching[plant].reduce(
          (total, component) => total + loads[component],
          extra,
        );
        return sum + capacity / Math.max(1, demand);
      }, 0);
    return Math.min(ratio(suppliers[g].power), ratio(suppliers[g].water));
  }
  // Reserve unambiguous loads first. A corner lot then chooses the best
  // supplied adjacent network and contributes its load exactly once.
  const lots = c.tiles
    .map((_, i) => i)
    .filter((i) => zoned(c.tiles[i].kind) && touching[i].length)
    .sort((a, b) => touching[a].length - touching[b].length || a - b);
  for (const i of lots) {
    const load = Math.max(1, c.tiles[i].level);
    let best = -1;
    for (const g of touching[i]) {
      const ratio = serviceRatio(g, load);
      if (ratio > best) {
        access[i] = g;
        best = ratio;
      }
    }
    loads[access[i]] += load;
  }
  const ratios = loads.map((_, g) => Math.min(1, serviceRatio(g, 0)));
  const service = access.map((g) => ratios[g] ?? 0);
  return { roads, parks, utilities, entrances, access, service };
}
export function stats(c: City) {
  const { roads, parks, utilities, entrances, access, service } = roadServices(c);
  let population = 0,
    jobs = 0,
    shops = 0;
  const workers = c.tiles.map(() => 0),
    positions = c.tiles.map(() => 0);
  c.tiles.forEach((t, i) => {
    const size = Math.round(t.level * service[i] * 8);
    if (t.kind === "residential") {
      population += size;
      workers[i] = Math.round(size * 0.58);
    }
    if (t.kind === "commercial") {
      positions[i] = size;
      shops += size;
    }
    if (t.kind === "industrial") positions[i] = size * 2;
    jobs += positions[i];
  });
  const commute = matchCommutes(entrances, workers, positions);
  const employed = commute.employed;
  const happiness = Math.max(
    12,
    Math.min(
      98,
      Math.round(
        57 +
          (16 * employed) / Math.max(1, population * 0.58) +
          Math.min(15, parks * 1.3) -
          (c.tax - 9) * 3,
      ),
    ),
  );
  const income = Math.round(((population * 0.52 + employed * 0.55) * c.tax) / 9);
  const employmentTax = income - Math.round((population * 0.52 * c.tax) / 9);
  const upkeep = roads + parks * 2 + utilities * 22;
  const demand = {
    residential: Math.min(
      98,
      Math.max(12, 55 + (jobs - population * 0.58) * 0.12 + (happiness - 70) * 0.6),
    ),
    commercial: Math.min(96, Math.max(10, 58 + (population * 0.32 - shops) * 0.15)),
    industrial: Math.min(94, Math.max(10, 55 + (population * 0.72 - jobs) * 0.13)),
  };
  return {
    service,
    access,
    population,
    jobs,
    workers,
    positions,
    commute,
    happiness,
    income,
    employmentTax,
    upkeep,
    net: income - upkeep,
    demand,
    roads,
    parks,
  };
}
export function tick(c: City) {
  const s = stats(c);
  c.month++;
  c.funds += s.net;
  c.tiles.forEach((t, i) => {
    if (!zoned(t.kind)) return;
    const d = s.demand[t.kind as keyof typeof s.demand];
    if (t.level < 3 && s.service[i] > 0.5 && noise(i, c.month, 4) < d / 340) t.level++;
    else if (t.level > 0 && (s.service[i] === 0 || c.tax >= 17) && noise(i, c.month, 7) < 0.12)
      t.level--;
  });
}
export function place(c: City, x: number, z: number, tool: Build): string | undefined {
  if (!land(x, z)) return "Choose a land tile.";
  const t = c.tiles[id(x, z)];
  if (tool === "bulldoze" && t.kind === "empty") return "This tile is already clear.";
  if (tool !== "bulldoze" && t.kind !== "empty") return "Clear the existing tile first.";
  if (c.funds < prices[tool] && !(tool === "bulldoze" && c.funds < 0))
    return "Insufficient treasury funds.";
  c.funds -= prices[tool];
  t.kind = tool === "bulldoze" ? "empty" : tool;
  t.level = 0;
}
export function restore(raw: string | null): City | undefined {
  try {
    const c = JSON.parse(raw ?? "null");
    if (
      c?.version === 1 &&
      Number.isSafeInteger(c.funds) &&
      Number.isSafeInteger(c.month) &&
      c.month >= 0 &&
      Number.isInteger(c.tax) &&
      c.tax >= 3 &&
      c.tax <= 18 &&
      Array.isArray(c.tiles) &&
      c.tiles.length === N * N &&
      c.tiles.every(
        (t: Tile, i: number) =>
          t &&
          (
            [
              "empty",
              "road",
              "residential",
              "commercial",
              "industrial",
              "park",
              "power",
              "water",
            ] as string[]
          ).includes(t.kind) &&
          Number.isInteger(t.level) &&
          t.level >= 0 &&
          t.level <= 3 &&
          (t.kind === "empty" || land(i % N, Math.floor(i / N))),
      )
    )
      return c;
  } catch {
    /* Invalid local save. */
  }
}
