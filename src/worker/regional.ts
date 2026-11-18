import { createCity, execute, restore, snapshot } from "../core/sim/city.ts";
import { PROTOCOL, type Reply, type Request } from "./protocol.ts";

let city = createCity(7);
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
  const { seed, tick, cash, revision, roads, land } = city;
  post({
    kind: "panel",
    panel: { seed, tick, cash, revision, roadCount: roads.length, owned: land },
  });
  if (topology) post({ kind: "scene", scene: { seed, revision, roads } });
}

self.onmessage = ({ data }: MessageEvent<Request>) => {
  if (data.version !== PROTOCOL) return;
  const { id } = data;
  if (data.kind === "checkpoint") {
    post({ kind: "checkpoint", id, checkpoint: snapshot(city) });
    return;
  }
  if (data.kind === "select") {
    post({ kind: "selection", id, road: city.roads.find((road) => road.id === data.roadId) });
    return;
  }
  try {
    if (data.kind === "command") {
      const result = execute(city, data.command);
      post({ kind: "ack", id, result });
      if (result.ok) publish(data.command.kind !== "step");
      return;
    }
    if (data.kind === "initialize") {
      if (!Number.isSafeInteger(data.seed)) throw new Error("Invalid map seed");
      city = createCity(data.seed);
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
