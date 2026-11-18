import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { distance, landId, mix, type Point } from "../core/world/terrain.ts";
import {
  BRIDGE_COST,
  roadLength,
  segmentElevation,
  streets,
  type Road,
  type RoadClass,
} from "../core/network/roads.ts";
import {
  services,
  zones,
  type Facility,
  type Parcel,
  type Service,
  type Side,
  type Zone,
} from "../core/sim/development.ts";
import { PROTOCOL, type Panel, type Reply, type Request } from "../worker/protocol.ts";
import { readCheckpoint, writeCheckpoint } from "../storage/regional.ts";
import type { Stop } from "../core/sim/region.ts";
import type { Command } from "../core/sim/city.ts";
import { LandPanel, LayersPanel, TransitPanel } from "./region-panel.tsx";
import { createViewport, type Layer } from "../view/regional.ts";
import "./regional.css";

type WithoutEnvelope<T> = T extends unknown ? Omit<T, "version" | "id"> : never;
const worker = new Worker(new URL("../worker/regional.ts", import.meta.url), { type: "module" });
const params = new URLSearchParams(location.search);
let panel: Panel = {
  seed: 7,
  tick: 0,
  cash: 0,
  revision: 0,
  roadCount: 0,
  owned: [],
  houses: 0,
  population: 0,
  economy: null,
  region: null,
  debt: 0,
  refinancing: false,
};
const listeners = new Set<() => void>();
const pending = new Map<number, (reply: Reply) => void>();
let viewport: Awaited<ReturnType<typeof createViewport>> | undefined;
let lastScene: Extract<Reply, { kind: "scene" }>["scene"] | undefined;
let nextId = 1;
let poses: Float32Array | undefined;

worker.onmessage = ({ data }: MessageEvent<Reply>) => {
  if (data.version !== PROTOCOL) return;
  if (data.kind === "panel") {
    panel = data.panel;
    viewport?.traffic(panel.economy?.roadQueues ?? []);
    for (const listener of listeners) listener();
  } else if (data.kind === "scene") {
    lastScene = data.scene;
    viewport?.update(data.scene);
  } else if (data.kind === "vehicles") {
    poses = data.poses;
    viewport?.vehicles(poses);
  } else {
    pending.get(data.id)?.(data);
    pending.delete(data.id);
  }
};

function send(request: WithoutEnvelope<Request>): Promise<Reply> {
  const id = nextId++;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    worker.postMessage({ ...request, id, version: PROTOCOL });
  });
}

function subscribe(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  return () => listeners.delete(onStoreChange);
}

