import {
  AmbientLight,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  DirectionalLight,
  DoubleSide,
  GridHelper,
  Group,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  Raycaster,
  Scene as ThreeScene,
  Vector2,
  WebGLRenderer,
} from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { CHUNK, hash, height, REGION, type Point } from "../core/world/terrain.ts";
import { closestPoint, roadElevation, streets, type Road } from "../core/network/roads.ts";
import type { Scene } from "../worker/protocol.ts";

const terrainMaterial = new MeshLambertMaterial({ vertexColors: true });
const roadMaterial = new MeshLambertMaterial({ color: 0x4b5052, side: DoubleSide });
const shoulderMaterial = new MeshLambertMaterial({ color: 0xb1a799, side: DoubleSide });

export function createViewport(
  canvas: HTMLCanvasElement,
  click: (point: Point, roadId?: number) => void,
  benchmark: boolean,
) {
  const renderer = new WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  const scene = new ThreeScene();
  scene.background = new Color(0xa3c1c2);
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
  controls.target.set(-680, 8, -665);
  camera.position.set(-120, 950, 290);
  controls.update();
  const terrain = new Group();
  const roadGroup = new Group();
  scene.add(terrain, roadGroup);
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
  let seed: number | undefined;
  let frame = 0;
  let uploads = 0;
  let last = 0;
  let buildings: InstancedMesh | undefined;
  let cars: InstancedMesh | undefined;
  let route: "overview" | "low" | undefined;
  let vehiclePaused = false;

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
      color.set(elevation < 5 ? 0xa3a184 : 0x698c6d).multiplyScalar(0.92 + elevation / 120);
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
          const near = ground(x, z, 20);
          const far = ground(x, z, 5);
          terrain.add(near, far);
          chunks.push({ near, far, x, z });
        }
      }
      kit();
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
        return [x + sign * nx, roadElevation(seed!, { x, z }, bridge) + offset, z + sign * nz];
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
    const road = ray.intersectObjects(roadGroup.children, true)[0];
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
  canvas.addEventListener("pointerup", handleClick);
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
    if (route) {
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
    renderer.render(scene, camera);
    frame++;
  });

  return {
    update,
    preview(points: Point[], bridge: boolean) {
      preview.geometry.dispose();
      preview.geometry = ribbon(points, 12, bridge, 1.2);
    },
    overview(active: boolean) {
      grid.visible = active;
      controls.target.set(active ? 0 : -680, 8, active ? 0 : -665);
      camera.position.set(active ? 3400 : -120, active ? 5900 : 950, active ? 3800 : 290);
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
      const geometry = new Set<BufferGeometry>();
      scene.traverse((object) => {
        if (object instanceof Mesh || object instanceof GridHelper) geometry.add(object.geometry);
      });
      for (const item of geometry) item.dispose();
      renderer.dispose();
    },
  };
}
