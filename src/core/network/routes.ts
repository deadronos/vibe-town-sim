import { roadLength, streets, type Network, type Road } from "./roads.ts";

export function travelDays(road: Road): number {
  return Math.max(1, Math.ceil(roadLength(road.points) / (streets[road.kind].speed * 9)));
}

export function planner(network: Network) {
  const roads = new Map(network.roads.map((road) => [road.id, road]));
  const incident = new Map<number, Road[]>();
  const cache = new Map<string, number[] | undefined>();
  for (const road of network.roads) {
    for (const end of [road.a, road.b]) {
      const list = incident.get(end) ?? [];
      list.push(road);
      incident.set(end, list);
    }
  }

  function route(from: number, to: number): number[] | undefined {
    if (!roads.has(from) || !roads.has(to)) return;
    if (from === to) return [from];
    const key = `${from},${to}`;
    if (cache.has(key)) return cache.get(key);
    const origin = roads.get(from)!;
    const destination = roads.get(to)!;
    const pending = new Map([origin.a, origin.b].map((end) => [end, 0]));
    const previous = new Map<number, { node: number; road: number }>();
    const visited = new Set<number>();
    let answer: number[] | undefined;
    while (pending.size) {
      let node = 0;
      let cost = Infinity;
      for (const [candidate, distance] of pending) {
        if (distance < cost || (distance === cost && candidate < node)) {
          node = candidate;
          cost = distance;
        }
      }
      pending.delete(node);
      visited.add(node);
      if (node === destination.a || node === destination.b) {
        answer = [to];
        while (previous.has(node)) {
          const edge = previous.get(node)!;
          answer.push(edge.road);
          node = edge.node;
        }
        answer.push(from);
        answer.reverse();
        break;
      }
      for (const road of incident.get(node) ?? []) {
        if (road.id === from || road.id === to) continue;
        const next = road.a === node ? road.b : road.a;
        const distance = cost + travelDays(road);
        if (visited.has(next) || distance >= (pending.get(next) ?? Infinity)) continue;
        pending.set(next, distance);
        previous.set(next, { node, road: road.id });
      }
    }
    cache.set(key, answer);
    return answer;
  }
  return { roads, route };
}
