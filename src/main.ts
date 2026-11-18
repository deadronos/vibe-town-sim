import { Mesh, Renderer } from "./graphics.js";
import {
  createCity,
  id,
  land,
  N,
  noise,
  place,
  prices,
  createCommuteDistrict,
  stats,
  tick,
  zoned,
  type Build,
  type City,
} from "./sim.js";
import { openSave } from "./saves.ts";
import { world, model } from "./world.js";
import { icon } from "./icons.js";
const el = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector<T>(s)!;
document
  .querySelectorAll<HTMLElement>("[data-icon]")
  .forEach((e) => (e.innerHTML = icon(e.dataset.icon!)));
const map = el<HTMLCanvasElement>("#map"),
  dialog = el<HTMLDialogElement>("dialog");
const saves = openSave(() => localStorage);
let city = saves.city ?? createCity(),
  metrics = stats(city),
  speed = 1,
  paused = false,
  overlay = false,
  orbitMode = false,
  tool: Build | null = null,
  hover: { x: number; z: number } | null = null,
  inspected = -1;
const names = {
  road: "Road",
  residential: "Residential",
  commercial: "Commercial",
  industrial: "Industrial",
  park: "Park",
  power: "Wind power",
  water: "Water tower",
  bulldoze: "Bulldoze",
  empty: "Open land",
};
const money = (v: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(v);
const builds = Object.keys(prices) as Build[];
const undo: { city: City; month: number }[] = [];
function save() {
  el("#savestatus").textContent = saves.write(city);
}
let toastTimer = 0;
function toast(s: string) {
  el("#toast").textContent = s;
  el("#toast").classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el("#toast").classList.remove("show"), 2400);
}
function setup() {
  try {
    return new Renderer(map);
  } catch (e) {
    el("#toast").textContent = String(e);
    el("#toast").classList.add("show");
    throw e;
  }
}
const renderer = setup();
function thumbnails() {
  renderer.x = 0.5;
  renderer.z = 0.5;
  renderer.offset = -0.39;
  for (const [i, k] of builds.entries()) {
    const mesh = new Mesh();
    mesh.box(
      -0.04,
      -0.11,
      -0.04,
      1.08,
      0.11,
      1.08,
      k === "industrial" ? "c5b17a" : k === "commercial" ? "95b5b3" : "9fbc86",
    );
    if (k === "road") {
      mesh.box(0, 0.01, 0.17, 1, 0.03, 0.65, "737e79");
      for (const x of [0.08, 0.48, 0.84]) mesh.flat(x, 0.49, 0.15, 0.035, 0.05, "e4d7ab");
    } else if (k === "bulldoze") {
      mesh.box(0.18, 0.04, 0.22, 0.64, 0.18, 0.5, "4c5650");
      mesh.box(0.22, 0.21, 0.25, 0.52, 0.22, 0.42, "dca649");
      mesh.box(0.3, 0.42, 0.31, 0.25, 0.22, 0.29, "6c8988");
      mesh.box(0.28, 0.64, 0.29, 0.3, 0.04, 0.34, "e9b852");
      mesh.box(0.77, 0.04, 0.13, 0.09, 0.26, 0.7, "c69a4d");
    } else model(mesh, 0, 0, k, k === "commercial" ? 2 : 1);
    renderer.begin(92, 65, k === "power" ? 26 : k === "water" ? 34 : 43, [1, 1, 1], 2, true);
    const data = renderer.upload(mesh);
    renderer.draw(data);
    const img = new Image();
    img.alt = "";
    img.src = map.toDataURL();
    renderer.gl.deleteBuffer(data.buffer);
    const b = document.createElement("button");
    b.className = "tool";
    b.dataset.tool = k;
    b.innerHTML =
      "<kbd>" + (i + 1) + "</kbd><b>" + names[k] + "</b><small>" + money(prices[k]) + "</small>";
    b.prepend(img);
    b.onclick = () => select(tool === k ? null : k);
    el("#tools").append(b);
  }
}
thumbnails();
function resetCamera() {
  renderer.x = 18;
  renderer.z = 18;
  renderer.zoom = 1.08;
  renderer.pitch = 0.58;
  renderer.angle = 0.68;
  renderer.offset = 0.08;
}
resetCamera();
let scene: ReturnType<Renderer["upload"]>,
  dynamic = renderer.upload(new Mesh());
