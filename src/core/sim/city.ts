import { contains, distance, height, landId, mix, type Point } from "../world/terrain.ts";
import {
  addRoad,
  closestPoint,
  nearestRoad,
  roadElevation,
  roadLength,
  snap,
  streets,
  type Road,
  type RoadClass,
} from "../network/roads.ts";

import {
  develop,
  frontage,
  services,
  suppliedParcels,
  zones,
  type Development,
  type Service,
  type Side,
  type Zone,
} from "./development.ts";

export interface City extends Development {
  version: 2;
  seed: number;
  revision: number;
  tick: number;
  cash: number;
  land: string[];
}
export type Command =
  | { kind: "road"; points: Point[]; road: RoadClass; bridge?: boolean }
  | { kind: "step"; count: number }
  | { kind: "upgrade"; roadId: number; road: RoadClass }
  | { kind: "demolish"; id: number }
  | { kind: "zone"; roadId: number; zone: Zone; side: Side; brush?: Point }
  | { kind: "facility"; at: Point; service: Service };
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
    parcels: [],
    facilities: [],
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
  for (const collection of [city.parcels, city.facilities]) {
    if (!Array.isArray(collection)) throw new Error("Invalid development checkpoint");
    for (const item of collection) {
      if (
        !validPoint(item) ||
        !Number.isSafeInteger(item.id) ||
        item.id < 1 ||
        item.id >= city.nextId ||
        ids.has(item.id) ||
        !city.roads.some((road) => road.id === item.roadId)
      )
        throw new Error("Invalid parcel or facility");
      ids.add(item.id);
    }
  }
  for (const parcel of city.parcels) {
    if (
      !Object.hasOwn(zones, parcel.zone) ||
      !validPoint(parcel.frontage) ||
      !Number.isFinite(parcel.angle) ||
      typeof parcel.built !== "boolean"
    )
      throw new Error("Invalid parcel");
  }
  for (const facility of city.facilities) {
    if (!Object.hasOwn(services, facility.service)) throw new Error("Invalid facility");
  }
  return snapshot(city);
}

export function execute(city: City, command: Command): Result {
  const reject = (reason: string): Result => ({ ok: false, revision: city.revision, reason });
  if (command.kind === "step") {
    if (!Number.isSafeInteger(command.count) || command.count < 1 || command.count > 100_000)
      return reject("Invalid step count");
    const supplied = suppliedParcels(city);
    for (let day = 0; day < command.count; day++) {
      city.tick++;
      if (city.tick % 3 === 0) develop(city, supplied);
    }
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
    if (distance(points[0], points.at(-1)!) < 1) return reject("Road endpoints must differ");
    const replaced = addRoad(city, points, command.road, !!command.bridge);
    for (const parcel of city.parcels) {
      const segments = replaced.get(parcel.roadId);
      if (segments) parcel.roadId = nearestRoad(parcel.frontage, segments)!.id;
    }
    for (const facility of city.facilities) {
      const segments = replaced.get(facility.roadId);
      if (segments) facility.roadId = nearestRoad(facility, segments)!.id;
    }
    city.cash -= cost;
  } else if (command.kind === "upgrade") {
    const road = city.roads.find((road) => road.id === command.roadId);
    if (!road || !Object.hasOwn(streets, command.road))
      return reject("Choose an existing road and class");
    if (
      !streets[command.road].sidewalks &&
      city.parcels.some((parcel) => parcel.roadId === road.id)
    ) {
      return reject("This road serves parcels and needs sidewalks");
    }
    const cost = Math.round(
      roadLength(road.points) * Math.max(0, streets[command.road].cost - streets[road.kind].cost),
    );
    if (city.cash < cost) return reject("Insufficient upgrade funds");
    city.cash -= cost;
    road.kind = command.road;
  } else if (command.kind === "zone") {
    const road = city.roads.find((road) => road.id === command.roadId);
    if (
      !road ||
      !Object.hasOwn(zones, command.zone) ||
      !["left", "right", "both"].includes(command.side) ||
      (command.brush && !validPoint(command.brush))
    )
      return reject("Choose road frontage");
    const parcels = frontage(city, road, command.zone, command.side, command.brush);
    if (!parcels.length) return reject("No buildable frontage here");
    for (const parcel of parcels) city.parcels.push({ ...parcel, id: city.nextId++ });
  } else if (command.kind === "facility") {
    if (!validPoint(command.at) || !Object.hasOwn(services, command.service))
      return reject("Invalid facility placement");
    const road = nearestRoad(command.at, city.roads);
    const closest = road && frontagePoint(command.at, road);
    if (!road || !closest || distance(command.at, closest) > 130)
      return reject("Place facility within 130 m of a road");
    if (!city.land.includes(landId(command.at)) || height(city.seed, command.at) < 1)
      return reject("Facility needs owned dry land");
    const site = [...city.facilities, ...city.parcels].some(
      (existing) => distance(existing, command.at) < 20,
    );
    if (site) return reject("Facility site is occupied");
    if (city.cash < services[command.service].cost) return reject("Insufficient facility funds");
    city.cash -= services[command.service].cost;
    city.facilities.push({
      ...command.at,
      id: city.nextId++,
      roadId: road.id,
      service: command.service,
    });
  } else if (command.kind === "demolish") {
    const road = city.roads.find((road) => road.id === command.id);
    if (road) {
      city.roads = city.roads.filter((segment) => segment.id !== road.id);
      city.parcels = city.parcels.filter((parcel) => parcel.roadId !== road.id);
      city.facilities = city.facilities.filter((facility) => facility.roadId !== road.id);
    } else if (city.parcels.some((parcel) => parcel.id === command.id)) {
      city.parcels = city.parcels.filter((parcel) => parcel.id !== command.id);
    } else if (city.facilities.some((facility) => facility.id === command.id)) {
      city.facilities = city.facilities.filter((facility) => facility.id !== command.id);
    } else {
      return reject("Choose an existing road, parcel, or facility");
    }
  } else {
    return reject("Unknown command");
  }
  city.revision++;
  return { ok: true, revision: city.revision };
}

function frontagePoint(point: Point, road: Road): Point {
  return road.points
    .slice(1)
    .map((end, i) => closestPoint(point, road.points[i], end).point)
    .reduce((closest, next) => (distance(point, next) < distance(point, closest) ? next : closest));
}
