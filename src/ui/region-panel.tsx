import { height, REGION, TILE } from "../core/world/terrain.ts";
import { useState } from "react";
import {
  adjacent,
  LAND_COST,
  LAND_UPKEEP,
  vehicles,
  type LineKind,
  type regionSummary,
} from "../core/sim/region.ts";
import type { Command } from "../core/sim/city.ts";
import type { Layer } from "../view/regional.ts";

type Run = (command: Command, message: string) => Promise<boolean>;
type Summary = ReturnType<typeof regionSummary>;

export function LandPanel({
  seed,
  owned,
  tile,
  data,
  run,
}: {
  seed: number;
  owned: string[];
  tile: string;
  data: Summary;
  run: Run;
}) {
  const policy = data.districts.find((district) => district.tile === tile);
  const [x, z] = tile.split(",").map((value) => Number(value) * TILE - REGION / 2);
  let dry = 0;
  for (let row = 0; row < 12; row++) {
    for (let column = 0; column < 12; column++) {
      if (
        height(seed, { x: x + ((column + 0.5) * TILE) / 12, z: z + ((row + 0.5) * TILE) / 12 }) > 1
      )
        dry++;
    }
  }
  return (
    <>
      <p>Click the map to select land. Each tile covers 4 km².</p>
      <dl>
        <dt>Tile</dt>
        <dd>{tile}</dd>
        <dt>Approx. dry area</dt>
        <dd>{((dry * 4) / 144).toFixed(1)} km²</dd>
        <dt>Status</dt>
        <dd>
          {owned.includes(tile) ? "Owned" : adjacent(owned, tile) ? "Available" : "Out of reach"}
        </dd>
        {!policy && (
          <>
            <dt>Purchase</dt>
            <dd>${LAND_COST.toLocaleString()}</dd>
            <dt>Monthly upkeep</dt>
            <dd>${LAND_UPKEEP}</dd>
          </>
        )}
      </dl>
      {policy ? (
        <DistrictForm key={tile} policy={policy} run={run} />
      ) : (
        <button
          disabled={!adjacent(owned, tile)}
          onClick={() => void run({ kind: "purchase", tile }, "Land purchased")}
        >
          Purchase selected tile
        </button>
      )}
    </>
  );
}

function DistrictForm({ policy, run }: { policy: Summary["districts"][number]; run: Run }) {
  const [name, setName] = useState(policy.name);
  const [tax, setTax] = useState(policy.tax);
  const [budget, setBudget] = useState(policy.budget);
  return (
    <>
      <dl>
        <dt>Residents</dt>
        <dd>{policy.residents}</dd>
        <dt>Jobs</dt>
        <dd>{policy.jobs}</dd>
      </dl>
      <label>
        Name
        <input value={name} maxLength={40} onChange={(event) => setName(event.target.value)} />
      </label>
      <label>
        Local tax (%)
        <input
          type="number"
          min={0}
          max={30}
          value={tax}
          onChange={(event) => setTax(Number(event.target.value))}
        />
      </label>
      <label>
        Service funding (%)
        <input
          type="number"
          min={0}
          max={150}
          value={budget}
          onChange={(event) => setBudget(Number(event.target.value))}
        />
      </label>
      <button
        onClick={() =>
          void run(
            { kind: "district", tile: policy.tile, name, tax, budget },
            "District policy applied",
          )
        }
      >
        Apply district policy
      </button>
    </>
  );
}

