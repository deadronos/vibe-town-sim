import { contains, distance, height, landId, mix, type Point } from "../world/terrain.ts";
import {
  roadElevation,
  roadLength,
  snap,
  streets,
  type Network,
  type RoadClass,
} from "../network/roads.ts";

export interface City extends Network {
  version: 2;
  seed: number;
  revision: number;
  tick: number;
  cash: number;
  land: string[];
}
export type Command =
  | { kind: "road"; points: Point[]; road: RoadClass; bridge?: boolean }
  | { kind: "step"; count: number };
export type Result =
  | { ok: true; revision: number }
  | { ok: false; revision: number; reason: string };

export function createCity(seed: number): City {
  return {
    version: 2,
    seed,
    revision: 0,
    tick: 0,
    cash: 280_000,
    land: ["1,1"],
    nodes: [],
    roads: [],
    nextId: 1,
  };
}

export function snapshot(city: City): City {
  return structuredClone(city);
}

function validPoint(point: unknown): point is Point {
  if (!point || typeof point !== "object") return false;
  const value = point as Point;
  return Number.isFinite(value.x) && Number.isFinite(value.z) && contains(value);
}

export function restore(raw: unknown): City {
  if (!raw || typeof raw !== "object") throw new Error("Missing regional checkpoint");
  const city = raw as City;
  if (
    city.version !== 2 ||
    ![city.seed, city.tick, city.revision, city.cash, city.nextId].every(Number.isSafeInteger) ||
    city.tick < 0 ||
    city.revision < 0 ||
    city.nextId < 1 ||
    !Array.isArray(city.land) ||
    !city.land.every((id) => /^[0-3],[0-3]$/.test(id)) ||
    !Array.isArray(city.nodes) ||
    !Array.isArray(city.roads)
  )
    throw new Error("Invalid regional checkpoint");
  const ids = new Set<number>();
  for (const node of city.nodes) {
    if (
      !validPoint(node) ||
      !Number.isSafeInteger(node.id) ||
      node.id < 1 ||
      node.id >= city.nextId ||
      ids.has(node.id)
    ) {
      throw new Error("Invalid road node");
    }
    ids.add(node.id);
  }
  const nodes = new Set(ids);
  for (const road of city.roads) {
    if (
      !road ||
      !Number.isSafeInteger(road.id) ||
      road.id < 1 ||
      road.id >= city.nextId ||
      ids.has(road.id) ||
      !nodes.has(road.a) ||
      !nodes.has(road.b) ||
      road.a === road.b ||
      !Object.hasOwn(streets, road.kind) ||
      typeof road.bridge !== "boolean" ||
      !Array.isArray(road.points) ||
      road.points.length < 2 ||
      !road.points.every(validPoint)
    ) {
      throw new Error("Invalid road segment");
    }
    ids.add(road.id);
  }
  return snapshot(city);
}

export function execute(city: City, command: Command): Result {
  const reject = (reason: string): Result => ({ ok: false, revision: city.revision, reason });
  if (command.kind === "step") {
    if (!Number.isSafeInteger(command.count) || command.count < 1 || command.count > 100_000)
      return reject("Invalid step count");
    city.tick += command.count;
  } else if (command.kind === "road") {
    if (
      !Array.isArray(command.points) ||
      command.points.length < 2 ||
      command.points.length > 100 ||
      !command.points.every(validPoint) ||
      !Object.hasOwn(streets, command.road)
    )
      return reject("Invalid road gesture");
    const points = command.points.map((point, index) =>
      index === 0 || index === command.points.length - 1 ? snap(city, point) : point,
    );
    const length = roadLength(points);
    if (
      length < 18 ||
      length > 3_000 ||
      points.some((point, index) => index > 0 && distance(point, points[index - 1]) < 1)
    ) {
      return reject("Road must span 18 to 3,000 m");
    }
    for (let i = 1; i < points.length; i++) {
      const samples = Math.ceil(distance(points[i - 1], points[i]) / 12);
      let previous = points[i - 1];
      for (let j = 1; j <= samples; j++) {
        const point = mix(points[i - 1], points[i], j / samples);
        if (!city.land.includes(landId(point)) || !city.land.includes(landId(previous)))
          return reject("Purchase this land first");
        if (!command.bridge && (height(city.seed, point) < 1 || height(city.seed, previous) < 1))
          return reject("A bridge is required over water");
        const grade =
          Math.abs(
            roadElevation(city.seed, point, !!command.bridge) -
              roadElevation(city.seed, previous, !!command.bridge),
          ) / distance(point, previous);
        if (grade > 0.19) return reject("Road grade exceeds 19%");
        previous = point;
      }
    }
    const cost = Math.round(length * (streets[command.road].cost + (command.bridge ? 90 : 0)));
    if (city.cash < cost) return reject("Insufficient construction funds");
    const ends = [points[0], points.at(-1)!].map((point) => {
      const existing = city.nodes.find((node) => distance(point, node) < 0.01);
      if (existing) return existing.id;
      const id = city.nextId++;
      city.nodes.push({ ...point, id });
      return id;
    });
    city.roads.push({
      id: city.nextId++,
      a: ends[0],
      b: ends[1],
      points,
      kind: command.road,
      bridge: !!command.bridge,
    });
    city.cash -= cost;
  } else {
    return reject("Unknown command");
  }
  city.revision++;
  return { ok: true, revision: city.revision };
}