// Retain the original depth/ownership mesh throughout a demolition stroke so
// buildings exposed by the stroke cannot be erased through the first target.
let demolitionScene: typeof scene | null = null;
function refresh() {
  metrics = stats(city);
  const reuse = scene && scene !== demolitionScene ? scene.buffer : undefined;
  scene = renderer.upload(world(city, overlay), reuse);
  renderer.bakeShadows(scene);
  hud();
  save();
}
function hud() {
  el("#funds").textContent = money(city.funds);
  el("#pop").textContent = metrics.population.toLocaleString("en-US");
  el("#happy").textContent = metrics.happiness + "%";
  el("#date").textContent = new Date(Date.UTC(2030, city.month, 1)).toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
  el("#pause").innerHTML = icon(paused ? "play" : "pause");
  el("#pause").setAttribute("aria-label", paused ? "Resume simulation" : "Pause simulation");
  el("#speed").textContent = speed + "×";
  el("#demand").innerHTML = Object.entries(metrics.demand)
    .map(
      ([k, v], index) =>
        '<div class="meter"><span>' +
        names[k as Build] +
        '</span><span class="segments" aria-label="' +
        Math.round(v) +
        ' percent">' +
        Array.from(
          { length: 8 },
          (_, i) =>
            '<i style="background:' +
            (i < Math.round(v / 12.5) ? ["#759758", "#7299aa", "#c29e59"][index] : "#e1e6d9") +
            '"></i>',
        ).join("") +
        "</span></div>",
    )
    .join("");
  updateInspection();
}
function updateInspection() {
  const p = el("#tileinfo");
  p.hidden = inspected < 0;
  if (inspected < 0) return;
  const t = city.tiles[inspected];
  const status = zoned(t.kind)
    ? metrics.access[inspected] < 0
      ? "Needs an adjacent road"
      : metrics.service[inspected] === 0
        ? "Needs connected power and water"
        : metrics.service[inspected] < 1
          ? "Utility capacity limited"
          : "Road, water and power connected"
    : t.kind === "power" || t.kind === "water"
      ? metrics.access[inspected] < 0
        ? "Add an adjacent road"
        : "Serves up to 200 development levels"
      : t.kind === "empty"
        ? "Available for construction"
        : t.kind === "park"
          ? "Improves town happiness"
          : "Connects adjacent lots and utilities";
  let commute = "";
  if (metrics.workers[inspected]) {
    const workers = metrics.workers[inspected],
      matched = metrics.commute.matched[inspected];
    commute =
      matched === workers
        ? `${matched} workers commute to jobs.`
        : `${matched} of ${workers} employed. ${metrics.commute.hasReachableJobs[inspected] ? "Reachable jobs are full." : "No road to an active workplace."}`;
  } else if (metrics.positions[inspected]) {
    const jobs = metrics.positions[inspected],
      vacant = metrics.commute.vacancies[inspected];
    commute =
      `${jobs - vacant} of ${jobs} jobs filled.` +
      (vacant ? " Connect housing with available workers." : "");
  }
  p.innerHTML =
    "<b>" +
    names[t.kind] +
    (zoned(t.kind) ? " · Level " + t.level + "/3" : "") +
    "</b>" +
    status +
    (commute ? "<br>" + commute : "");
}
function select(k: Build | null) {
  orbitMode = false;
  el("#orbit").classList.remove("active");
  el("#orbit").setAttribute("aria-pressed", "false");
  tool = k;
  hover = null;
  inspected = -1;
  updateInspection();
  el("#toolhint").textContent = k
    ? names[k] + " · " + money(prices[k]) + " / tile"
    : "Select a tool to build";
  map.classList.toggle("build", !!k);
  document.querySelectorAll<HTMLButtonElement>(".tool").forEach((b) => {
    b.classList.toggle("active", b.dataset.tool === k);
    b.setAttribute("aria-pressed", String(b.dataset.tool === k));
  });
  el("#inspect").classList.toggle("active", !k);
}
refresh();
select(null);
function frame(time: number) {
  const w = map.clientWidth,
    h = map.clientHeight;
  renderer.begin(
    w,
    h,
    Math.max(17, Math.min(w / 39, h / 21)) * renderer.zoom,
    [0.79, 0.88, 0.9],
    Math.min(window.devicePixelRatio || 1, 2),
  );
  renderer.gl.uniform1i(
    renderer.demolitionLot,
    tool === "bulldoze" && hover ? id(hover.x, hover.z) + 1 : 0,
  );
  renderer.draw(scene);
  const m = new Mesh();
  for (const { home, workplace, path } of metrics.commute.routes) {
    const length = path.length - 1;
    if (!length) continue;
    const seed = noise(home, workplace),
      phase = (trafficTime * 0.0011 + seed * length * 2) % (length * 2);
    const returning = phase >= length,
      progress = returning ? length * 2 - phase : phase;
    const j = Math.min(length - 1, Math.floor(progress)),
      from = path[j],
      to = path[j + 1],
      fraction = progress - j;
    const dx = (to % N) - (from % N),
      dz = Math.floor(to / N) - Math.floor(from / N);
    const along = dx !== 0,
      lane = returning ? -0.1 : 0.1;
    const a = (from % N) + 0.45 + dx * fraction + dz * lane,
      b = Math.floor(from / N) + 0.45 + dz * fraction - dx * lane;
    m.box(
      a,
      0.034,
      b,
      along ? 0.18 : 0.089,
      0.073,
      along ? 0.089 : 0.18,
      ["eac789", "c66d52", "e8e6cf", "7498a2"][Math.floor(seed * 4)],
    );
    m.box(a + 0.025, 0.107, b + 0.018, along ? 0.09 : 0.055, 0.035, along ? 0.055 : 0.09, "b1c7bf");
  }
  if (hover && land(hover.x, hover.z)) {
    const { x, z } = hover;
    const col =
      tool &&
      (tool === "bulldoze"
        ? city.tiles[id(x, z)].kind === "empty"
        : city.tiles[id(x, z)].kind !== "empty")
        ? "d88162"
        : "fff1b3";
    m.flat(x, z, 1, 0.065, 0.052, col);
    m.flat(x, z + 0.935, 1, 0.065, 0.052, col);
    m.flat(x, z, 0.065, 1, 0.052, col);
    m.flat(x + 0.935, z, 0.065, 1, 0.052, col);
  }
  dynamic = renderer.upload(m, dynamic.buffer);
  renderer.draw(dynamic);
  if (!paused && !dialog.open && !pointer && !document.hidden) {
    const elapsed = Math.min(250, time - last) * speed;
    timer += elapsed;
    trafficTime += elapsed;
    if (timer >= 8500) {
      timer %= 8500;
      undo.length = 0;
      tick(city);
      refresh();
    }
  }
  last = time;
  requestAnimationFrame(frame);
}
let timer = 0,
  last = performance.now(),
  trafficTime = 0;