function download(value: unknown): void {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "vibe-town-regional.json";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function App() {
  const city = useSyncExternalStore(subscribe, () => panel);
  const [tool, setTool] = useState<
    | "inspect"
    | "straight"
    | "curve"
    | "zone"
    | "facility"
    | "demolish"
    | "land"
    | "transit"
    | "layers"
  >("inspect");
  const [road, setRoad] = useState<RoadClass>("street");
  const [bridge, setBridge] = useState(false);
  const [anchor, setAnchor] = useState<Point[]>([]);
  const [selection, setSelection] = useState<Road | Parcel | Facility | Stop>();
  const [tile, setTile] = useState("1,1");
  const [layer, setLayer] = useState<Layer>("none");
  const [detail, setDetail] = useState<Extract<Reply, { kind: "selection" }>>();
  const [economyOpen, setEconomyOpen] = useState(false);
  const [taxRate, setTaxRate] = useState(9);
  const [zone, setZone] = useState<Zone>("homes");
  const [side, setSide] = useState<Side>("both");
  const [brush, setBrush] = useState(false);
  const [service, setService] = useState<Service>("power");
  const [notice, setNotice] = useState("Choose a building, road or tool to begin.");
  const [opening, setOpening] = useState("7");
  const [previewData, setPreviewData] = useState<{ length: number; grade: number; cost: number }>();
  const onHover = useRef<(point?: Point, id?: number) => void>(() => {});
  const [speed, setSpeed] = useState<0 | 1 | 4 | 16>(0);
  const [overview, setOverview] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const onMap = useRef<(point: Point, roadId?: number) => void>(() => {});

  async function request(request: WithoutEnvelope<Request>, success: string) {
    const reply = await send(request);
    if (reply.kind !== "ack") return false;
    setNotice(reply.result.ok ? success : reply.result.reason);
    return reply.result.ok;
  }

  function run(command: Command, message: string) {
    return request({ kind: "command", command }, message);
  }

  onMap.current = async (point, roadId) => {
    if (tool === "land") {
      const picked = landId(point);
      setTile(picked);
      viewport?.tile(picked);
      return;
    }
    if (tool === "transit") {
      await run({ kind: "stop", at: point }, "Transit stop built");
      return;
    }
    if (tool === "layers" && roadId === undefined) return;
    if (tool === "inspect" || tool === "layers") {
      if (roadId === undefined) {
        setSelection(undefined);
        return;
      }
      const reply = await send({ kind: "select", roadId });
      if (reply.kind === "selection") {
        setSelection(reply.entity);
        setDetail(reply);
      }
      return;
    }
    if (tool === "zone") {
      if (roadId === undefined) return setNotice("Choose a road to zone its frontage");
      await request(
        {
          kind: "command",
          command: { kind: "zone", roadId, zone, side, brush: brush ? point : undefined },
        },
        "Frontage zoned",
      );
      return;
    }
    if (tool === "facility") {
      await request(
        { kind: "command", command: { kind: "facility", at: point, service } },
        "Facility built",
      );
      return;
    }
    if (tool === "demolish") {
      if (roadId !== undefined)
        await request({ kind: "command", command: { kind: "demolish", id: roadId } }, "Demolished");
      return;
    }
    const vertices = [...anchor, point];
    const complete = vertices.length === (tool === "curve" ? 3 : 2);
    if (!complete) {
      setAnchor(vertices);
      viewport?.preview(vertices, bridge);
      return;
    }
    const points = gesture(vertices);
    if (
      await request(
        { kind: "command", command: { kind: "road", points, road, bridge } },
        "Road built",
      )
    ) {
      setAnchor([point]);
    }
    viewport?.preview([], bridge);
  };

  onHover.current = (point, id) => {
    if (canvas.current) canvas.current.style.cursor = id === undefined ? "crosshair" : "pointer";
    if (!anchor.length || (tool !== "straight" && tool !== "curve")) return;
    if (!point) {
      viewport?.preview([], bridge);
      setPreviewData(undefined);
      return;
    }
    const points = gesture([...anchor, point]);
    const length = roadLength(points);
    if (length < 1) return;
    let grade = 0;
    for (let i = 1; i < points.length; i++) {
      const meters = distance(points[i - 1], points[i]);
      const divisions = Math.max(1, Math.ceil(meters / 12));
      for (let j = 1; j <= divisions; j++) {
        grade = Math.max(
          grade,
          Math.abs(
            segmentElevation(city.seed, points, i, j / divisions, bridge) -
              segmentElevation(city.seed, points, i, (j - 1) / divisions, bridge),
          ) /
            (meters / divisions),
        );
      }
    }
    viewport?.preview(points, bridge, grade <= 0.19);
    setPreviewData({
      length,
      grade,
      cost: Math.round(length * (streets[road].cost + (bridge ? BRIDGE_COST : 0))),
    });
  };

  function gesture(vertices: Point[]): Point[] {
    if (tool !== "curve" || vertices.length < 3) return vertices;
    return Array.from({ length: 13 }, (_, i) => {
      const t = i / 12;
      return mix(mix(vertices[0], vertices[1], t), mix(vertices[1], vertices[2], t), t);
    });
  }

  useEffect(() => {
    const benchmark = params.has("benchmark");
    let disposed = false;
    void createViewport(
      canvas.current!,
      (point, roadId) => onMap.current(point, roadId),
      benchmark,
      benchmark && params.get("backend") === "webgpu" ? "webgpu" : "webgl",
      (point, id) => onHover.current(point, id),
    )
      .then((view) => {
        if (disposed) {
          view.dispose();
          return;
        }
        viewport = view;
        if (lastScene) view.update(lastScene);
        if (poses) view.vehicles(poses);
        view.traffic(panel.economy?.roadQueues ?? []);
        if (benchmark) Object.assign(window, { regionalBenchmark: view });
        if (params.has("qa"))
          Object.assign(window, { regionalQA: { view, send, tick: () => panel.tick } });
      })
      .catch((error) => {
        if (!disposed) setNotice(`Viewport unavailable. ${(error as Error).message}`);
      });
    void (async () => {
      if (!benchmark && !params.has("seed") && !params.has("empty") && !params.has("qa")) {
        try {
          const saved = await readCheckpoint();
          if (saved && !disposed) {
            const reply = await send({ kind: "restore", checkpoint: saved });
            if (reply.kind === "ack" && reply.result.ok) {
              setNotice("Regional checkpoint restored");
              return;
            }
          }
        } catch (error) {
          setNotice(`Saved checkpoint could not be opened. ${(error as Error).message}`);
        }
      }
      if (!disposed)
        await send({
          kind: "initialize",
          seed: Number(params.get("seed") ?? 7),
          empty: benchmark || params.has("empty"),
        });
    })();
    return () => {
      disposed = true;
      viewport?.dispose();
    };
  }, []);

  function choose(next: typeof tool) {
    if (next === "land") {
      viewport?.overview(true);
      viewport?.tile(tile);
      setOverview(true);
    } else {
      viewport?.tile();
    }
    if (next === "transit") {
      setLayer("transit");
      viewport?.layer("transit");
    } else if (next !== "layers") {
      setLayer("none");
      viewport?.layer("none");
    }
    setTool(next);
    setEconomyOpen(false);
    setSelection(undefined);
    setAnchor([]);
    setPreviewData(undefined);
    viewport?.preview([], bridge);
  }

  async function save(exportFile: boolean) {
    try {
      const reply = await send({ kind: "checkpoint" });
      if (reply.kind !== "checkpoint") return;
      if (exportFile) download(reply.checkpoint);
      else await writeCheckpoint(reply.checkpoint);
      setNotice(exportFile ? "Checkpoint exported" : "Checkpoint saved");
    } catch (error) {
      setNotice((error as Error).message);
    }
  }

  async function load(file?: File) {
    try {
      const checkpoint: unknown = file ? JSON.parse(await file.text()) : await readCheckpoint();
      if (checkpoint === undefined) {
        setNotice("No regional checkpoint yet");
        return;
      }
      if (await request({ kind: "restore", checkpoint }, "Checkpoint loaded")) {
        setSelection(undefined);
        choose("inspect");
      }
    } catch (error) {
      setNotice((error as Error).message);
    }
  }

  const stats = city.economy;
  const roadSelection = selection && "points" in selection ? selection : undefined;
  const year = 1 + Math.floor(city.tick / 360);
  const day = 1 + (city.tick % 360);
  return (
    <div
      className="city-shell"
      onKeyDown={(event) => {
        if (event.key === "Escape") choose("inspect");
      }}
    >
      <canvas ref={canvas} aria-label="Regional city map" tabIndex={0} />
      <header className="hud">
        <a className="wordmark" href="./">
          VIBE <strong>TOWN</strong>
        </a>
        <div>
          <small>REGION</small>
          <strong>{city.seed === 7 ? "Juniper Reach" : "Cedar Crossing"}</strong>
        </div>
        <div>
          <small>TREASURY</small>
          <strong>
            {city.cash.toLocaleString("en-US", {
              style: "currency",
              currency: "USD",
              maximumFractionDigits: 0,
            })}
          </strong>
        </div>
        <div>
          <small>CALENDAR</small>
          <strong>
            Year {year} · Day {day}
          </strong>
        </div>
        <nav aria-label="Simulation speed">
          {([0, 1, 4, 16] as const).map((value) => (
            <button
              key={value}
              aria-pressed={speed === value}
              onClick={async () => {
                if (
                  await request(
                    { kind: "speed", speed: value },
                    value ? "Simulation running" : "Simulation paused",
                  )
                )
                  setSpeed(value);
              }}
            >
              {value ? `${value}×` : "Pause"}
            </button>
          ))}
        </nav>
      </header>
      <aside className="inspector">
        <small>
          {economyOpen ? "CITY ECONOMY" : selection ? "NETWORK INSPECTOR" : "REGIONAL PLANNING"}
        </small>
        <h1>
          {economyOpen
            ? "Demand and budget"
            : selection
              ? `Address ${selection.id}`
              : tool === "inspect"
                ? "City overview"
                : {
                    straight: "Build roads",
                    curve: "Build curves",
                    zone: "Zone frontage",
                    facility: "Public works",
                    demolish: "Demolish",
                    land: "Land and districts",
                    transit: "Transit network",
                    layers: "Map layers",
                  }[tool]}
        </h1>
        {economyOpen && stats ? (
          <>
            <dl>
              <dt>Jobs staffed</dt>
              <dd>
                {stats.staff} / {stats.jobs}
              </dd>
              <dt>Reachable local jobs</dt>
              <dd>{stats.reachableJobs}</dd>
              <dt>Household purchasing power</dt>
              <dd>{stats.affordability}%</dd>
              <dt>Vacant housing lots</dt>
              <dd>{stats.housingVacancies}</dd>
              <dt>Household workers</dt>
              <dd>{stats.workers}</dd>
              <dt>Household savings</dt>
              <dd>${stats.savings.toLocaleString()}</dd>
              <dt>Undeveloped lots</dt>
              <dd>{stats.vacancies}</dd>
              <dt>Goods sold last month</dt>
              <dd>{stats.lastSales}</dd>
              <dt>Deliveries received</dt>
              <dd>{stats.shipments}</dd>
              <dt>Waiting for roads</dt>
              <dd>{stats.queued}</dd>
              <dt>Canceled trips</dt>
              <dd>{stats.lost}</dd>
              <dt>Booked income</dt>
              <dd>${stats.receipts.toLocaleString()}</dd>
              <dt>Booked spending</dt>
              <dd>${stats.expenses.toLocaleString()}</dd>
            </dl>
            <label>
              Tax rate{" "}
              <input
                type="range"
                min="0"
                max="30"
                value={taxRate}
                onChange={(event) => setTaxRate(Number(event.target.value))}
              />{" "}
              {taxRate}%
            </label>
            <p>
              Projected monthly tax $
              {
                "{Math.floor(stats.residents * taxRate / 5 + stats.jobs * taxRate / 3).toLocaleString()}"
              }{" "}
              (before affordability)
            </p>
            <button
              onClick={() =>
                void request(
                  { kind: "command", command: { kind: "tax", rate: taxRate } },
                  "Tax rate applied",
                )
              }
            >
              Apply taxes
            </button>
            {city.debt > 0 && <p>Recovery loan balance ${"{city.debt.toLocaleString()}"}</p>}
            {city.cash <= 12_000 && !city.refinancing && (
              <button onClick={() => void run({ kind: "refinance" }, "Recovery loan issued")}>
                Take a $40,000 recovery loan
              </button>
            )}
            <details>
              <summary>Recent ledger</summary>
              <ul>
                {stats.ledger.map((posting, i) => (
                  <li key={i}>
                    Day {posting.tick} · {posting.purpose} · ${posting.amount}
                  </li>
                ))}
              </ul>
            </details>
          </>
        ) : tool === "land" && city.region ? (
          <LandPanel seed={city.seed} owned={city.owned} tile={tile} data={city.region} run={run} />
        ) : tool === "transit" && city.region ? (
          <TransitPanel data={city.region} run={run} />
        ) : tool === "layers" && city.region ? (
          <LayersPanel
            data={city.region}
            layer={layer}
            traffic={stats?.roadQueues ?? []}
            focusRoad={(id) => viewport?.focusRoad(id)}
            setLayer={(value) => {
              setLayer(value);
              viewport?.layer(value);
            }}
          />
        ) : roadSelection && tool === "inspect" ? (
          <>
            <dl>
              <dt>Class</dt>
              <dd>{roadSelection.kind}</dd>
              <dt>Length</dt>
              <dd>{Math.round(roadLength(roadSelection.points))} m</dd>
              <dt>Sidewalks</dt>
              <dd>{streets[roadSelection.kind].sidewalks ? "Yes" : "No"}</dd>
              <dt>Queued trips</dt>
              <dd>{detail?.traffic?.queued ?? 0}</dd>
              <dt>Trips admitted today</dt>
              <dd>{detail?.traffic?.admitted ?? 0}</dd>
              <dt>Water crossing</dt>
              <dd>{roadSelection.bridge ? "Bridge" : "None"}</dd>
            </dl>
            <label>
              Road class{" "}
              <select
                value={roadSelection.kind}
                onChange={async (event) => {
                  const road = event.target.value as RoadClass;
                  if (
                    await request(
                      {
                        kind: "command",
                        command: { kind: "upgrade", roadId: roadSelection.id, road },
                      },
                      "Road class updated",
                    )
                  ) {
                    setSelection({ ...roadSelection, kind: road });
                  }
                }}
              >
                {Object.keys(streets).map((kind) => (
                  <option key={kind}>{kind}</option>
                ))}
              </select>
            </label>
            {roadSelection.kind === "highway" && (
              <button
                onClick={() =>
                  void request(
                    {
                      kind: "command",
                      command: { kind: "gateway", roadId: roadSelection.id },
                    },
                    "Outside connection enabled",
                  )
                }
              >
                Connect to region
              </button>
            )}
          </>
        ) : selection && !("points" in selection) && tool === "inspect" ? (
          <dl>
            <dt>Use</dt>
            <dd>
              {"zone" in selection
                ? selection.zone
                : "service" in selection
                  ? selection.service
                  : "Transit stop"}
            </dd>
            <dt>Road</dt>
            <dd>{selection.roadId}</dd>
            {detail?.home && (
              <>
                <dt>Residents</dt>
                <dd>{detail.home.residents}</dd>
                <dt>Workers</dt>
                <dd>{detail.home.workers}</dd>
                <dt>Savings</dt>
                <dd>${detail.home.money}</dd>
              </>
            )}
            {detail?.firm && (
              <>
                <dt>Staff</dt>
                <dd>
                  {detail.firm.staff} / {detail.firm.jobs}
                </dd>
                <dt>Inventory</dt>
                <dd>{detail.firm.inventory}</dd>
                <dt>Cash</dt>
                <dd>${detail.firm.money}</dd>
              </>
            )}
            {"built" in selection && (
              <>
                <dt>Developed</dt>
                <dd>{selection.built ? "Yes" : "Awaiting development"}</dd>
              </>
            )}
          </dl>
        ) : tool === "inspect" ? (
          <dl>
            <dt>Owned land</dt>
            <dd>{city.owned.length * 4} km²</dd>
            <dt>Road segments</dt>
            <dd>{city.roadCount}</dd>
            <dt>Buildings</dt>
            <dd>{city.houses}</dd>
            <dt>Residents</dt>
            <dd>{city.population}</dd>
          </dl>
        ) : tool === "zone" ? (
          <>
            <label>
              Zone{" "}
              <select value={zone} onChange={(event) => setZone(event.target.value as Zone)}>
                {Object.keys(zones).map((kind) => (
                  <option key={kind}>{kind}</option>
                ))}
              </select>
            </label>
            <label>
              Side{" "}
              <select value={side} onChange={(event) => setSide(event.target.value as Side)}>
                <option value="both">Both sides</option>
                <option value="left">Left</option>
                <option value="right">Right</option>
              </select>
            </label>
            <label>
              <input
                type="checkbox"
                checked={brush}
                onChange={(event) => setBrush(event.target.checked)}
              />{" "}
              Brush near the pointer
            </label>
            <p>Click a road to zone its frontage.</p>
          </>
        ) : tool === "facility" ? (
          <>
            <label>
              Facility{" "}
              <select
                value={service}
                onChange={(event) => setService(event.target.value as Service)}
              >
                {Object.keys(services).map((kind) => (
                  <option key={kind}>{kind}</option>
                ))}
              </select>
            </label>
            <p>
              ${services[service].cost.toLocaleString()} build · ${services[service].upkeep} per day
            </p>
            <p>Choose dry land near the road network.</p>
          </>
        ) : tool === "demolish" ? (
          <p>Choose a visible road, lot or facility. Demolishing a road clears its frontage.</p>
        ) : (
          <>
            <label>
              Road class{" "}
              <select value={road} onChange={(event) => setRoad(event.target.value as RoadClass)}>
                {Object.keys(streets).map((kind) => (
                  <option key={kind}>{kind}</option>
                ))}
              </select>
            </label>
            <label>
              <input
                type="checkbox"
                checked={bridge}
                onChange={(event) => setBridge(event.target.checked)}
              />{" "}
              Bridge
            </label>
            <p>
              {anchor.length === 0
                ? "Choose a starting point."
                : tool === "curve" && anchor.length === 1
                  ? "Choose the curve control point."
                  : "Choose the road endpoint."}
            </p>
            {previewData && (
              <dl>
                <dt>Length</dt>
                <dd>{Math.round(previewData.length)} m</dd>
                <dt>Peak grade</dt>
                <dd>{Math.round(previewData.grade * 100)}%</dd>
                <dt>Expected cost</dt>
                <dd>${"{previewData.cost.toLocaleString()}"}</dd>
              </dl>
            )}
          </>
        )}
        {tool === "inspect" && !selection && !economyOpen && (
          <details>
            <summary>City objectives</summary>
            <ul>
              <li>
                {city.roadCount ? "Road network connected" : "Build a street on dry owned land"}
              </li>
              <li>
                {city.houses
                  ? "First buildings occupied"
                  : "Zone a street and connect power, water, and sewage"}
              </li>
              <li>
                {city.region?.utility.some((item) => item.shortage)
                  ? "Open Layers → Utilities to resolve shortages"
                  : "Check utility capacity before expanding"}
              </li>
              <li>
                {city.owned.length > 1
                  ? "Regional land acquired"
                  : "Use Land to purchase the tile across the river"}
              </li>
              <li>
                {city.region?.lines.length
                  ? "Transit in operation"
                  : "Place two connected stops and open a bus line"}
              </li>
            </ul>
          </details>
        )}
        {tool === "inspect" && !selection && !economyOpen && (
          <details>
            <summary>Start a new city</summary>
            <label>
              Opening{" "}
              <select value={opening} onChange={(event) => setOpening(event.target.value)}>
                <option value="7">Juniper Reach · industry</option>
                <option value="31">Cedar Crossing · commuters</option>
                <option value="empty-7">Juniper Reach · empty sandbox</option>
                <option value="empty-31">Cedar Crossing · empty sandbox</option>
              </select>
            </label>
            <button
              onClick={async () => {
                const empty = opening.startsWith("empty-");
                const seed = Number(empty ? opening.slice(6) : opening);
                await send({ kind: "speed", speed: 0 });
                if (await request({ kind: "initialize", seed, empty }, "New city opened")) {
                  setSpeed(0);
                  setOverview(false);
                  viewport?.overview(false);
                }
              }}
            >
              Start selected opening
            </button>
          </details>
        )}
        <div className="file-actions">
          <button onClick={() => void save(false)}>Save</button>
          <button onClick={() => void load()}>Load</button>
          <button onClick={() => void save(true)}>Export</button>
          <button onClick={() => input.current?.click()}>Import</button>
          <input
            ref={input}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void load(file);
              event.target.value = "";
            }}
          />
        </div>
      </aside>
      <footer className="dock">
        <p role="status">{notice}</p>
        {stats && (
          <div className="demand-bars" aria-label="Zone demand">
            {Object.entries(stats.demand).map(([name, value]) => (
              <button
                key={name}
                onClick={() => {
                  choose("inspect");
                  setEconomyOpen(!economyOpen);
                  setTaxRate(stats.tax);
                }}
                aria-label={`${name} demand ${Math.round(value)} percent`}
              >
                {name}
                <meter aria-label={name} min={0} max={100} value={value} />
              </button>
            ))}
          </div>
        )}
        <nav aria-label="Building tools">
          <button aria-pressed={tool === "inspect"} onClick={() => choose("inspect")}>
            Inspect
          </button>
          <button aria-pressed={tool === "straight"} onClick={() => choose("straight")}>
            Road
          </button>
          <button aria-pressed={tool === "curve"} onClick={() => choose("curve")}>
            Curve
          </button>
          <button aria-pressed={tool === "zone"} onClick={() => choose("zone")}>
            Zone
          </button>
          <button aria-pressed={tool === "facility"} onClick={() => choose("facility")}>
            Services
          </button>
          <button aria-pressed={tool === "demolish"} onClick={() => choose("demolish")}>
            Demolish
          </button>
          <button aria-pressed={tool === "land"} onClick={() => choose("land")}>
            Land
          </button>
          <button aria-pressed={tool === "transit"} onClick={() => choose("transit")}>
            Transit
          </button>
          <button aria-pressed={tool === "layers"} onClick={() => choose("layers")}>
            Layers
          </button>
          <button
            aria-pressed={overview}
            onClick={() => {
              viewport?.overview(!overview);
              setOverview(!overview);
            }}
          >
            Region
          </button>
        </nav>
      </footer>
      <div className="map-help">Right drag to orbit · Middle drag to pan · Scroll to zoom</div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
