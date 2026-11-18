import {
  closestPoint,
  roadComponents,
  streets,
  type Network,
  type Road,
} from "../network/roads.ts";
import { distance, height, landId, mix, type Point } from "../world/terrain.ts";

export const zones = {
  homes: { residents: 12, jobs: 0, color: 0xe5ba80, size: 10 },
  apartments: { residents: 34, jobs: 0, color: 0xd79569, size: 19 },
  shops: { residents: 0, jobs: 7, color: 0x6fadc4, size: 8 },
  industry: { residents: 0, jobs: 12, color: 0xbe8456, size: 13 },
  towers: { residents: 86, jobs: 0, color: 0x88a778, size: 37 },
  mixed: { residents: 38, jobs: 9, color: 0xa098bd, size: 24 },
  offices: { residents: 0, jobs: 24, color: 0x91b5b6, size: 29 },
} as const;
export type Zone = keyof typeof zones;
export type Side = "left" | "right" | "both";
export interface Parcel extends Point {
  id: number;
  roadId: number;
  frontage: Point;
  angle: number;
  zone: Zone;
  built: boolean;
}
export const services = {
  power: { cost: 14_000, capacity: 1_200, upkeep: 18 },
  water: { cost: 10_000, capacity: 900, upkeep: 14 },
  sewage: { cost: 8_000, capacity: 800, upkeep: 11 },
  garbage: { cost: 12_000, capacity: 500, upkeep: 18 },
  clinic: { cost: 18_000, capacity: 600, upkeep: 27 },
  fire: { cost: 16_000, capacity: 700, upkeep: 24 },
  school: { cost: 20_000, capacity: 600, upkeep: 29 },
  freight: { cost: 24_000, capacity: 1_400, upkeep: 29 },
} as const;
export type Service = keyof typeof services;
export interface Facility extends Point {
  id: number;
  roadId: number;
  service: Service;
}
export interface Development extends Network {
  seed: number;
  land: string[];
  parcels: Parcel[];
  facilities: Facility[];
  region?: { districts: Record<string, { budget: number }> };
}

export function frontage(
  city: Development,
  road: Road,
  zone: Zone,
  side: Side,
  brush?: Point,
): Omit<Parcel, "id">[] {
  if (!streets[road.kind].sidewalks) return [];
  const result: Omit<Parcel, "id">[] = [];
  const sides = side === "both" ? [-1, 1] : [side === "left" ? -1 : 1];
  let along = 0;
  let sample = 19;
  for (let i = 1; i < road.points.length; i++) {
    const a = road.points[i - 1];
    const b = road.points[i];
    const length = distance(a, b);
    while (sample <= along + length) {
      const foot = mix(a, b, (sample - along) / length);
      for (const sign of sides) {
        const point = {
          x: foot.x + ((b.z - a.z) / length) * sign * 25,
          z: foot.z - ((b.x - a.x) / length) * sign * 25,
        };
        if (
          (brush && distance(point, brush) > 58) ||
          height(city.seed, point) < 2 ||
          !city.land.includes(landId(point))
        )
          continue;
        if (
          [...city.parcels, ...result, ...city.facilities].some(
            (existing) => distance(existing, point) < 29,
          )
        )
          continue;
        const conflicts = city.roads.some((segment) =>
          segment.points
            .slice(1)
            .some(
              (end, index) =>
                distance(point, closestPoint(point, segment.points[index], end).point) < 17,
            ),
        );
        if (conflicts) continue;
        result.push({
          ...point,
          frontage: foot,
          roadId: road.id,
          angle: Math.atan2(b.x - a.x, b.z - a.z),
          zone,
          built: false,
        });
      }
      sample += 39;
    }
    along += length;
  }
  return result;
}

export type Utility = "power" | "water" | "sewage";
export const utilities: Utility[] = ["power", "water", "sewage"];

export function utilityAccess(city: Development, components = roadComponents(city)) {
  const byComponent = new Map<number, Record<Utility, number>>();
  for (const facility of city.facilities) {
    const component = components.get(facility.roadId);
    if (component === undefined || !utilities.some((service) => service === facility.service))
      continue;
    const capacity = byComponent.get(component) ?? { power: 0, water: 0, sewage: 0 };
    const service = facility.service as Utility;
    const budget = city.region?.districts[landId(facility)]?.budget ?? 100;
    capacity[service] += Math.floor((services[service].capacity * budget) / 100);
    byComponent.set(component, capacity);
  }
  return byComponent;
}

export function utilityDemand(parcel: Parcel): number {
  const zone = zones[parcel.zone];
  return Math.max(6, zone.residents + zone.jobs * 2);
}

export function suppliedParcels(city: Development, components = roadComponents(city)): Set<number> {
  const remaining = utilityAccess(city, components);
  const supplied = new Set<number>();
  for (const parcel of city.parcels) {
    const key = components.get(parcel.roadId);
    const capacity = key === undefined ? undefined : remaining.get(key);
    const required = utilityDemand(parcel);
    if (!capacity || utilities.some((service) => capacity[service] < required)) continue;
    for (const service of utilities) capacity[service] -= required;
    supplied.add(parcel.id);
  }
  return supplied;
}

export function develop(city: Development, supplied: Set<number>): boolean {
  for (const parcel of city.parcels) {
    if (!parcel.built && supplied.has(parcel.id)) {
      parcel.built = true;
      return true;
    }
  }
  return false;
}
