import { contains, distance, height, landId, mix, type Point } from "../world/terrain.ts";
import {
  addRoad,
  closestPoint,
  nearestRoad,
  segmentElevation,
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
  zones,
  type Service,
  type Side,
  type Zone,
} from "./development.ts";

import { planner } from "../network/routes.ts";
import {
  economicDay,
  newEconomy,
  prepareEconomy,
  synchronizeEconomy,
  transfer,
} from "./economy.ts";

import {
  adjacent,
  LAND_COST,
  newRegion,
  vehicles,
  type LineKind,
  type RegionalCity,
} from "./region.ts";

export interface City extends RegionalCity {
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
  | { kind: "facility"; at: Point; service: Service }
  | { kind: "tax"; rate: number }
  | { kind: "gateway"; roadId: number }
  | { kind: "purchase"; tile: string }
  | { kind: "district"; tile: string; name: string; tax: number; budget: number }
  | { kind: "stop"; at: Point }
  | { kind: "line"; line: LineKind; stops: number[] };
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
    economy: newEconomy(),
    region: newRegion(),
    tax: 9,
    gateway: 0,
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
  const economy = city.economy;
  if (
    !Number.isInteger(city.tax) ||
    city.tax < 0 ||
    city.tax > 30 ||
    (city.gateway !== 0 && !city.roads.some((road) => road.id === city.gateway)) ||
    !economy ||
    !Array.isArray(economy.trips) ||
    !Array.isArray(economy.ledger) ||
    !economy.households ||
    !economy.firms ||
    !economy.balances ||
    !economy.roadTraffic ||
    ![
      economy.receipts,
      economy.expenses,
      economy.consumed,
      economy.produced,
      economy.imported,
      economy.exported,
      economy.scrapped,
      economy.payroll,
      economy.commutes,
      economy.deliveries,
      economy.lost,
      economy.queued,
    ].every((value) => Number.isSafeInteger(value) && value >= 0)
  )
    throw new Error("Invalid economic checkpoint");
  const parcelIds = new Set(
    city.parcels.filter((parcel) => parcel.built).map((parcel) => parcel.id),
  );
  for (const account of [...Object.values(economy.households), ...Object.values(economy.firms)]) {
    if (
      !account ||
      !parcelIds.has(account.id) ||
      !Number.isSafeInteger(account.money) ||
      account.money < 0
    ) {
      throw new Error("Invalid business or household account");
    }
  }
  const roadIds = new Set(city.roads.map((road) => road.id));
  if (
    !city.region ||
    !Array.isArray(city.region.stops) ||
    !Array.isArray(city.region.lines) ||
    !city.region.districts ||
    !city.region.response ||
    !city.region.visited
  )
    throw new Error("Invalid regional services");
  for (const stop of city.region.stops) {
    if (!validPoint(stop) || !roadIds.has(stop.roadId) || !validIdentity(stop.id, city, ids))
      throw new Error("Invalid stop");
    ids.add(stop.id);
  }
  const stopIds = new Set(city.region.stops.map((stop) => stop.id));
  for (const line of city.region.lines) {
    if (
      !line ||
      !validIdentity(line.id, city, ids) ||
      !Object.hasOwn(vehicles, line.kind) ||
      !Array.isArray(line.stops) ||
      line.stops.length < 2 ||
      !line.stops.every((stop) => stopIds.has(stop)) ||
      ![line.riders, line.waiting, line.waitDays].every(Number.isSafeInteger)
    )
      throw new Error("Invalid transit line");
    ids.add(line.id);
  }
  const facilityIds = new Set(city.facilities.map((item) => item.id));
  for (const trip of economy.trips) {
    if (
      !trip ||
      !(trip.kind === "dispatch" ? facilityIds.has(trip.from) : parcelIds.has(trip.from)) ||
      !parcelIds.has(trip.to) ||
      !Array.isArray(trip.edges) ||
      !trip.edges.every((id) => roadIds.has(id)) ||
      !Number.isSafeInteger(trip.edge) ||
      trip.edge < 0 ||
      trip.edge >= trip.edges.length ||
      !Number.isSafeInteger(trip.due) ||
      trip.due < 0 ||
      !Number.isSafeInteger(trip.quantity) ||
      trip.quantity < 1 ||
      !["commute", "shopping", "shipment", "dispatch"].includes(trip.kind) ||
      (trip.mode !== "road" &&
        !city.region.lines.some((line) => line.id === trip.line && line.kind === trip.mode)) ||
      !validIdentity(trip.id, city, ids)
    )
      throw new Error("Invalid trip");
    ids.add(trip.id);
  }
  return snapshot(city);
}

