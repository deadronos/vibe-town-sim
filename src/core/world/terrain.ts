export interface Point {
  x: number;
  z: number;
}

export const REGION = 8_000;
export const TILE = 2_000;
export const CHUNK = 500;
export const WATER = 0;

export function riverCenter(seed: number, z: number): number {
  return 230 + Math.sin(z / 630 + seed * 0.09) * 155 + z * 0.11;
}

export function height(seed: number, { x, z }: Point): number {
  const bank = Math.min(1, Math.abs(x - riverCenter(seed, z)) / 145);
  const hills = 22 + 12 * Math.sin(x / 570 + seed * 0.11) * Math.cos(z / 740);
  return bank * hills - 9 + bank * (3 * Math.sin(z / 155) + 1.8 * Math.sin((x + z) / 91));
}

export function contains({ x, z }: Point): boolean {
  return Math.abs(x) < REGION / 2 && Math.abs(z) < REGION / 2;
}

export function landId({ x, z }: Point): string {
  return `${Math.floor((x + REGION / 2) / TILE)},${Math.floor((z + REGION / 2) / TILE)}`;
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

export function mix(a: Point, b: Point, t: number): Point {
  return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
}

export function hash(seed: number): number {
  let value = Math.imul(seed ^ (seed >>> 16), 0x45d9f3b);
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
}
