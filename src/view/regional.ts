import {
  AmbientLight,
  BoxGeometry,
  ConeGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  Fog,
  DirectionalLight,
  DoubleSide,
  GridHelper,
  Line as ThreeLine,
  LineBasicMaterial,
  Vector3,
  Group,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  MeshStandardMaterial,
  Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  Raycaster,
  Scene as ThreeScene,
  Vector2,
  WebGLRenderer,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { CHUNK, hash, height, REGION, TILE, type Point } from "../core/world/terrain.ts";
import { closestPoint, segmentElevation, streets, type Road } from "../core/network/roads.ts";
import { planner } from "../core/network/routes.ts";
import { fields, type Field, type Stop } from "../core/sim/region.ts";
import { zones, type Parcel, type Facility } from "../core/sim/development.ts";
import type { Scene } from "../worker/protocol.ts";

const terrainMaterial = new MeshLambertMaterial({ vertexColors: true });
export type Layer = "none" | "utilities" | "transit" | "traffic" | Field;

const roadMaterial = new MeshLambertMaterial({ color: 0x4b5052, side: DoubleSide });
const shoulderMaterial = new MeshLambertMaterial({ color: 0xb1a799, side: DoubleSide });

export async function createViewport(
  canvas: HTMLCanvasElement,
  click: (point: Point, roadId?: number) => void,
  benchmark: boolean,
  backend: "webgl" | "webgpu" = "webgl",
  hover?: (point?: Point, id?: number) => void,
) {
  const started = performance.now();
  const renderer =
    backend === "webgpu"
      ? new (await import("three/webgpu")).WebGPURenderer({ canvas, antialias: true })
      : new WebGLRenderer({ canvas, antialias: true });
  if ("init" in renderer) await renderer.init();
  const actualBackend =
    "backend" in renderer && "isWebGPUBackend" in renderer.backend ? "webgpu" : "webgl";
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  const scene = new ThreeScene();
  scene.background = new Color(0xa3c1c2);
  scene.fog = new Fog(0xa3c1c2, 1_800, 12_000);
  scene.add(new AmbientLight(0xf0eee0, 1.7));
  const sun = new DirectionalLight(0xffe8ba, 2.1);
  sun.position.set(-150, 500, -130);
  scene.add(sun);
  const camera = new PerspectiveCamera(45, 1, 2, 20_000);
  const controls = new OrbitControls(camera, canvas);
  controls.minDistance = 90;
  controls.maxDistance = 8_500;
  controls.maxPolarAngle = Math.PI * 0.475;
  controls.mouseButtons = { ...controls.mouseButtons, LEFT: null };
  controls.target.set(-515, 12, -700);
  camera.position.set(-245, 440, -115);
  controls.update();
  const terrain = new Group();
  const roadGroup = new Group();
  const lotGroup = new Group();
  const overlay = new Group();
  const transit = new Group();
  scene.add(terrain, roadGroup, lotGroup, overlay, transit);
  const box = new BoxGeometry(1, 1, 1);
  const tree = new ConeGeometry(1, 1, 6);
  const trunk = new CylinderGeometry(0.85, 1, 1, 5);
  const houseKit: BufferGeometry[] = [];
  const houseMaterial = new MeshLambertMaterial({ vertexColors: true });
  const roof = new ConeGeometry(0.75, 1, 4);
  roof.rotateY(Math.PI / 4);
  const materials = new Map<number, MeshLambertMaterial>();
  function material(color: number) {
    if (!materials.has(color)) materials.set(color, new MeshLambertMaterial({ color }));
    return materials.get(color)!;
  }
  const lots = new Map<number, { group: Group; key: string }>();
  const water = new Mesh(
    new PlaneGeometry(REGION, REGION),
    new MeshLambertMaterial({ color: 0x327985 }),
  );
  water.rotation.x = -Math.PI / 2;
  scene.add(water);
  const grid = new GridHelper(REGION, 4, 0xc6d395, 0xc6d395);
  grid.position.y = 36;
  grid.visible = false;
  scene.add(grid);
  const tile = new Mesh(
    new PlaneGeometry(TILE, TILE),
    new MeshBasicMaterial({
      color: 0xf2c888,
      depthWrite: false,
      transparent: true,
      opacity: 0.24,
      side: DoubleSide,
    }),
  );
  tile.rotation.x = -Math.PI / 2;
  tile.visible = false;
  scene.add(tile);

  const preview = new Mesh(
    new BufferGeometry(),
    new MeshBasicMaterial({ color: 0xfac87a, side: DoubleSide, depthTest: false }),
  );
  preview.renderOrder = 2;
  scene.add(preview);
  const chunks: Array<{ near: Mesh; far: Mesh; x: number; z: number }> = [];
  const roadMeshes = new Map<number, { group: Group; key: string }>();
  const ray = new Raycaster();
  const cursor = new Vector2();
  const dummy = new Object3D();
  const samples: number[] = [];
  let roads: Road[] = [];
  let activeLayer: Layer = "none";
  let latest: Scene | undefined;
  let traffic: Array<{ id: number; queued: number }> = [];
  let seed: number | undefined;
  let frame = 0;
  let uploads = 0;
  let last = 0;
  let buildings: InstancedMesh | undefined;
  let cars: InstancedMesh | undefined;
  let route: "overview" | "low" | undefined;
  let vehiclePaused = false;
  let liveCars: InstancedMesh | undefined;
  let vehiclePoses: Float32Array = new Float32Array();
  let previousPoses = new Map<number, { x: number; y: number; z: number }>();
  let poseTime = 0;
  let foliage: [InstancedMesh, InstancedMesh] | undefined;
  let firstRender = 0;
  let renderedRevision = -1;

  if (!benchmark) {
    const loader = new GLTFLoader();
    void Promise.all(
      ["sand", "cedar", "sage"].map((name) =>
        loader.loadAsync(`${import.meta.env.BASE_URL}region/coastal-${name}.glb`),
      ),
    )
      .then((models) => {
        for (const loaded of models) {
          loaded.scene.updateMatrixWorld(true);
          const parts: BufferGeometry[] = [];
          loaded.scene.traverse((object) => {
            if (!(object instanceof Mesh) || !(object.material instanceof MeshStandardMaterial))
              return;
            const geometry = (
              object.geometry.index ? object.geometry.toNonIndexed() : object.geometry.clone()
            ).applyMatrix4(object.matrixWorld);
            geometry.deleteAttribute("uv");
            const colors = new Float32Array(geometry.getAttribute("position").count * 3);
            for (let i = 0; i < colors.length; i += 3) object.material.color.toArray(colors, i);
            geometry.setAttribute("color", new BufferAttribute(colors, 3));
            parts.push(geometry);
            object.geometry.dispose();
            object.material.dispose();
          });
          const merged = mergeGeometries(parts);
          for (const part of parts) part.dispose();
          if (merged) houseKit.push(merged);
        }
        if (latest) {
          for (const parcel of latest.parcels) {
            if (parcel.zone === "homes") lots.delete(parcel.id);
          }
          for (const existing of lotGroup.children.slice()) {
            if (!lots.has(existing.userData.id)) existing.removeFromParent();
          }
          update(latest);
        }
      })
      .catch((error) => console.warn("Coastal kit unavailable", error));
  }

  function ground(x: number, z: number, divisions: number): Mesh {
    const geometry = new PlaneGeometry(CHUNK, CHUNK, divisions, divisions);
    geometry.rotateX(-Math.PI / 2);
    geometry.translate(x, 0, z);
    const positions = geometry.getAttribute("position");
    const colors: number[] = [];
    const color = new Color();
    for (let i = 0; i < positions.count; i++) {
      const elevation = height(seed!, { x: positions.getX(i), z: positions.getZ(i) });
      positions.setY(i, elevation);
      const greenery =
        0.95 + 0.08 * Math.sin(positions.getX(i) / 104) * Math.sin(positions.getZ(i) / 138);
      color
        .set(0xa1a185)
        .lerp(new Color(0x577f5e), Math.max(0, Math.min(1, elevation / 11)))
        .multiplyScalar(greenery + elevation / 120);
      colors.push(color.r, color.g, color.b);
    }
    geometry.setAttribute("color", new BufferAttribute(new Float32Array(colors), 3));
    geometry.computeVertexNormals();
    return new Mesh(geometry, terrainMaterial);
  }

  function kit(): void {
    if (buildings) {
      buildings.removeFromParent();
      buildings.dispose();
      buildings.geometry.dispose();
      (buildings.material as MeshLambertMaterial).dispose();
    }
    if (!benchmark) return;
    buildings = new InstancedMesh(new BoxGeometry(1, 1, 1), new MeshLambertMaterial(), 10_000);
    for (let i = 0; i < 10_000; i++) {
      const x = ((i % 100) - 50) * 73;
      const z = (Math.floor(i / 100) - 50) * 73;
      const meters = height(seed!, { x, z });
      const floors = meters < 3 ? 0 : 6 + hash(i * 7 + seed!) * 43;
      dummy.position.set(x, meters + floors / 2, z);
      dummy.scale.set(30, floors, 31);
      dummy.updateMatrix();
      buildings.setMatrixAt(i, dummy.matrix);
      buildings.setColorAt(i, new Color([0xeac994, 0xbe775a, 0xa7aca5, 0xcfd2b7][i % 4]));
    }
    uploads += 10_000 * 76;
    scene.add(buildings);
    if (!cars) {
      cars = new InstancedMesh(
        new BoxGeometry(5, 2, 3),
        new MeshLambertMaterial({ color: 0xe3a54c }),
        2_000,
      );
      cars.frustumCulled = false;
      scene.add(cars);
    }
  }

  function update(model: Scene): void {
    latest = model;
    if (seed !== model.seed) {
      for (const chunk of chunks) {
        chunk.near.geometry.dispose();
        chunk.far.geometry.dispose();
      }
      chunks.length = 0;
      terrain.clear();
      seed = model.seed;
      for (let z = -REGION / 2 + CHUNK / 2; z < REGION / 2; z += CHUNK) {
        for (let x = -REGION / 2 + CHUNK / 2; x < REGION / 2; x += CHUNK) {
          const near = ground(x, z, 24);
          const far = ground(x, z, 12);
          terrain.add(near, far);
          chunks.push({ near, far, x, z });
        }
      }
      kit();
      for (const item of roadMeshes.values()) disposeRoad(item.group);
      roadMeshes.clear();
      lots.clear();
      lotGroup.clear();
    }
    roads = model.roads;
    const changed = new Set(roads.map((road) => road.id));
    for (const [id, entry] of roadMeshes) {
      if (changed.has(id)) continue;
      disposeRoad(entry.group);
      roadMeshes.delete(id);
    }
    for (const road of roads) {
      const key = JSON.stringify(road);
      if (roadMeshes.get(road.id)?.key === key) continue;
      const previous = roadMeshes.get(road.id);
      if (previous) disposeRoad(previous.group);
      const group = new Group();
      const style = streets[road.kind];
      const shoulder = new Mesh(
        ribbon(road.points, style.width, road.bridge),
        style.sidewalks ? shoulderMaterial : roadMaterial,
      );
      const asphalt = new Mesh(
        ribbon(road.points, style.width * 0.72, road.bridge, 0.16),
        roadMaterial,
      );
      group.add(shoulder, asphalt);
      roadMeshes.set(road.id, { group, key });
      roadGroup.add(group);
    }

    const active = new Set<number>();
    for (const lot of [...model.parcels, ...model.facilities, ...model.stops]) {
      active.add(lot.id);
      const key = JSON.stringify(lot);
      if (lots.get(lot.id)?.key === key) continue;
      lots.get(lot.id)?.group.removeFromParent();
      const group = makeLot(lot);
      lotGroup.add(group);
      lots.set(lot.id, { group, key });
    }
    for (const [id, item] of lots) {
      if (active.has(id)) continue;
      item.group.removeFromParent();
      lots.delete(id);
    }
    if (!benchmark) drawFoliage(model);
    drawLayer();
  }

  function drawFoliage(model: Scene) {
    const footprint = new Set<string>();
    const mark = (x: number, z: number) =>
      footprint.add(`${Math.round(x / 21)},${Math.round(z / 21)}`);
    for (const lot of [...model.parcels, ...model.facilities]) mark(lot.x, lot.z);
    for (const road of model.roads) {
      for (let index = 1; index < road.points.length; index++) {
        const a = road.points[index - 1];
        const b = road.points[index];
        const pieces = Math.ceil(Math.hypot(a.x - b.x, a.z - b.z) / 10);
        for (let part = 0; part <= pieces; part++)
          mark(a.x + ((b.x - a.x) * part) / pieces, a.z + ((b.z - a.z) * part) / pieces);
      }
    }
    if (!foliage) {
      foliage = [
        new InstancedMesh(tree, material(0xffffff), 3_200),
        new InstancedMesh(trunk, material(0x675c46), 3_200),
      ];
      scene.add(...foliage);
    }
    const [canopy, stems] = foliage;
    let count = 0;
    for (let index = 0; index < 3_200; index++) {
      const local = index < 2_400;
      const range = local ? 2_050 : 7_800;
      const x = hash(index * 5 + model.seed) * range - range / 2 - (local ? 520 : 0);
      const z = hash(index * 7 + model.seed + 1) * range - range / 2 - (local ? 670 : 0);
      const y = height(model.seed, { x, z });
      if (y < 4 || footprint.has(`${Math.round(x / 21)},${Math.round(z / 21)}`)) continue;
      if (local && Math.sin(x / 85) * Math.sin(z / 93) < -0.25) continue;
      const size = 6 + hash(index * 11) * 11;
      dummy.rotation.set(0, 0, 0);
      dummy.position.set(x, y + size / 2, z);
      dummy.scale.set(1.5, size, 1.5);
      dummy.updateMatrix();
      stems.setMatrixAt(count, dummy.matrix);
      dummy.position.y = y + size * 0.91;
      dummy.scale.set(size * 0.36, size * 0.9, size * 0.36);
      dummy.updateMatrix();
      canopy.setMatrixAt(count, dummy.matrix);
      canopy.setColorAt(count, new Color([0x2f624d, 0x47775d, 0x6e875a, 0x51704d][index % 4]));
      count++;
    }
    canopy.count = stems.count = count;
    canopy.instanceMatrix.needsUpdate = stems.instanceMatrix.needsUpdate = true;
    canopy.instanceColor!.needsUpdate = true;
  }

  function drawLayer(): void {
    for (const object of overlay.children) {
      if (object instanceof InstancedMesh) object.dispose();
    }
    for (const object of transit.children) {
      if (object instanceof ThreeLine) {
        object.geometry.dispose();
        (object.material as LineBasicMaterial).dispose();
      }
    }
    overlay.clear();
    transit.clear();
    if (!latest || activeLayer === "none") return;
    const model = latest;
    if (activeLayer === "traffic") {
      const queued = new Map(traffic.map((row) => [row.id, row.queued]));
      for (const road of model.roads) {
        const length = queued.get(road.id);
        if (!length) continue;
        const points = road.points.map(
          (point, i) =>
            new Vector3(
              point.x,
              segmentElevation(model.seed, road.points, Math.max(1, i), i ? 1 : 0, road.bridge) + 4,
              point.z,
            ),
        );
        transit.add(
          new ThreeLine(
            new BufferGeometry().setFromPoints(points),
            new LineBasicMaterial({ color: length >= 5 ? 0xf45c55 : 0xffcb77, depthTest: false }),
          ),
        );
      }
      return;
    }
    if (activeLayer === "transit") {
      const router = planner({ roads: model.roads, nodes: [], nextId: 0 });
      for (const line of model.lines) {
        const stops = line.stops.map((id) => model.stops.find((stop) => stop.id === id)!);
        const edges = new Set<number>();
        for (let i = 1; i < stops.length; i++) {
          for (const id of router.route(stops[i - 1].roadId, stops[i].roadId) ?? []) edges.add(id);
        }
        for (const id of edges) {
          const road = router.roads.get(id)!;
          const points = road.points.map(
            (point, i) =>
              new Vector3(
                point.x,
                segmentElevation(model.seed, road.points, Math.max(1, i), i ? 1 : 0, road.bridge) +
                  5,
                point.z,
              ),
          );
          transit.add(
            new ThreeLine(
              new BufferGeometry().setFromPoints(points),
              new LineBasicMaterial({
                color: line.kind === "bus" ? 0xfbce71 : 0x99edf1,
                depthTest: false,
              }),
            ),
          );
        }
      }
      return;
    }
    const supplied = new Set(model.supplied);
    const markers = new InstancedMesh(box, material(0xffffff), model.parcels.length);
    for (let index = 0; index < model.parcels.length; index++) {
      const lot = model.parcels[index];
      const value =
        activeLayer === "utilities"
          ? Number(supplied.has(lot.id))
          : fields(model, lot)[activeLayer] / 100;
      const color =
        activeLayer === "utilities"
          ? new Color(value ? 0x54d7ba : 0xe46663)
          : new Color(0x6268e9).lerp(new Color(0xf5aa48), value);
      dummy.position.set(lot.x, height(model.seed, lot) + 1, lot.z);
      dummy.scale.set(33, 0.9, 33);
      dummy.updateMatrix();
      markers.setMatrixAt(index, dummy.matrix);
      markers.setColorAt(index, color);
    }
    overlay.add(markers);
  }

  function makeLot(lot: Parcel | Facility | Stop): Group {
    const group = new Group();
    group.userData.id = lot.id;
    group.position.set(lot.x, height(seed!, lot), lot.z);
    if (!("zone" in lot) && !("service" in lot)) {
      const pole = new Mesh(box, material(0xf1b967));
      pole.scale.set(4, 12, 4);
      pole.position.y = 6;
      group.add(pole);
      const sign = new Mesh(box, material(0x358783));
      sign.scale.set(12, 5, 8);
      sign.position.y = 12;
      group.add(sign);
      return group;
    }
    const dimensions = "zone" in lot ? zones[lot.zone] : { size: 10, color: 0x639f9d };
    group.rotation.y = "angle" in lot ? lot.angle : 0;
    const base = new Mesh(box, material(0xabb88b));
    base.scale.set(28, 0.35, 28);
    base.position.y = 0.6;
    group.add(base);
    if ("built" in lot && !lot.built) {
      base.material = material(dimensions.color);
      return group;
    }
    if ("zone" in lot && lot.zone === "homes" && houseKit.length) {
      const dwelling = new Mesh(houseKit[lot.id % houseKit.length], houseMaterial);
      dwelling.position.y = 0.8;
      group.add(dwelling);
      return group;
    }
    const floors = dimensions.size * (0.85 + hash(lot.id) * 0.3);
    const facade = new Mesh(box, material(dimensions.color));
    facade.scale.set(19, floors, 15);
    facade.position.y = floors / 2 + 0.8;
    group.add(facade);
    const top = new Mesh(
      dimensions.size < 14 && lot.id % 3 ? roof : box,
      material(lot.id % 2 ? 0x675549 : 0x6e8582),
    );
    top.position.y = floors + 1.7;
    top.scale.set(20, dimensions.size < 14 ? 4 : 2.4, 16);
    group.add(top);
    if (dimensions.size > 13) {
      for (let base = 4; base < floors - 1; base += 4) {
        const windows = new Mesh(box, material(0x355e63));
        windows.scale.set(19.3, 1.45, 15.2);
        windows.position.y = base;
        group.add(windows);
      }
    }
    return group;
  }

  function disposeRoad(group: Group): void {
    for (const mesh of group.children) (mesh as Mesh).geometry.dispose();
    group.removeFromParent();
  }

  function ribbon(points: Point[], width: number, bridge: boolean, offset = 0): BufferGeometry {
    const geometry = new BufferGeometry();
    if (seed === undefined || points.length < 2) return geometry;
    const positions: number[] = [];
    for (let k = 1; k < points.length; k++) {
      const a = points[k - 1];
      const b = points[k];
      const length = Math.hypot(a.x - b.x, a.z - b.z);
      if (length < 0.01) continue;
      const nx = ((b.z - a.z) * width) / length / 2;
      const nz = ((a.x - b.x) * width) / length / 2;
      const steps = Math.ceil(length / 10);
      const edge = (i: number, sign: number) => {
        const x = a.x + ((b.x - a.x) * i) / steps;
        const z = a.z + ((b.z - a.z) * i) / steps;
        return [
          x + sign * nx,
          segmentElevation(seed!, points, k, i / steps, bridge) + offset,
          z + sign * nz,
        ];
      };
      for (let i = 0; i < steps; i++) {
        const left = edge(i, 1);
        const right = edge(i, -1);
        const nextLeft = edge(i + 1, 1);
        const nextRight = edge(i + 1, -1);
        positions.push(...left, ...right, ...nextLeft, ...right, ...nextRight, ...nextLeft);
      }
    }
    geometry.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
    geometry.computeVertexNormals();
    uploads += positions.length * 8;
    return geometry;
  }

  function hit(event: PointerEvent): { point: Point; roadId?: number } | undefined {
    if (seed === undefined) return;
    const rect = canvas.getBoundingClientRect();
    cursor.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      (-(event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    ray.setFromCamera(cursor, camera);
    const hitEntity = ray.intersectObjects([roadGroup, lotGroup], true)[0];
    const lot = hitEntity?.object.parent?.userData.id as number | undefined;
    if (lot !== undefined)
      return { point: { x: hitEntity.point.x, z: hitEntity.point.z }, roadId: lot };
    const road = hitEntity;
    if (road) {
      const model = roads.find(
        (candidate) => roadMeshes.get(candidate.id)?.group === road.object.parent,
      );
      if (model) {
        const projected = model.points
          .slice(1)
          .map((b, i) => closestPoint(road.point, model.points[i], b).point)
          .sort(
            (a, b) =>
              Math.hypot(a.x - road.point.x, a.z - road.point.z) -
              Math.hypot(b.x - road.point.x, b.z - road.point.z),
          )[0];
        return { point: projected, roadId: model.id };
      }
    }
    const groundHit = ray.intersectObjects([
      water,
      ...chunks.map((chunk) => (chunk.near.visible ? chunk.near : chunk.far)),
    ])[0];
    if (groundHit) return { point: { x: groundHit.point.x, z: groundHit.point.z } };
  }

  function handleClick(event: PointerEvent): void {
    if (event.button !== 0) return;
    const picked = hit(event);
    if (picked) click(picked.point, picked.roadId);
  }
  function handleHover(event: PointerEvent): void {
    if (event.buttons || !hover) return;
    const picked = hit(event);
    hover(picked?.point, picked?.roadId);
  }
  function clearHover(): void {
    hover?.();
  }
  canvas.addEventListener("pointerup", handleClick);
  canvas.addEventListener("pointermove", handleHover);
  canvas.addEventListener("pointerleave", clearHover);
  const resize = new ResizeObserver(() => {
    const { clientWidth, clientHeight } = canvas;
    if (!clientWidth || !clientHeight) return;
    renderer.setSize(clientWidth, clientHeight, false);
    camera.aspect = clientWidth / clientHeight;
    camera.updateProjectionMatrix();
  });
  resize.observe(canvas);

  renderer.setAnimationLoop((time) => {
    if (last && samples.length < 2_400) samples.push(time - last);
    last = time;
    if (route && !vehiclePaused) {
      const angle = time / 3_000;
      controls.target.set(0, 18, 0);
      const distance = route === "overview" ? 5_000 : 1_650;
      camera.position.set(
        Math.cos(angle) * distance,
        route === "overview" ? 4_000 : 190,
        Math.sin(angle) * distance,
      );
    }
    controls.update();
    for (const chunk of chunks) {
      chunk.near.visible =
        Math.hypot(chunk.x - camera.position.x, chunk.z - camera.position.z) < 1_600 &&
        camera.position.y < 1_250;
      chunk.far.visible = !chunk.near.visible;
    }
    if (cars && seed !== undefined && !vehiclePaused) {
      for (let i = 0; i < cars.count; i++) {
        const x = ((time * (0.012 + (i % 5) * 0.006) + i * 79) % 7_600) - 3_800;
        const z = ((i % 90) - 45) * 81;
        dummy.position.set(x, Math.max(0, height(seed, { x, z })) + 1.5, z);
        dummy.scale.setScalar(1);
        dummy.updateMatrix();
        cars.setMatrixAt(i, dummy.matrix);
      }
      cars.instanceMatrix.needsUpdate = true;
      uploads += cars.count * 64;
    }
    if (!benchmark && liveCars && vehiclePoses.length && poseTime !== 0) {
      const fraction = Math.min(1, (performance.now() - poseTime) / 230);
      if (fraction === 1) poseTime = 0;
      for (let index = 0; index < liveCars.count; index++) {
        const part = index * 7;
        const x = vehiclePoses[part + 1];
        const y = vehiclePoses[part + 2];
        const z = vehiclePoses[part + 3];
        const prior = previousPoses.get(vehiclePoses[part]);
        const priorClose =
          prior && Math.hypot(prior.x - x, prior.z - z) < 450 ? prior : { x, y, z };
        dummy.position.set(
          priorClose.x + (x - priorClose.x) * fraction,
          priorClose.y + (y - priorClose.y) * fraction + 1.5,
          priorClose.z + (z - priorClose.z) * fraction,
        );
        dummy.rotation.set(0, vehiclePoses[part + 4], 0);
        dummy.scale.set(1, 1, vehiclePoses[part + 5] === 2 ? 2.25 : 1);
        dummy.updateMatrix();
        liveCars.setMatrixAt(index, dummy.matrix);
      }
      liveCars.instanceMatrix.needsUpdate = true;
      uploads += liveCars.count * 64;
    }
    if (actualBackend === "webgpu") renderer.info.reset();
    renderer.render(scene, camera);
    if (latest) renderedRevision = latest.revision;
    if (!firstRender && seed !== undefined) firstRender = performance.now() - started;
    frame++;
  });

  return {
    update,
    vehicles(poses: Float32Array) {
      if (benchmark) return;
      if (!liveCars) {
        liveCars = new InstancedMesh(new BoxGeometry(3, 2, 5), material(0xffffff), 250);
        liveCars.frustumCulled = false;
        scene.add(liveCars);
      }
      previousPoses = new Map();
      for (let i = 0; i < vehiclePoses.length; i += 7)
        previousPoses.set(vehiclePoses[i], {
          x: vehiclePoses[i + 1],
          y: vehiclePoses[i + 2],
          z: vehiclePoses[i + 3],
        });
      vehiclePoses = poses;
      poseTime = performance.now();
      liveCars.count = poses.length / 7;
      for (let i = 0; i < liveCars.count; i++)
        liveCars.setColorAt(i, new Color([0xd78e54, 0xd1c5a3, 0x50b3af][poses[i * 7 + 5]]));
      if (liveCars.instanceColor) liveCars.instanceColor.needsUpdate = true;
    },
    project(point: Point, elevation?: number) {
      camera.updateMatrixWorld(true);
      const projected = new Vector3(point.x, elevation ?? height(seed!, point), point.z).project(
        camera,
      );
      const rect = canvas.getBoundingClientRect();
      return {
        x: rect.left + ((projected.x + 1) * rect.width) / 2,
        y: rect.top + ((1 - projected.y) * rect.height) / 2,
      };
    },
    traffic(rows: Array<{ id: number; queued: number }>) {
      if (
        rows.length === traffic.length &&
        rows.every((row, i) => row.id === traffic[i].id && row.queued === traffic[i].queued)
      )
        return;
      traffic = rows;
      if (activeLayer === "traffic") drawLayer();
    },
    focusRoad(id: number) {
      const road = roads.find((road) => road.id === id);
      if (!road) return;
      this.cameraAt(road.points[Math.floor((road.points.length - 1) / 2)], "planning");
    },
    layer(value: Layer) {
      activeLayer = value;
      drawLayer();
    },
    tile(value?: string) {
      tile.visible = value !== undefined;
      if (value) {
        const [x, z] = value.split(",").map(Number);
        tile.position.set((x + 0.5) * TILE - REGION / 2, 37, (z + 0.5) * TILE - REGION / 2);
      }
    },
    preview(points: Point[], bridge: boolean, valid = true) {
      preview.material.color.set(valid ? 0xfac87a : 0xf4655e);
      preview.geometry.dispose();
      preview.geometry = ribbon(points, 12, bridge, 1.2);
    },
    overview(active: boolean) {
      grid.visible = active;
      controls.target.set(active ? 0 : -515, 8, active ? 0 : -700);
      camera.position.set(active ? 1700 : -245, active ? 6900 : 440, active ? 4760 : -115);
      controls.update();
    },
    cameraAt(target: Point, mode: "planning" | "low") {
      controls.target.set(target.x, 12, target.z);
      camera.position.set(target.x - 150, mode === "planning" ? 450 : 95, target.z + 385);
      controls.update();
    },
    benchmark(nextRoute: "overview" | "low", paused = false) {
      route = nextRoute;
      vehiclePaused = paused;
      samples.length = 0;
      uploads = 0;
      frame = 0;
    },
    measurements() {
      return {
        samples: [...samples],
        firstRender,
        renderedRevision,
        backend: actualBackend,
        frame,
        uploads,
        calls: renderer.info.render.calls,
        geometry: renderer.info.memory.geometries,
      };
    },
    dispose() {
      renderer.setAnimationLoop(null);
      resize.disconnect();
      controls.dispose();
      canvas.removeEventListener("pointerup", handleClick);
      canvas.removeEventListener("pointermove", handleHover);
      canvas.removeEventListener("pointerleave", clearHover);
      const geometry = new Set<BufferGeometry>();
      scene.traverse((object) => {
        if (object instanceof Mesh || object instanceof GridHelper) geometry.add(object.geometry);
      });
      for (const item of geometry) item.dispose();
      renderer.dispose();
    },
  };
}
