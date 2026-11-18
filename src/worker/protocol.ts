import type { regionSummary, Stop, Line } from "../core/sim/region.ts";
import type { City, Command, Result } from "../core/sim/city.ts";
import type { economicSummary, Firm, Household } from "../core/sim/economy.ts";
import type { Parcel, Facility } from "../core/sim/development.ts";
import type { Road } from "../core/network/roads.ts";

export const PROTOCOL = 1;
export type Request = { id: number; version: 1 } & (
  | { kind: "initialize"; seed: number; empty?: boolean }
  | { kind: "command"; command: Command }
  | { kind: "speed"; speed: 0 | 1 | 4 | 16 }
  | { kind: "restore"; checkpoint: unknown }
  | { kind: "checkpoint" }
  | { kind: "select"; roadId: number }
);
export interface Panel {
  seed: number;
  tick: number;
  cash: number;
  revision: number;
  roadCount: number;
  houses: number;
  population: number;
  economy: ReturnType<typeof economicSummary> | null;
  region: ReturnType<typeof regionSummary> | null;
  debt: number;
  refinancing: boolean;
  owned: string[];
}
export interface Scene {
  seed: number;
  revision: number;
  roads: Road[];
  parcels: Parcel[];
  facilities: Facility[];
  stops: Stop[];
  lines: Line[];
  supplied: number[];
}
export type Reply = { version: 1 } & (
  | { kind: "ack"; id: number; result: Result }
  | { kind: "panel"; panel: Panel }
  | { kind: "scene"; scene: Scene }
  | { kind: "vehicles"; poses: Float32Array }
  | { kind: "checkpoint"; id: number; checkpoint: City }
  | {
      kind: "selection";
      id: number;
      entity: Road | Parcel | Facility | Stop | undefined;
      firm?: Firm;
      home?: Household;
      traffic?: { admitted: number; queued: number };
    }
);
