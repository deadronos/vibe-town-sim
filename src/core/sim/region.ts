import { distance, landId, type Point } from "../world/terrain.ts";
import { closestPoint, roadComponents } from "../network/roads.ts";
import {
  utilityAccess,
  utilityDemand,
  services,
  utilities,
  zones,
  type Parcel,
} from "./development.ts";
import { startDispatch, type EconomicCity, type Router } from "./economy.ts";

export const vehicles = {
  bus: { construction: 8_000, seats: 36, upkeep: 12, headway: 2, speed: 1 },
  tram: { construction: 32_000, seats: 90, upkeep: 26, headway: 2, speed: 2 },
} as const;
export type LineKind = keyof typeof vehicles;
export const publicServices = ["garbage", "clinic", "fire", "school"] as const;
export type PublicService = (typeof publicServices)[number];

export interface Stop extends Point {
  id: number;
  roadId: number;
}
export interface Line {
  id: number;
  kind: LineKind;
  stops: number[];
  riders: number;
  waiting: number;
  waitDays: number;
}
export interface District {
  name: string;
  tax: number;
  budget: number;
}
export interface Region {
  stops: Stop[];
  lines: Line[];
  districts: Record<string, District>;
  response: Record<PublicService, number>;
  visited: Record<string, number>;
}
export interface RegionalCity extends EconomicCity {
  region: Region;
}
export function newRegion(): Region {
  return {
    stops: [],
    lines: [],
    districts: {},
    response: { garbage: 0, clinic: 0, fire: 0, school: 0 },
    visited: {},
  };
}

export const LAND_COST = 32_000;
export const LAND_UPKEEP = 120;

export function adjacent(land: string[], next: string): boolean {
  if (!/^[0-3],[0-3]$/.test(next) || land.includes(next)) return false;
  const [x, z] = next.split(",").map(Number);
  return land.some((tile) => {
    const [tx, tz] = tile.split(",").map(Number);
    return Math.abs(tx - x) + Math.abs(tz - z) === 1;
  });
}

export function chooseLine(
  city: RegionalCity,
  router: Router,
  from: Parcel,
  to: Parcel,
  direct: number[],
) {
  for (const line of city.region.lines) {
    const stops = line.stops.map((id) => city.region.stops.find((stop) => stop.id === id)!);
    const origin = stops.findIndex((stop) => distance(stop, from) < 430);
    const reversed = [...stops].reverse().findIndex((stop) => distance(stop, to) < 430);
    const destination = reversed < 0 ? -1 : stops.length - 1 - reversed;
    if (origin < 0 || destination < 0 || origin === destination) continue;
    const sequence = stops.slice(Math.min(origin, destination), Math.max(origin, destination) + 1);
    if (destination < origin) sequence.reverse();
    const edges: number[] = [];
    for (let i = 1; i < sequence.length; i++) {
      const leg = router.route(sequence[i - 1].roadId, sequence[i].roadId);
      if (!leg) break;
      edges.push(...(edges.at(-1) === leg[0] ? leg.slice(1) : leg));
      if (i === sequence.length - 1 && edges.length <= direct.length + 2) return { line, edges };
    }
  }
}

export function scheduleResponse(city: RegionalCity, router: Router): void {
  if (city.tick % 7 !== 0) return;
  for (const location of city.facilities) {
    if (!publicServices.some((kind) => kind === location.service)) continue;
    const kind = location.service as PublicService;
    const budget = city.region.districts[landId(location)]?.budget ?? 100;
    const available = Math.floor((services[kind].capacity * budget) / 100);
    const pending = new Set(
      city.economy.trips
        .filter((trip) => trip.kind === "dispatch" && trip.from === location.id)
        .map((trip) => trip.to),
    );
    if (pending.size >= Math.ceil(available / 180)) continue;
    const targets = city.parcels
      .filter((lot) => lot.built && zones[lot.zone].residents > 0 && !pending.has(lot.id))
      .map((lot) => ({ lot, last: city.region.visited[`${kind}:${lot.id}`] ?? -100 }))
      .sort((a, b) => a.last - b.last || a.lot.id - b.lot.id);
    for (const { lot, last } of targets) {
      const edges = router.route(location.roadId, lot.roadId);
      if (!edges || edges.length > 14 || city.tick - last < 25 || available === 0) continue;
      startDispatch(
        city,
        location.id,
        lot.id,
        edges,
        Math.min(zones[lot.zone].residents, available),
      );
      break;
    }
  }
}

export function regionSummary(city: RegionalCity) {
  const components = roadComponents(city);
  const capacities = utilityAccess(city, components);
  const demands = new Map<number, number>();
  for (const lot of city.parcels) {
    const component = components.get(lot.roadId);
    if (component !== undefined)
      demands.set(component, (demands.get(component) ?? 0) + utilityDemand(lot));
  }
  const utility = utilities.map((service) => ({
    service,
    capacity: [...capacities.values()].reduce((sum, capacity) => sum + capacity[service], 0),
    demand: [...demands.values()].reduce((sum, value) => sum + value, 0),
    shortage: [...demands.entries()].reduce(
      (sum, [id, value]) => sum + Math.max(0, value - (capacities.get(id)?.[service] ?? 0)),
      0,
    ),
  }));
  const districts = city.land.map((tile) => {
    const lots = city.parcels.filter((lot) => lot.built && landId(lot) === tile);
    return {
      tile,
      name: city.region.districts[tile]?.name ?? `Tile ${tile}`,
      tax: city.region.districts[tile]?.tax ?? city.tax,
      budget: city.region.districts[tile]?.budget ?? 100,
      residents: lots.reduce((sum, lot) => sum + zones[lot.zone].residents, 0),
      jobs: lots.reduce((sum, lot) => sum + zones[lot.zone].jobs, 0),
    };
  });
  return {
    utility,
    districts,
    stops: city.region.stops,
    lines: city.region.lines,
    response: city.region.response,
  };
}

export type Field = "value" | "noise" | "pollution";
export function fields(
  city: Pick<RegionalCity, "parcels" | "facilities" | "roads" | "seed">,
  at: Point,
): Record<Field, number> {
  const sources = [
    ...city.parcels.filter((lot) => lot.built && lot.zone === "industry"),
    ...city.facilities.filter(
      (lot) => lot.service === "freight" || lot.service === "garbage" || lot.service === "sewage",
    ),
  ];
  let pollution = 0;
  for (const lot of sources) pollution += Math.max(0, 1 - distance(lot, at) / 230) * 15;
  let noise = pollution * 0.5;
  for (const road of city.roads) {
    for (let edge = 1; edge < road.points.length; edge++) {
      const point = closestPoint(at, road.points[edge - 1], road.points[edge]).point;
      noise = Math.max(
        noise,
        Math.max(0, 1 - distance(point, at) / 150) * (road.kind === "street" ? 25 : 60),
      );
    }
  }
  const amenity = city.facilities.reduce(
    (sum, facility) =>
      sum +
      (["school", "clinic"].includes(facility.service)
        ? Math.max(0, 1 - distance(facility, at) / 420) * 18
        : 0),
    0,
  );
  return {
    value: Math.max(0, Math.min(100, Math.round(55 + amenity - pollution * 0.55 - noise * 0.3))),
    pollution: Math.min(100, Math.round(pollution)),
    noise: Math.min(100, Math.round(noise)),
  };
}