export function execute(city: City, command: Command): Result {
  const reject = (reason: string): Result => ({ ok: false, revision: city.revision, reason });
  if (command.kind === "step") {
    if (!Number.isSafeInteger(command.count) || command.count < 1 || command.count > 100_000)
      return reject("Invalid step count");
    const { router, supplied } = prepareEconomy(city);
    for (let day = 0; day < command.count; day++) {
      city.tick++;
      if (city.tick % 3 === 0) {
        const grown = develop(city, supplied);
        if (grown) synchronizeEconomy(city, router);
      }
      economicDay(city, router, supplied);
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
            segmentElevation(city.seed, points, i, j / samples, !!command.bridge) -
              segmentElevation(city.seed, points, i, (j - 1) / samples, !!command.bridge),
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
    for (const stop of city.region.stops) {
      const segments = replaced.get(stop.roadId);
      if (segments) stop.roadId = nearestRoad(stop, segments)!.id;
    }
    transfer(city, "city", "regional", cost, "Road construction");
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
    transfer(city, "city", "regional", cost, "Road upgrade");
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
    transfer(city, "city", "regional", services[command.service].cost, "Facility construction");
    city.facilities.push({
      ...command.at,
      id: city.nextId++,
      roadId: road.id,
      service: command.service,
    });
  } else if (command.kind === "demolish") {
    const road = city.roads.find((road) => road.id === command.id);
    if (road) {
      if (road.id === city.gateway) city.gateway = 0;
      city.roads = city.roads.filter((segment) => segment.id !== road.id);
      city.parcels = city.parcels.filter((parcel) => parcel.roadId !== road.id);
      city.facilities = city.facilities.filter((facility) => facility.roadId !== road.id);
      city.region.stops = city.region.stops.filter((stop) => stop.roadId !== road.id);
      city.region.lines = city.region.lines.filter((line) =>
        line.stops.every((id) => city.region.stops.some((stop) => stop.id === id)),
      );
    } else if (city.parcels.some((parcel) => parcel.id === command.id)) {
      city.parcels = city.parcels.filter((parcel) => parcel.id !== command.id);
    } else if (city.facilities.some((facility) => facility.id === command.id)) {
      city.facilities = city.facilities.filter((facility) => facility.id !== command.id);
    } else if (city.region.lines.some((line) => line.id === command.id)) {
      city.region.lines = city.region.lines.filter((line) => line.id !== command.id);
    } else if (city.region.stops.some((stop) => stop.id === command.id)) {
      city.region.stops = city.region.stops.filter((stop) => stop.id !== command.id);
      city.region.lines = city.region.lines.filter((line) => !line.stops.includes(command.id));
    } else {
      return reject("Choose an existing road, parcel, facility, stop, or line");
    }
  } else if (command.kind === "tax") {
    if (!Number.isInteger(command.rate) || command.rate < 0 || command.rate > 30)
      return reject("Tax rate must be 0–30%");
    city.tax = command.rate;
  } else if (command.kind === "gateway") {
    const road = city.roads.find((road) => road.id === command.roadId);
    if (road?.kind !== "highway") return reject("Choose a highway for the regional connection");
    if (!road.points.some((point) => point.x < -1_750 || point.z < -1_750))
      return reject("Connect a highway to the western or southern starter-area boundary");
    city.gateway = road.id;
  } else if (command.kind === "purchase") {
    if (!adjacent(city.land, command.tile)) return reject("Choose unowned land next to your city");
    if (city.cash < LAND_COST) return reject("Insufficient land purchase funds");
    city.land.push(command.tile);
    transfer(city, "city", "regional", LAND_COST, "Land purchase");
  } else if (command.kind === "district") {
    if (
      !city.land.includes(command.tile) ||
      typeof command.name !== "string" ||
      command.name.trim().length < 1 ||
      command.name.length > 40 ||
      !Number.isInteger(command.tax) ||
      command.tax < 0 ||
      command.tax > 30 ||
      !Number.isInteger(command.budget) ||
      command.budget < 0 ||
      command.budget > 150
    )
      return reject("Invalid district policy");
    city.region.districts[command.tile] = {
      name: command.name.trim(),
      tax: command.tax,
      budget: command.budget,
    };
  } else if (command.kind === "stop") {
    if (!validPoint(command.at)) return reject("Choose a stop location");
    const road = nearestRoad(command.at, city.roads);
    if (!road || road.kind === "highway") return reject("Stops need a street or avenue");
    const site = frontagePoint(command.at, road);
    if (
      distance(command.at, site) > 28 ||
      city.region.stops.some((stop) => distance(stop, site) < 36)
    ) {
      return reject("Place stops on a road and at least 36 m apart");
    }
    if (city.cash < 1_500) return reject("Insufficient stop funds");
    city.region.stops.push({ ...site, id: city.nextId++, roadId: road.id });
    transfer(city, "city", "regional", 1_500, "Transit stop construction");
  } else if (command.kind === "line") {
    if (
      !Object.hasOwn(vehicles, command.line) ||
      !Array.isArray(command.stops) ||
      command.stops.length < 2 ||
      command.stops.length > 20 ||
      new Set(command.stops).size !== command.stops.length
    )
      return reject("Choose two or more different stops");
    const stops = command.stops.map((id) => city.region.stops.find((stop) => stop.id === id));
    const router = planner(city);
    if (
      stops.some((stop, i) => !stop || (i > 0 && !router.route(stops[i - 1]!.roadId, stop.roadId)))
    )
      return reject("Stops must be connected");
    const cost = vehicles[command.line].construction;
    if (city.cash < cost) return reject("Insufficient line construction funds");
    city.region.lines.push({
      id: city.nextId++,
      kind: command.line,
      stops: [...command.stops],
      riders: 0,
      waiting: 0,
      waitDays: 0,
    });
    transfer(city, "city", "regional", cost, "Transit line construction");
  } else {
    return reject("Unknown command");
  }
  if (command.kind === "road" || command.kind === "demolish")
    synchronizeEconomy(city, planner(city));
  city.revision++;
  return { ok: true, revision: city.revision };
}

function frontagePoint(point: Point, road: Road): Point {
  return road.points
    .slice(1)
    .map((end, i) => closestPoint(point, road.points[i], end).point)
    .reduce((closest, next) => (distance(point, next) < distance(point, closest) ? next : closest));
}

function validIdentity(id: number, city: City, ids: Set<number>): boolean {
  return Number.isSafeInteger(id) && id > 0 && id < city.nextId && !ids.has(id);
}
