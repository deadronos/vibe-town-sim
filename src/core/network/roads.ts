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

interface Cut {
  at: number;
  point: Point;
}

function intersect(
  a: Point,
  b: Point,
  c: Point,
  d: Point,
): { first: number; second: number } | undefined {
  const x = b.x - a.x;
  const z = b.z - a.z;
  const u = d.x - c.x;
  const v = d.z - c.z;
  const determinant = x * v - z * u;
  if (Math.abs(determinant) < 0.00001) return;
  const first = ((c.x - a.x) * v - (c.z - a.z) * u) / determinant;
  const second = ((c.x - a.x) * z - (c.z - a.z) * x) / determinant;
  if (first < -1e-8 || first > 1 + 1e-8 || second < -1e-8 || second > 1 + 1e-8) return;
  return { first: Math.max(0, Math.min(1, first)), second: Math.max(0, Math.min(1, second)) };
}

function split(points: Point[], cuts: Cut[]): Point[][] {
  const end = points.length - 1;
  const ordered = [{ at: 0, point: points[0] }, ...cuts, { at: end, point: points[end] }]
    .sort((a, b) => a.at - b.at)
    .filter((cut, i, list) => i === 0 || cut.at - list[i - 1].at > 1e-7);
  return ordered.slice(1).map((stop, i) => {
    const start = ordered[i];
    return [
      start.point,
      ...points.slice(Math.floor(start.at + 1e-7) + 1, Math.ceil(stop.at - 1e-7)),
      stop.point,
    ];
  });
}

export function nearestRoad(points: Point, roads: Road[]): Road | undefined {
  let found: Road | undefined;
  let minimum = Infinity;
  for (const road of roads) {
    for (let i = 1; i < road.points.length; i++) {
      const gap = distance(points, closestPoint(points, road.points[i - 1], road.points[i]).point);
      if (gap < minimum) {
        minimum = gap;
        found = road;
      }
    }
  }
  return found;
}

export function addRoad(
  network: Network,
  points: Point[],
  kind: RoadClass,
  bridge: boolean,
): Map<number, Road[]> {
  const intersections = new Map<number, Cut[]>();
  const newCuts: Cut[] = [];

  for (const road of network.roads) {
    const cuts: Cut[] = [];
    for (let i = 1; i < points.length; i++) {
      for (let j = 1; j < road.points.length; j++) {
        const hit = intersect(points[i - 1], points[i], road.points[j - 1], road.points[j]);
        if (!hit) continue;
        const point = mix(points[i - 1], points[i], hit.first);
        const proposedAt = i - 1 + hit.first;
        const existingAt = j - 1 + hit.second;
        const joinsAtEnd =
          proposedAt < 1e-7 ||
          proposedAt > points.length - 1 - 1e-7 ||
          existingAt < 1e-7 ||
          existingAt > road.points.length - 1 - 1e-7;
        if (bridge !== road.bridge && !joinsAtEnd) continue;
        newCuts.push({ at: proposedAt, point });
        cuts.push({ at: existingAt, point });
      }
    }
    if (cuts.length) intersections.set(road.id, cuts);
  }

  function node(point: Point): number {
    const existing = network.nodes.find((node) => distance(node, point) < 0.001);
    if (existing) return existing.id;
    const id = network.nextId++;
    network.nodes.push({ x: point.x, z: point.z, id });
    return id;
  }

  function segment(points: Point[], kind: RoadClass, bridge: boolean, id: number): Road {
    return { id, a: node(points[0]), b: node(points.at(-1)!), points, kind, bridge };
  }

  const replaced = new Map<number, Road[]>();
  network.roads = network.roads.flatMap((road) => {
    const cuts = intersections.get(road.id);
    if (!cuts) return road;
    const pieces = split(road.points, cuts);
    if (pieces.length === 1) return road;
    const segments = pieces.map((piece, i) =>
      segment(piece, road.kind, road.bridge, i === 0 ? road.id : network.nextId++),
    );
    replaced.set(road.id, segments);
    return segments;
  });
  for (const piece of split(points, newCuts))
    network.roads.push(segment(piece, kind, bridge, network.nextId++));
  return replaced;
}

export function roadComponents(network: Network): Map<number, number> {
  const parents = new Map(network.nodes.map((node) => [node.id, node.id]));
  function root(id: number): number {
    while (parents.get(id) !== id) id = parents.get(id)!;
    return id;
  }
  for (const road of network.roads) {
    const a = root(road.a);
    const b = root(road.b);
    if (a !== b) parents.set(Math.max(a, b), Math.min(a, b));
  }
  return new Map(network.roads.map((road) => [road.id, root(road.a)]));
}
