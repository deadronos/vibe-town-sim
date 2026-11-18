import { createOpening } from "../core/sim/openings.ts";
import { roadLength, segmentElevation } from "../core/network/roads.ts";
import { travelDays } from "../core/network/routes.ts";
import { distance, mix } from "../core/world/terrain.ts";
import { createCity, execute, restore, snapshot } from "../core/sim/city.ts";
import { economicSummary } from "../core/sim/economy.ts";
import { regionSummary } from "../core/sim/region.ts";
import { suppliedParcels, zones } from "../core/sim/development.ts";
import { PROTOCOL, type Reply, type Request } from "./protocol.ts";

let city = createCity(7);
let publishedBuildings = -1;
let speed: 0 | 1 | 4 | 16 = 0;

function post(
  message:
    | Omit<Extract<Reply, { kind: "panel" }>, "version">
    | Omit<Extract<Reply, { kind: "scene" }>, "version">
    | Omit<Extract<Reply, { kind: "ack" }>, "version">
    | Omit<Extract<Reply, { kind: "checkpoint" }>, "version">
    | Omit<Extract<Reply, { kind: "selection" }>, "version">,
): void {
  self.postMessage({ ...message, version: PROTOCOL });
}

function publish(topology = false): void {
  const { seed, tick, cash, revision, roads, land, parcels, facilities } = city;
  const buildings = parcels.filter((parcel) => parcel.built);
  post({
    kind: "panel",
    panel: {
      seed,
      tick,
      cash,
      revision,
      roadCount: roads.length,
      owned: land,
      houses: buildings.length,
      economy: economicSummary(city),
      region: regionSummary(city),
      debt: city.debt,
      refinancing: city.refinancing,
      population: buildings.reduce((sum, parcel) => sum + zones[parcel.zone].residents, 0),
    },
  });
  if (topology || publishedBuildings !== buildings.length) {
    post({
      kind: "scene",
      scene: {
        seed,
        revision,
        roads,
        parcels,
        facilities,
        stops: city.region.stops,
        lines: city.region.lines,
        supplied: [...suppliedParcels(city)],
      },
    });
    publishedBuildings = buildings.length;
  }
  publishVehicles();
}

function publishVehicles(): void {
  const roads = new Map(city.roads.map((road) => [road.id, road]));
  const vehicles = city.economy.trips.slice(0, 250);
  const poses = new Float32Array(vehicles.length * 7);
  for (const [index, trip] of vehicles.entries()) {
    const road = roads.get(trip.edges[trip.edge]);
    if (!road) continue;
    const edge = city.roads.find((segment) => segment.id === trip.edges[trip.edge + 1]);
    const reverse = edge ? edge.a === road.a || edge.b === road.a : false;
    const progress = trip.due
      ? Math.max(0.04, 1 - (trip.due - city.tick) / travelDays(road))
      : 0.02;
    let offset = roadLength(road.points) * (reverse ? 1 - progress : progress);
    for (let segment = 1; segment < road.points.length; segment++) {
      const a = road.points[segment - 1];
      const b = road.points[segment];
      const length = distance(a, b);
      if (offset <= length || segment === road.points.length - 1) {
        const t = Math.min(1, offset / length);
        const point = mix(a, b, t);
        const angle = Math.atan2(b.x - a.x, b.z - a.z);
        poses.set(
          [
            trip.id,
            point.x,
            segmentElevation(city.seed, road.points, segment, t, road.bridge),
            point.z,
            angle + (reverse ? Math.PI : 0),
            trip.mode !== "road" ? 2 : trip.kind === "commute" ? 0 : 1,
            trip.edges[trip.edge],
          ],
          index * 7,
        );
        break;
      }
      offset -= length;
    }
  }
  self.postMessage({ version: PROTOCOL, kind: "vehicles", poses }, { transfer: [poses.buffer] });
}

self.onmessage = ({ data }: MessageEvent<Request>) => {
  if (data.version !== PROTOCOL) return;
  const { id } = data;
  if (data.kind === "checkpoint") {
    post({ kind: "checkpoint", id, checkpoint: snapshot(city) });
    return;
  }
  if (data.kind === "select") {
    post({
      kind: "selection",
      id,
      firm: city.economy.firms[data.roadId],
      home: city.economy.households[data.roadId],
      traffic: city.economy.roadTraffic[data.roadId],
      entity: [...city.roads, ...city.parcels, ...city.facilities, ...city.region.stops].find(
        (item) => item.id === data.roadId,
      ),
    });
    return;
  }
  try {
    if (data.kind === "command") {
      const result = execute(city, data.command);
      post({ kind: "ack", id, result });
      if (result.ok) publish(true);
      return;
    }
    if (data.kind === "initialize") {
      if (!Number.isSafeInteger(data.seed)) throw new Error("Invalid map seed");
      city = data.empty ? createCity(data.seed) : createOpening(data.seed);
    } else if (data.kind === "restore") {
      city = restore(data.checkpoint);
    } else {
      if (![0, 1, 4, 16].includes(data.speed)) throw new Error("Invalid simulation speed");
      speed = data.speed;
    }
    post({ kind: "ack", id, result: { ok: true, revision: city.revision } });
    publish(data.kind !== "speed");
  } catch (error) {
    post({
      kind: "ack",
      id,
      result: { ok: false, revision: city.revision, reason: (error as Error).message },
    });
  }
};

setInterval(() => {
  if (speed === 0) return;
  execute(city, { kind: "step", count: speed });
  publish();
}, 250);
