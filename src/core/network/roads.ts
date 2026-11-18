import { distance, height, mix, WATER, type Point } from "../world/terrain.ts";

export const streets = {
  street: { width: 13, speed: 28, capacity: 6, cost: 19, sidewalks: true },
  avenue: { width: 23, speed: 46, capacity: 14, cost: 34, sidewalks: true },
  highway: { width: 26, speed: 80, capacity: 22, cost: 52, sidewalks: false },
} as const;

export type RoadClass = keyof typeof streets;
export interface Node extends Point {
  id: number;
}
export interface Road {
  id: number;
  a: number;
  b: number;
  points: Point[];
  kind: RoadClass;
  bridge: boolean;
}
export interface Network {
  nodes: Node[];
  roads: Road[];
  nextId: number;
}

export function roadLength(points: Point[]): number {
  return points.slice(1).reduce((sum, point, i) => sum + distance(points[i], point), 0);
}

export function roadElevation(seed: number, point: Point, bridge: boolean): number {
  return Math.max(bridge ? WATER + 5 : -100, height(seed, point)) + 0.8;
}

export function closestPoint(point: Point, a: Point, b: Point): { point: Point; t: number } {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const part = ((point.x - a.x) * dx + (point.z - a.z) * dz) / (dx * dx + dz * dz || 1);
  const t = Math.max(0, Math.min(1, part));
  return { point: mix(a, b, t), t };
}

export function snap(network: Network, point: Point): Point {
  let closest = point;
  let limit = 12;
  for (const node of network.nodes) {
    const gap = distance(point, node);
    if (gap < limit) {
      closest = node;
      limit = gap;
    }
  }
  if (closest !== point) return { x: closest.x, z: closest.z };
  for (const road of network.roads) {
    for (let i = 1; i < road.points.length; i++) {
      const candidate = closestPoint(point, road.points[i - 1], road.points[i]).point;
      const gap = distance(candidate, point);
      if (gap < limit) {
        closest = candidate;
        limit = gap;
      }
    }
  }
  return closest;
}
