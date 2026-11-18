import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { distance, mix, type Point } from "../core/world/terrain.ts";
import { roadLength, streets, type Road, type RoadClass } from "../core/network/roads.ts";
import { PROTOCOL, type Panel, type Reply, type Request } from "../worker/protocol.ts";
import { readCheckpoint, writeCheckpoint } from "../storage/regional.ts";
import { createViewport } from "../view/regional.ts";
import "./regional.css";

type WithoutEnvelope<T> = T extends unknown ? Omit<T, "version" | "id"> : never;
const worker = new Worker(new URL("../worker/regional.ts", import.meta.url), { type: "module" });
const params = new URLSearchParams(location.search);
let panel: Panel = { seed: 7, tick: 0, cash: 0, revision: 0, roadCount: 0, owned: [] };
const listeners = new Set<() => void>();
const pending = new Map<number, (reply: Reply) => void>();
let viewport: ReturnType<typeof createViewport> | undefined;
let lastScene: Extract<Reply, { kind: "scene" }>["scene"] | undefined;
let nextId = 1;

worker.onmessage = ({ data }: MessageEvent<Reply>) => {
  if (data.version !== PROTOCOL) return;
  if (data.kind === "panel") {
    panel = data.panel;
    for (const listener of listeners) listener();
  } else if (data.kind === "scene") {
    lastScene = data.scene;
    viewport?.update(data.scene);
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
  const [tool, setTool] = useState<"inspect" | "straight" | "curve">("inspect");
  const [road, setRoad] = useState<RoadClass>("street");
  const [bridge, setBridge] = useState(false);
  const [anchor, setAnchor] = useState<Point[]>([]);
  const [selection, setSelection] = useState<Road>();
  const [notice, setNotice] = useState("Choose Road to start building.");
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

  onMap.current = async (point, roadId) => {
    if (tool === "inspect") {
      if (roadId === undefined) {
        setSelection(undefined);
        return;
      }
      const reply = await send({ kind: "select", roadId });
      if (reply.kind === "selection") setSelection(reply.road);
      return;
    }
    const vertices = [...anchor, point];
    const complete = vertices.length === (tool === "curve" ? 3 : 2);
    if (!complete) {
      setAnchor(vertices);
      viewport?.preview(vertices, bridge);
      return;
    }
    let points = vertices;
    if (tool === "curve") {
      points = Array.from({ length: 13 }, (_, i) => {
        const t = i / 12;
        return mix(mix(vertices[0], vertices[1], t), mix(vertices[1], vertices[2], t), t);
      });
    }
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

  useEffect(() => {
    try {
      viewport = createViewport(
        canvas.current!,
        (point, roadId) => onMap.current(point, roadId),
        params.has("benchmark"),
      );
      if (lastScene) viewport.update(lastScene);
      if (params.has("benchmark")) Object.assign(window, { regionalBenchmark: viewport });
    } catch (error) {
      setNotice(`Viewport unavailable. ${(error as Error).message}`);
    }
    void send({ kind: "initialize", seed: Number(params.get("seed") ?? 7) });
    return () => viewport?.dispose();
  }, []);

  function choose(next: typeof tool) {
    setTool(next);
    setAnchor([]);
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
        <a className="wordmark" href="./regional.html">
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
        <small>{selection ? "NETWORK INSPECTOR" : "REGIONAL PLANNING"}</small>
        <h1>
          {selection
            ? `Road ${selection.id}`
            : tool === "inspect"
              ? "Juniper Basin"
              : "Build roads"}
        </h1>
        {selection && tool === "inspect" ? (
          <dl>
            <dt>Class</dt>
            <dd>{selection.kind}</dd>
            <dt>Length</dt>
            <dd>{Math.round(roadLength(selection.points))} m</dd>
            <dt>Sidewalks</dt>
            <dd>{streets[selection.kind].sidewalks ? "Yes" : "No"}</dd>
            <dt>Water crossing</dt>
            <dd>{selection.bridge ? "Bridge" : "None"}</dd>
          </dl>
        ) : tool === "inspect" ? (
          <dl>
            <dt>Owned land</dt>
            <dd>{city.owned.length * 4} km²</dd>
            <dt>Road segments</dt>
            <dd>{city.roadCount}</dd>
            <dt>Map size</dt>
            <dd>64 km²</dd>
          </dl>
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
            {anchor.length === 2 && <p>First leg {Math.round(distance(anchor[0], anchor[1]))} m</p>}
          </>
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