function zoom(f: number) {
  renderer.zoom = Math.max(0.55, Math.min(7, renderer.zoom * f));
}
function toggleLayers() {
  overlay = !overlay;
  el("#layers").classList.toggle("active", overlay);
  el("#layers").setAttribute("aria-pressed", String(overlay));
  scene = renderer.upload(world(city, overlay), scene?.buffer);
  renderer.bakeShadows(scene);
}
function togglePause() {
  paused = !paused;
  hud();
}
el("#pause").onclick = togglePause;
el("#speed").onclick = () => {
  speed = speed === 1 ? 2 : speed === 2 ? 4 : 1;
  hud();
};
el("#layers").onclick = toggleLayers;
el("#plus").onclick = () => zoom(1.2);
el("#minus").onclick = () => zoom(1 / 1.2);
el("#fit").onclick = resetCamera;
el("#rotate").onclick = () => (renderer.angle += Math.PI / 2);
el("#inspect").onclick = () => select(null);
function toggleOrbit() {
  const next = !orbitMode;
  select(null);
  orbitMode = next;
  el("#orbit").classList.toggle("active", next);
  el("#orbit").setAttribute("aria-pressed", String(next));
  el("#inspect").classList.toggle("active", !next);
  el("#toolhint").textContent = next ? "Drag map to orbit and tilt" : "Select a tool to build";
}
el("#orbit").onclick = toggleOrbit;
function rollback() {
  const entry = undo.pop();
  if (!entry) {
    toast("No construction to undo this month.");
    return;
  }
  city = entry.city;
  refresh();
  toast("Construction undone.");
}
function targetAt(x: number, y: number) {
  if (tool !== "bulldoze") return renderer.pick(x, y);
  const lot = renderer.visibleLot(x, y, demolitionScene ?? scene);
  return lot < 0 ? null : { x: lot % N, z: Math.floor(lot / N) };
}
function change(x: number, z: number) {
  if (!tool) return;
  const err = place(city, x, z, tool);
  if (err) {
    if (!pointer?.built) toast(err);
    return;
  }
  if (pointer) pointer.built = true;
  return true;
}
type Gesture = {
  id: number;
  startX: number;
  startY: number;
  x: number;
  y: number;
  pan: boolean;
  orbit: boolean;
  drag: boolean;
  built: boolean;
  before?: City;
  cell: { x: number; z: number } | null;
};
let pointer: Gesture | null = null;
map.oncontextmenu = (e) => e.preventDefault();
map.onpointerdown = (e) => {
  if (pointer) return;
  map.setPointerCapture(e.pointerId);
  const orbit = e.button === 2 || (orbitMode && !e.shiftKey && e.button === 0);
  const pan = orbit || e.button !== 0 || e.shiftKey || !tool;
  if (!pan && tool === "bulldoze") demolitionScene = scene;
  pointer = {
    id: e.pointerId,
    startX: e.clientX,
    startY: e.clientY,
    x: e.clientX,
    y: e.clientY,
    pan,
    orbit,
    drag: false,
    built: false,
    before: pan ? undefined : structuredClone(city),
    cell: targetAt(e.clientX, e.clientY),
  };
  if (!pan && pointer.cell && change(pointer.cell.x, pointer.cell.z)) refresh();
};
map.onpointermove = (e) => {
  hover = targetAt(e.clientX, e.clientY);
  if (!pointer || pointer.id !== e.pointerId) return;
  const p = pointer;
  p.drag ||= Math.hypot(e.clientX - p.startX, e.clientY - p.startY) > 4;
  if (p.orbit && p.drag) {
    renderer.angle -= (e.clientX - p.x) * 0.007;
    renderer.tilt((e.clientY - p.y) * 0.005);
    hover = null;
  } else if (p.pan && p.drag) {
    const old = renderer.groundAt(p.x, p.y),
      now = renderer.groundAt(e.clientX, e.clientY);
    if (old && now) {
      renderer.x = Math.max(-6, Math.min(N + 6, renderer.x + old.x - now.x));
      renderer.z = Math.max(-6, Math.min(N + 6, renderer.z + old.z - now.z));
    }
  } else if (!p.pan && tool === "bulldoze") {
    if (hover && (hover.x !== p.cell?.x || hover.z !== p.cell?.z) && change(hover.x, hover.z))
      refresh();
    p.cell = hover;
  } else if (!p.pan && (!hover || !p.cell)) {
    p.cell = hover;
    if (hover && change(hover.x, hover.z)) refresh();
  } else if (!p.pan && hover && p.cell && (hover.x !== p.cell.x || hover.z !== p.cell.z)) {
    let { x, z } = p.cell;
    const dx = hover.x - x,
      dz = hover.z - z;
    const steps = Math.abs(dx) + Math.abs(dz);
    let changed = false;
    for (let n = 1; n <= steps; n++) {
      if (
        x !== hover.x &&
        (z === hover.z || Math.abs((x - p.cell.x) * dz) <= Math.abs((z - p.cell.z) * dx))
      )
        x += Math.sign(dx);
      else z += Math.sign(dz);
      if (change(x, z)) changed = true;
    }
    if (changed) refresh();
    p.cell = hover;
  }
  p.x = e.clientX;
  p.y = e.clientY;
};
function finish(e: PointerEvent) {
  if (pointer?.id !== e.pointerId) return;
  const p = pointer;
  if (p.built && p.before) {
    undo.push({ city: p.before, month: city.month });
    if (undo.length > 15) undo.shift();
  }
  if (e.type === "pointerup" && p.pan && !p.orbit && !p.drag && !tool) {
    inspected = renderer.visibleLot(e.clientX, e.clientY, scene);
    updateInspection();
  }
  if (demolitionScene && demolitionScene !== scene)
    renderer.gl.deleteBuffer(demolitionScene.buffer);
  demolitionScene = null;
  pointer = null;
}
map.onpointerup = finish;
map.onpointercancel = finish;
map.onpointerleave = () => (hover = null);
map.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    zoom(Math.exp(-e.deltaY * 0.0015));
  },
  { passive: false },
);
function modal(title: string, html: string) {
  el("h2").textContent = title;
  el("#dialogbody").innerHTML = html;
  if (!dialog.open) dialog.showModal();
}
el("#close").onclick = () => dialog.close();
function budget() {
  modal(
    "City budget",
    '<div class="row">Treasury<b>' +
      money(city.funds) +
      '</b></div><div class="row">Monthly tax revenue<b>' +
      money(metrics.income) +
      '</b></div><div class="row">Roads, parks & utilities<b>−' +
      money(metrics.upkeep) +
      '</b></div><div class="row">Monthly balance<b>' +
      money(metrics.net) +
      '</b></div><div class="row">Workers with reachable jobs<b>' +
      metrics.commute.employed +
      " / " +
      metrics.workers.reduce((a, b) => a + b, 0) +
      '</b></div><div class="row">Employment tax included<b id="jobtax">' +
      money(metrics.employmentTax) +
      '</b></div><label class="row" for="tax">Tax rate<b id="rate">' +
      city.tax +
      '%</b></label><input type="range" id="tax" min="3" max="18" value="' +
      city.tax +
      '"><p>Higher taxes raise revenue and reduce happiness. At 17% or above, development can decline.</p>',
  );
  el<HTMLInputElement>("#tax").oninput = (e) => {
    city.tax = Number((e.target as HTMLInputElement).value);
    metrics = stats(city);
    el("#rate").textContent = city.tax + "%";
    const vals = el("#dialogbody").querySelectorAll("div b");
    vals[1].textContent = money(metrics.income);
    vals[3].textContent = money(metrics.net);
    el("#jobtax").textContent = money(metrics.employmentTax);
    undo.length = 0;
    hud();
    save();
  };
}
el("#budget").onclick = budget;
function guide() {
  modal(
    "Town guide",
    "<p>Choose a construction tool, then click or drag across land. Extend a continuous road from a wind turbine and water tower. Homes, shops and factories grow beside that road as months pass.</p><p>Zone demand shows which development the town can support. Homes supply workers, businesses create jobs, and parks improve happiness. Click Treasury to adjust taxes.</p><p>Use the pointer to inspect a tile or drag to pan. Shift-drag to pan while building. Right-drag to orbit and tilt, or select Orbit (O) and drag with a finger or mouse. Use 1–8 for tools, Esc to deselect, R to rotate, L for zone colors and Space to pause.</p>",
  );
}
el("#demand-help").onclick = guide;
function recovery() {
  modal(
    "Original save protected",
    '<p>This browser has a town that this version cannot open. You can play a temporary town while the original stays in storage.</p><button class="action" id="export">Download original save</button><button class="action" id="replacesave">Replace original with current town…</button>',
  );
  el("#export").onclick = () => {
    const url = URL.createObjectURL(
      new Blob([saves.original ?? ""], { type: "application/octet-stream" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "juniper-bay-original.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  el("#replacesave").onclick = () => {
    modal(
      "Replace original save?",
      '<p>This permanently replaces the protected original with your current town.</p><button class="action" id="confirm-save">Replace original save</button>',
    );
    el("#confirm-save").onclick = () => {
      el("#savestatus").textContent = saves.write(city, true);
      dialog.close();
    };
  };
}
el("#menu").onclick = () => {
  modal(
    "Town menu",
    '<button class="action" id="guide">Town guide</button><button class="action" id="undo">Undo construction this month</button><button class="action" id="fresh">Start an empty island</button><button class="action" id="district">Try the commute district</button><button class="action" id="starter">Restore starter town</button>' +
      (saves.protectedSave
        ? '<button class="action" id="recover">Recover original save</button>'
        : ""),
  );
  if (saves.protectedSave) el("#recover").onclick = recovery;
  el("#guide").onclick = guide;
  el("#undo").onclick = () => {
    dialog.close();
    rollback();
  };
  for (const [s, makeTown, description] of [
    ["#fresh", () => createCity(false), "an empty island and $18,000."],
    [
      "#district",
      createCommuteDistrict,
      "two serviced streets. Build a road across the one-tile gap to connect homes to jobs.",
    ],
    ["#starter", () => createCity(true), "the starter town."],
  ] as const)
    el(s).onclick = () => {
      modal(
        "Replace this town?",
        "<p>Your current town will be replaced with " +
          description +
          '</p><button class="action" id="replace">Replace town</button>',
      );
      el("#replace").onclick = () => {
        city = makeTown();
        timer = 0;
        undo.length = 0;
        select(null);
        resetCamera();
        refresh();
        dialog.close();
      };
    };
};
window.addEventListener("keydown", (e) => {
  if (dialog.open || e.altKey) return;
  const k = e.key.toLowerCase();
  if ((e.metaKey || e.ctrlKey) && k === "z") {
    e.preventDefault();
    rollback();
    return;
  }
  if (e.metaKey || e.ctrlKey) return;
  if (k === " " && !(e.target instanceof HTMLButtonElement)) {
    e.preventDefault();
    togglePause();
  } else if (k === "escape" || k === "i") select(null);
  else if (k === "l") toggleLayers();
  else if (k === "o") toggleOrbit();
  else if (k === "r") renderer.angle += Math.PI / 2;
  else if (k === "+" || k === "=") zoom(1.2);
  else if (k === "-") zoom(1 / 1.2);
  else if (/^[1-8]$/.test(k)) select(builds[Number(k) - 1]);
});
map.addEventListener("webglcontextlost", (e) => {
  e.preventDefault();
  paused = true;
  toast("Graphics interrupted. Your town is saved.");
});
map.addEventListener("webglcontextrestored", () => location.reload());
requestAnimationFrame(frame);

if (saves.protectedSave) recovery();
