import type { City, Command, Result } from "../core/sim/city.ts";
import type { Road } from "../core/network/roads.ts";

export const PROTOCOL = 1;
export type Request = { id: number; version: 1 } & (
  | { kind: "initialize"; seed: number }
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
  owned: string[];
}
export interface Scene {
  seed: number;
  revision: number;
  roads: Road[];
}
export type Reply = { version: 1 } & (
  | { kind: "ack"; id: number; result: Result }
  | { kind: "panel"; panel: Panel }
  | { kind: "scene"; scene: Scene }
  | { kind: "checkpoint"; id: number; checkpoint: City }
  | { kind: "selection"; id: number; road: Road | undefined }
);
