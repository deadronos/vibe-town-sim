import { Mesh } from "./graphics.js";
import { N, coast, id, land, neighbors, noise, type City, type Kind } from "./sim.js";
const greens = ["7ca867", "87b271", "84af6f", "8ab472", "8bb673", "90b977"];
const roofs = ["b76b48", "a65b47", "596f77", "53756f", "a37c54", "b25e45"];
export const zoneColor = { residential: "9ecb86", commercial: "77acc4", industrial: "dcb66e" };
function tree(m: Mesh, x: number, z: number, h: number, seed: number) {
  const c = ["458456", "367653", "518550", "6a9957", "578c52"][Math.floor(seed * 5) % 5];
  m.box(x - 0.042 * h, 0, z - 0.045 * h, 0.084 * h, 0.49 * h, 0.09 * h, "866f50");
  if (seed > 0.55) {
    m.cone(x, 0.23 * h, z, 0.32 * h, 0.69 * h, c, 6);
    m.cone(x, 0.52 * h, z, 0.23 * h, 0.58 * h, c, 6);
  } else {
    m.cone(x, 0.32 * h, z, 0.16 * h, 0.23 * h, c, 7, 0.33 * h);
    m.cone(x, 0.55 * h, z, 0.33 * h, 0.26 * h, c, 7, 0.25 * h);
    m.cone(x, 0.81 * h, z, 0.25 * h, 0.18 * h, c, 7, 0.07 * h);
  }
}
export function model(m: Mesh, x: number, z: number, k: Kind, l: number, o = false) {
  const r = noise(x, z, 1),
    c = zoneColor[k as keyof typeof zoneColor];
  if (k === "empty" || k === "road") return;
  if (c && (o || l === 0)) m.flat(x + 0.04, z + 0.04, 0.92, 0.92, 0.025, c);
  if (c && l === 0) {
    m.flat(x + 0.33, z + 0.38, 0.34, 0.2, 0.033, "c5b99a");
    return;
  }
  if (k === "park") {
    m.flat(x + 0.06, z + 0.06, 0.88, 0.88, 0.026, "8ab466");
    m.flat(x + 0.45, z + 0.09, 0.13, 0.82, 0.033, "c5b898");
    tree(m, x + 0.25, z + 0.28, 0.79, r);
    tree(m, x + 0.75, z + 0.62, 0.62, 1 - r);
    m.box(x + 0.13, 0.04, z + 0.72, 0.26, 0.09, 0.09, "936b45");
    return;
  }
  if (k === "power") {
    m.cone(x + 0.49, 0, z + 0.5, 0.075, 1.65, "ebebe0", 8, 0.041);
    const a: [number, number, number] = [x + 0.49, 1.62, z + 0.56];
    for (let i = 0; i < 3; i++) {
      const t = 0.45 + (i * 2 * Math.PI) / 3;
      m.tri(
        a,
        [a[0] + Math.cos(t) * 0.63, a[1] + Math.sin(t) * 0.63, a[2]],
        [a[0] + Math.cos(t + 0.38) * 0.25, a[1] + Math.sin(t + 0.38) * 0.25, a[2] + 0.02],
        "f6efe0",
      );
    }
    return;
  }
  if (k === "water") {
    m.cone(x + 0.5, 0, z + 0.5, 0.13, 0.73, "788c87", 7, 0.11);
    m.cone(x + 0.5, 0.72, z + 0.5, 0.13, 0.19, "729da0", 10, 0.32);
    m.cone(x + 0.5, 0.91, z + 0.5, 0.32, 0.34, "96c1bf", 10, 0.32);
    m.cone(x + 0.5, 1.25, z + 0.5, 0.33, 0.15, "577f82", 10);
    return;
  }
  const w = 0.48 + r * 0.19,
    d = 0.48 + noise(x, z, 4) * 0.23,
    b = x + 0.14,
    f = z + 0.13;
  if (k === "residential") {
    const h = 0.25 + l * 0.09;
    const wall = ["eee1bd", "e2d3ad", "f0d8b8", "becbc3"][Math.floor(r * 4)];
    m.box(b, 0.035, f, w, h, d, wall);
    const y = h + 0.035,
      roof = roofs[Math.floor(noise(z, x, 2) * roofs.length)],
      left = b - 0.04,
      right = b + w + 0.04,
      front = f + d + 0.045,
      back = f - 0.045,
      mid = b + w * 0.5;
    m.quad([left, y, front], [left, y, back], [mid, y + 0.23, back], [mid, y + 0.23, front], roof);
    m.quad(
      [mid, y + 0.23, front],
      [mid, y + 0.23, back],
      [right, y, back],
      [right, y, front],
      roof,
      0.77,
    );
    for (const end of [front, back])
      m.tri([left, y, end], [right, y, end], [mid, y + 0.23, end], wall, 0.82);
    m.box(b + w * 0.72, y + 0.025, f + d * 0.27, 0.075, 0.21, 0.09, "a77960");
    m.box(b + w * 0.44, 0.035, f + d, 0.1, 0.2, 0.009, "865f45");
    for (const dx of [0.12, 0.72]) m.box(b + w * dx, 0.17, f + d, 0.095, 0.11, 0.012, "658891");
    m.box(b + w, 0.17, f + d * 0.32, 0.012, 0.105, 0.12, "69878c");
    m.box(b - 0.011, 0.17, f + d * 0.4, 0.012, 0.105, 0.12, "69878c");
    m.box(b + w * 0.35, 0.17, f - 0.011, 0.12, 0.105, 0.012, "69878c");
    m.flat(b + w * 0.44, f + d + 0.015, 0.1, 0.15, 0.036, "c8bda0");
    if (r > 0.4) tree(m, x + 0.82, z + 0.78, 0.48 + r * 0.17, r);
  } else if (k === "commercial") {
    const h = 0.35 + l * (0.26 + r * 0.34) + (l === 3 && r > 0.62 ? 0.72 : 0);
    m.box(b, 0, f, w, h, d, ["b3c4bd", "dfc8a0", "b6c7cd"][Math.floor(r * 3)]);
    for (let j = 0.19; j < h - 0.08; j += 0.235) {
      m.box(b + 0.045, j, f + d, w - 0.09, 0.105, 0.012, "5b7e87");
      m.box(b + 0.045, j, f - 0.011, w - 0.09, 0.105, 0.012, "65838a");
      m.box(b - 0.011, j, f + 0.04, 0.012, 0.105, d - 0.08, "709297");
      m.box(b + w, j, f + 0.04, 0.012, 0.105, d - 0.08, "68858a");
    }
    m.box(b - 0.025, h, f - 0.025, w + 0.05, 0.07, d + 0.05, "e4dfca");
    m.box(b + 0.065, h + 0.07, f + 0.06, w - 0.13, 0.025, d - 0.12, "83918c");
    m.box(b + 0.09, h + 0.09, f + 0.09, 0.15, 0.09, 0.14, "b3bab1");
    m.box(b, 0.19, f + d, w, 0.055, 0.085, "bf7654");
  } else {
    m.box(b, 0, f, w, 0.45, d, "c5a579");
    m.box(b - 0.025, 0.45, f - 0.025, w + 0.05, 0.08, d + 0.05, "8f9892");
    for (let j = 0; j < 3; j++)
      m.box(b + 0.06 + j * 0.15, 0.18, f + d, 0.105, 0.14, 0.011, "637b78");
    m.cone(b + w * 0.75, 0.48, f + d * 0.28, 0.08, 0.43 + l * 0.12, "b27459", 8, 0.064);
    m.cone(b + w * 0.75, 0.78 + l * 0.12, f + d * 0.28, 0.068, 0.085, "e5d7b9", 8, 0.067);
  }
}
export function world(c: City, overlay: boolean) {
  const m = new Mesh();
  m.flat(-240, -240, 520, 520, -0.125, "73b6b2");
  // Distant headlands give low camera angles a coastal horizon.
  for (let i = 0; i < 30; i++) {
    const a = i * 0.67,
      radius = 75 + noise(i, 9) * 28;
    const x = 18 + Math.cos(a) * radius,
      z = 18 + Math.sin(a) * radius;
    const base = 6 + noise(i, 19) * 9;
    // Unequal shoulders and an offset summit break up the distant silhouette.
    const peak: [number, number, number] = [
      x + base * 0.23,
      base * (0.21 + 0.31 * noise(i, 91)),
      z - base * 0.12,
    ];
    const rim = Array.from({ length: 10 }, (_, j) => {
      const t = (j * Math.PI) / 5,
        length = base * (0.72 + 0.46 * noise(j, i));
      return [x + Math.cos(t) * length * 1.4, -0.2, z + Math.sin(t) * length] as [
        number,
        number,
        number,
      ];
    });
    const shoulder = rim.map(
      ([bx, , bz], j) =>
        [
          bx * 0.47 + peak[0] * 0.53,
          peak[1] * (0.42 + 0.36 * noise(i, j)),
          bz * 0.47 + peak[2] * 0.53,
        ] as [number, number, number],
    );
    for (let j = 0; j < rim.length; j++) {
      const k = (j + 1) % rim.length,
        light = 0.86 + 0.1 * Math.cos((j * Math.PI) / 5);
      m.quad(rim[j], rim[k], shoulder[k], shoulder[j], "88a99a", light);
      m.tri(shoulder[j], shoulder[k], peak, "9ab4a3", light);
    }
  }
  for (let z = -18; z < N + 18; z++)
    for (let x = -18; x < N + 18; x++) {
      const r = noise(x, z);
      if (!land(x, z)) {
        const shore = coast(x, z);
        if (shore > -0.12) m.flat(x, z, 1, 1, -0.112, shore > -0.03 ? "96c9bc" : "82beb8");
        if (r > 0.69)
          m.flat(
            x + r * 0.33,
            z + noise(z, x) * 0.75,
            0.12 + r * 0.32,
            0.018,
            -0.101,
            shore > -0.12 ? "b3d5c7" : "90c8c1",
          );
        continue;
      }
      const tileStart = m.data.length;
      const t = c.tiles[id(x, z)];
      m.box(
        x,
        -0.12,
        z,
        1,
        0.12,
        1,
        coast(x, z) < 0.105 ? "d8c896" : greens[Math.floor(r * greens.length)],
      );
      if (t.kind === "road") {
        m.flat(x, z, 1, 1, 0.012, "b8b6a1");
        const road = "727c7a";
        m.flat(x + 0.13, z + 0.13, 0.74, 0.74, 0.018, road);
        for (const [dx, dz] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ])
          if (c.tiles[id(x + dx, z + dz)]?.kind === "road") {
            m.flat(
              x + (dx < 0 ? 0 : dx > 0 ? 0.49 : 0.13),
              z + (dz < 0 ? 0 : dz > 0 ? 0.49 : 0.13),
              dx ? 0.51 : 0.74,
              dz ? 0.51 : 0.74,
              0.019,
              road,
            );
            m.flat(
              x + (dx > 0 ? 0.8 : dx < 0 ? 0.06 : 0.49),
              z + (dz > 0 ? 0.8 : dz < 0 ? 0.06 : 0.49),
              dx ? 0.14 : 0.023,
              dz ? 0.14 : 0.023,
              0.023,
              "d4ceab",
            );
          }
      } else if (t.kind === "empty") {
        if (coast(x, z) > 0.11 && r > 0.53) {
          tree(
            m,
            x + 0.25 + r * 0.43,
            z + 0.32 + noise(z, x) * 0.34,
            0.62 + noise(z, x, 3) * 0.58,
            noise(x, z, 17),
          );
          if (r > 0.84) tree(m, x + 0.25, z + 0.18, 0.53, r * 0.45);
        } else if (r < 0.09) {
          m.cone(x + 0.34, 0.005, z + 0.47, 0.15, 0.13, "adb2a0", 5, 0.08);
        }
      } else {
        const first = m.data.length;
        model(m, x, z, t.kind, t.level, overlay);
        const facing = neighbors(id(x, z)).find((n) => c.tiles[n].kind === "road");
        if (facing !== undefined && t.kind !== "park") {
          const direction = facing - id(x, z);
          for (let i = first; i < m.data.length; i += 6) {
            const a = m.data[i] - x - 0.5,
              b = m.data[i + 2] - z - 0.5;
            if (direction === 1) {
              m.data[i] = x + 0.5 + b;
              m.data[i + 2] = z + 0.5 - a;
            } else if (direction === -1) {
              m.data[i] = x + 0.5 - b;
              m.data[i + 2] = z + 0.5 + a;
            } else if (direction === -N) {
              m.data[i] = x + 0.5 - a;
              m.data[i + 2] = z + 0.5 - b;
            }
          }
        }
      }
      m.lots.push({ start: tileStart, end: m.data.length, id: id(x, z) });
    }
  // Sailboats mark the shallow-water approaches to the bay.
  for (const [x, z, size, color] of [
    [2, 9, 1, "e3a765"],
    [32, 29, 0.78, "bc715b"],
    [9, 32, 0.64, "78a6a2"],
  ] as const) {
    const h = size;
    m.cone(x, -0.103, z, 0.22 * h, 0.11 * h, "986e4c", 6, 0.29 * h);
    m.box(x - 0.025 * h, -0.02, z - 0.025 * h, 0.05 * h, 1.05 * h, 0.05 * h, "816f52");
    m.tri([x, 0.96 * h, z], [x, 0.13 * h, z], [x - 0.55 * h, 0.14 * h, z], "f4edcf");
    m.tri(
      [x + 0.035 * h, 0.78 * h, z],
      [x + 0.035 * h, 0.13 * h, z],
      [x + 0.33 * h, 0.14 * h, z],
      color,
    );
  }
  return m;
}