export function LayersPanel({
  layer,
  setLayer,
  data,
  traffic,
  focusRoad,
}: {
  layer: Layer;
  setLayer(value: Layer): void;
  traffic: Array<{ id: number; queued: number; admitted: number }>;
  focusRoad(id: number): void;
  data: Summary;
}) {
  return (
    <>
      <label>
        Map layer{" "}
        <select value={layer} onChange={(event) => setLayer(event.target.value as Layer)}>
          <option value="none">Natural colors</option>
          <option value="utilities">Utilities</option>
          <option value="traffic">Road traffic</option>
          <option value="transit">Transit</option>
          <option value="value">Land value</option>
          <option value="noise">Noise</option>
          <option value="pollution">Pollution</option>
        </select>
      </label>
      {layer === "utilities" ? (
        <>
          <p>
            Teal lots have power, water and sewage service. Red lots lack capacity or a road
            connection.
          </p>
          <table>
            <thead>
              <tr>
                <th>Utility</th>
                <th>Capacity</th>
                <th>Short</th>
              </tr>
            </thead>
            <tbody>
              {data.utility.map((row) => (
                <tr key={row.service}>
                  <td>{row.service}</td>
                  <td>{row.capacity}</td>
                  <td>{row.shortage}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : layer === "traffic" ? (
        <>
          <p>
            Gold marks waiting road cohorts. Red marks queues of five or more. Counts come from the
            latest day.
          </p>
          {traffic.length ? (
            <table>
              <thead>
                <tr>
                  <th>Road</th>
                  <th>Waiting</th>
                  <th>Entered</th>
                </tr>
              </thead>
              <tbody>
                {traffic.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <button onClick={() => focusRoad(row.id)}>Road {row.id}</button>
                    </td>
                    <td>{row.queued}</td>
                    <td>{row.admitted}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p>No trips are queued.</p>
          )}
        </>
      ) : layer === "transit" ? (
        <>
          <p>
            Gold lines are buses. Teal lines are trams. Queue counts are from the latest simulation
            day.
          </p>
          <table>
            <thead>
              <tr>
                <th>Line</th>
                <th>Boarded</th>
                <th>Queue</th>
              </tr>
            </thead>
            <tbody>
              {[...data.lines]
                .sort((a, b) => b.waiting - a.waiting)
                .map((line) => (
                  <tr key={line.id}>
                    <td>
                      {line.kind} {line.id}
                    </td>
                    <td>{line.riders}</td>
                    <td>{line.waiting}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </>
      ) : layer === "none" ? (
        <>
          <p>Completed service visits, measured in residents served.</p>
          <dl>
            {Object.entries(data.response).map(([service, total]) => (
              <div key={service}>
                <dt>{service}</dt>
                <dd>{total}</dd>
              </div>
            ))}
          </dl>
        </>
      ) : (
        <p>
          Blue marks low levels and orange marks high levels. Industry, freight and treatment plants
          add pollution. Major roads add noise. Schools and clinics support land value.
        </p>
      )}
    </>
  );
}

export function TransitPanel({ data, run }: { data: Summary; run: Run }) {
  const [line, setLine] = useState<LineKind>("bus");
  const [stops, setStops] = useState<number[]>([]);
  return (
    <>
      <p>Click a street or avenue to place a stop for $1,500. Choose stops below in route order.</p>
      <label>
        Mode{" "}
        <select value={line} onChange={(event) => setLine(event.target.value as LineKind)}>
          <option value="bus">Bus</option>
          <option value="tram">Tram</option>
        </select>
      </label>
      <dl>
        <dt>Construction</dt>
        <dd>${vehicles[line].construction.toLocaleString()}</dd>
        <dt>Seats per departure</dt>
        <dd>{vehicles[line].seats}</dd>
        <dt>Departure interval</dt>
        <dd>{vehicles[line].headway} days</dd>
        <dt>Daily upkeep</dt>
        <dd>${vehicles[line].upkeep}</dd>
      </dl>
      <div className="stop-list">
        {data.stops.map((stop) => (
          <button
            key={stop.id}
            aria-pressed={stops.includes(stop.id)}
            onClick={() =>
              setStops(
                stops.includes(stop.id)
                  ? stops.filter((id) => id !== stop.id)
                  : [...stops, stop.id],
              )
            }
          >
            Stop {stop.id}
            {stops.includes(stop.id) ? ` · ${stops.indexOf(stop.id) + 1}` : ""}
          </button>
        ))}
      </div>
      <button
        disabled={stops.length < 2}
        onClick={async () => {
          if (await run({ kind: "line", line, stops }, "Transit line opened")) setStops([]);
        }}
      >
        Open line
      </button>
    </>
  );
}
