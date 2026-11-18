export type Commute = { home: number; workplace: number; workers: number; path: number[] };

// In stable lot order, households take the nearest reachable vacancies. Each BFS
// starts at every road touching the home and ends at a workplace entrance.
export function matchCommutes(entrances: number[][], workers: number[], positions: number[]) {
  const vacancies = positions.slice();
  const matched = workers.map(() => 0);
  const workplaces = entrances.map(() => [] as number[]);
  const routes: Commute[] = [];
  const hasReachableJobs = workers.map(() => false);
  let employed = 0;
  positions.forEach((count, lot) => {
    if (count) for (const road of entrances[lot]) workplaces[road].push(lot);
  });
  workers.forEach((count, home) => {
    if (!count) return;
    const queue = [...entrances[home]];
    const parent = new Int32Array(entrances.length).fill(-1);
    for (const road of queue) parent[road] = road;
    for (let head = 0; head < queue.length && count > 0; head++) {
      const road = queue[head];
      for (const workplace of workplaces[road]) {
        hasReachableJobs[home] = true;
        const hired = Math.min(count, vacancies[workplace]);
        if (!hired) continue;
        const path = [road];
        let cursor = road;
        while (parent[cursor] !== cursor) {
          cursor = parent[cursor];
          path.push(cursor);
        }
        routes.push({ home, workplace, workers: hired, path: path.reverse() });
        matched[home] += hired;
        employed += hired;
        vacancies[workplace] -= hired;
        count -= hired;
        if (!count) break;
      }
      for (const next of entrances[road])
        if (parent[next] === -1) {
          parent[next] = road;
          queue.push(next);
        }
    }
  });
  return { routes, employed, matched, vacancies, hasReachableJobs };
}
