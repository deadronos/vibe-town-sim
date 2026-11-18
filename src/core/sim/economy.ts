import { landId } from "../world/terrain.ts";
import {
  chooseLine,
  LAND_UPKEEP,
  scheduleResponse,
  vehicles,
  type PublicService,
  type RegionalCity,
} from "./region.ts";
import { planner, travelDays } from "../network/routes.ts";
import { roadComponents, streets } from "../network/roads.ts";
import { services, suppliedParcels, zones, type Development, type Parcel } from "./development.ts";

export interface Household {
  id: number;
  residents: number;
  workers: number;
  money: number;
  income: number;
  rent: number;
}
export interface Firm {
  id: number;
  jobs: number;
  staff: number;
  money: number;
  inventory: number;
}
export type TripKind = "commute" | "shipment" | "shopping" | "dispatch";
export interface Trip {
  id: number;
  kind: TripKind;
  from: number;
  to: number;
  edges: number[];
  edge: number;
  due: number;
  quantity: number;
  mode: "road" | "bus" | "tram";
  returning?: boolean;
  line?: number;
}
export interface Posting {
  tick: number;
  from: string;
  to: string;
  amount: number;
  purpose: string;
}
export interface Economy {
  households: Record<number, Household>;
  firms: Record<number, Firm>;
  trips: Trip[];
  ledger: Posting[];
  balances: Record<string, number>;
  receipts: number;
  expenses: number;
  produced: number;
  consumed: number;
  imported: number;
  exported: number;
  scrapped: number;
  payroll: number;
  commutes: number;
  deliveries: number;
  lost: number;
  queued: number;
  roadTraffic: Record<number, { admitted: number; queued: number }>;
}
export interface EconomicCity extends Development {
  tick: number;
  cash: number;
  nextId: number;
  economy: Economy;
  tax: number;
  gateway: number;
}

export function newEconomy(): Economy {
  return {
    households: {},
    firms: {},
    trips: [],
    ledger: [],
    balances: {},
    receipts: 0,
    expenses: 0,
    produced: 0,
    consumed: 0,
    imported: 0,
    exported: 0,
    scrapped: 0,
    payroll: 0,
    commutes: 0,
    deliveries: 0,
    lost: 0,
    queued: 0,
    roadTraffic: {},
  };
}

type Account = "city" | "regional" | `home:${number}` | `firm:${number}` | "cargo";

export function transfer(
  city: EconomicCity,
  from: Account,
  to: Account,
  amount: number,
  purpose: string,
): void {
  if (!Number.isSafeInteger(amount) || amount <= 0 || from === to) return;
  const { economy } = city;
  economy.balances[from] = (economy.balances[from] ?? 0) - amount;
  economy.balances[to] = (economy.balances[to] ?? 0) + amount;
  if (from === "city") {
    city.cash -= amount;
    economy.expenses += amount;
  }
  if (to === "city") {
    city.cash += amount;
    economy.receipts += amount;
  }
  for (const [account, change] of [
    [from, -amount],
    [to, amount],
  ] as const) {
    const id = Number(account.split(":")[1]);
    if (account.startsWith("home:")) economy.households[id].money += change;
    if (account.startsWith("firm:")) economy.firms[id].money += change;
  }
  economy.ledger.push({ tick: city.tick, from, to, amount, purpose });
  if (economy.ledger.length > 80) economy.ledger.shift();
}

export type Router = ReturnType<typeof planner>;

export function synchronizeEconomy(city: RegionalCity, router: Router): void {
  const { economy } = city;
  const active = new Map(city.parcels.filter((lot) => lot.built).map((lot) => [lot.id, lot]));
  for (const trip of economy.trips) {
    const from = active.get(trip.from);
    const to = active.get(trip.to);
    const facility =
      trip.kind === "dispatch" ? city.facilities.find((item) => item.id === trip.from) : undefined;
    const origin = from ?? facility;
    let path = origin && to && router.route(origin.roadId, to.roadId);
    if (trip.returning && path) path = [...path].reverse();
    if (trip.line !== undefined && path && from && to) {
      const transit = chooseLine(city, router, from, to, path);
      path = transit?.line.id === trip.line ? transit.edges : undefined;
    }
    if (
      path &&
      path.length === trip.edges.length &&
      path.every((edge, i) => edge === trip.edges[i])
    )
      continue;
    trip.edge = -1;
    economy.lost++;
    if (trip.kind !== "shipment") continue;
    const buyer = economy.firms[trip.to];
    if (buyer)
      transfer(city, "cargo", `firm:${buyer.id}`, trip.quantity * 2, "Canceled wholesale order");
    const firm = economy.firms[trip.from];
    if (firm && active.has(trip.from)) firm.inventory += trip.quantity;
    else economy.scrapped += trip.quantity;
  }
  economy.trips = economy.trips.filter((trip) => trip.edge >= 0);
  for (const firm of Object.values(economy.firms)) {
    if (active.has(firm.id)) continue;
    economy.scrapped += firm.inventory;
    transfer(city, `firm:${firm.id}`, "regional", firm.money, "Firm closure");
    delete economy.firms[firm.id];
  }
  for (const household of Object.values(economy.households)) {
    if (active.has(household.id)) continue;
    transfer(city, `home:${household.id}`, "regional", household.money, "Moving out");
    delete economy.households[household.id];
  }
  for (const parcel of city.parcels) {
    if (!parcel.built) continue;
    const { residents, jobs } = zones[parcel.zone];
    if (residents && !economy.households[parcel.id]) {
      economy.households[parcel.id] = {
        id: parcel.id,
        residents,
        workers: Math.floor(residents * 0.48),
        money: 0,
        income: 0,
        rent: residents,
      };
      transfer(city, "regional", `home:${parcel.id}`, residents * 65, "Incoming household savings");
    }
    if (jobs && !economy.firms[parcel.id]) {
      economy.firms[parcel.id] = { id: parcel.id, jobs, staff: 0, money: 0, inventory: 0 };
      transfer(city, "regional", `firm:${parcel.id}`, 700, "Incoming business investment");
    }
  }
}

function start(
  city: RegionalCity,
  kind: TripKind,
  from: Parcel,
  to: Parcel,
  edges: number[],
  quantity: number,
  router: Router,
): void {
  const transit =
    kind === "commute" || kind === "shopping"
      ? chooseLine(city, router, from, to, edges)
      : undefined;
  const seats = transit ? vehicles[transit.line.kind].seats : quantity;
  for (let remaining = quantity; remaining > 0; remaining -= seats) {
    city.economy.trips.push({
      id: city.nextId++,
      kind,
      from: from.id,
      to: to.id,
      edges: transit?.edges ?? edges,
      edge: 0,
      due: 0,
      quantity: Math.min(remaining, seats),
      mode: transit?.line.kind ?? "road",
      line: transit?.line.id,
    });
  }
}

export function startDispatch(
  city: RegionalCity,
  from: number,
  to: number,
  edges: number[],
  quantity: number,
): void {
  city.economy.trips.push({
    id: city.nextId++,
    kind: "dispatch",
    from,
    to,
    edges,
    edge: 0,
    due: 0,
    quantity,
    mode: "road",
  });
}

function finish(city: RegionalCity, trip: Trip): boolean {
  const { economy } = city;
  if (trip.kind === "dispatch" && !trip.returning) {
    const facility = city.facilities.find((item) => item.id === trip.from)!;
    const service = facility.service as PublicService;
    city.region.response[service] += trip.quantity;
    city.region.visited[`${service}:${trip.to}`] = city.tick;
    trip.returning = true;
    trip.edges = [...trip.edges].reverse();
    trip.edge = 0;
    return true;
  }
  const from = economy.households[trip.from];
  const to = economy.firms[trip.to];
  if (trip.kind === "commute" && from && to) {
    const staff = Math.min(trip.quantity, to.jobs - to.staff, Math.floor(to.money / 2));
    to.staff += staff;
    economy.commutes += staff;
    const wage = staff * 2;
    transfer(city, `firm:${to.id}`, `home:${from.id}`, wage, "Wages");
    from.income += wage;
    economy.payroll += wage;
  } else if (trip.kind === "shipment" && to) {
    to.inventory += trip.quantity;
    economy.deliveries += trip.quantity;
    transfer(city, "cargo", `firm:${trip.from}`, trip.quantity * 2, "Wholesale delivery");
  } else if (trip.kind === "shopping" && from && to) {
    const quantity = Math.min(trip.quantity, to.inventory, Math.floor(from.money / 6));
    to.inventory -= quantity;
    economy.consumed += quantity;
    transfer(city, `home:${from.id}`, `firm:${to.id}`, quantity * 6, "Goods retail");
  }
  return false;
}

function advanceTrips(city: RegionalCity, router: Router): void {
  const { economy, tick } = city;
  economy.roadTraffic = {};
  economy.queued = 0;
  const active: Trip[] = [];
  const occupied = new Map<number, number>();
  const lines = new Map(
    city.region.lines.map((line) => {
      line.waiting = 0;
      return [line.id, line];
    }),
  );
  const boarding = new Map<number, number>();
  for (const trip of economy.trips) {
    if (trip.due > tick && trip.mode === "road")
      occupied.set(trip.edges[trip.edge], (occupied.get(trip.edges[trip.edge]) ?? 0) + 1);
  }
  for (const trip of economy.trips) {
    if (trip.due > tick) {
      active.push(trip);
      continue;
    }
    if (trip.due > 0) {
      trip.edge++;
      trip.due = 0;
      if (trip.edge === trip.edges.length) {
        if (!finish(city, trip)) continue;
      }
    }
    const road = router.roads.get(trip.edges[trip.edge])!;
    const line = trip.line === undefined ? undefined : lines.get(trip.line);
    if (line) {
      const vehicle = vehicles[line.kind];
      const boarded = boarding.get(line.id) ?? 0;
      if (trip.edge > 0) {
        trip.due = tick + Math.ceil(travelDays(road) / vehicle.speed);
      } else if (tick % vehicle.headway === 0 && boarded + trip.quantity <= vehicle.seats) {
        line.riders += trip.quantity;
        boarding.set(line.id, boarded + trip.quantity);
        trip.due = tick + Math.ceil(travelDays(road) / vehicle.speed);
      } else {
        line.waiting += trip.quantity;
        line.waitDays += trip.quantity;
      }
      active.push(trip);
      continue;
    }
    const load = occupied.get(road.id) ?? 0;
    const status = economy.roadTraffic[road.id] ?? { admitted: 0, queued: 0 };
    if (load < streets[road.kind].capacity) {
      occupied.set(road.id, load + 1);
      trip.due = tick + travelDays(road);
      status.admitted++;
    } else {
      status.queued++;
      economy.queued++;
    }
    economy.roadTraffic[road.id] = status;
    active.push(trip);
  }
  economy.trips = active;
}

export function economicDay(city: RegionalCity, router: Router, supplied: Set<number>): void {
  const { economy, tick } = city;
  const lots = new Map(city.parcels.map((lot) => [lot.id, lot]));
  const firms = Object.values(economy.firms).filter((firm) => supplied.has(firm.id));
  const homes = Object.values(economy.households).filter((home) => supplied.has(home.id));
  const factories = firms.filter((firm) => lots.get(firm.id)?.zone === "industry");
  const shops = firms.filter((firm) => ["shops", "mixed"].includes(lots.get(firm.id)!.zone));
  const components = city.gateway ? roadComponents(city) : undefined;
  const gateway = components?.get(city.gateway);
  const external = (lot: Parcel) =>
    gateway !== undefined && components?.get(lot.roadId) === gateway;

  advanceTrips(city, router);
  scheduleResponse(city, router);
  for (const factory of factories) {
    const capacity = Math.max(0, Math.min(100 - factory.inventory, factory.staff));
    factory.inventory += capacity;
    economy.produced += capacity;
  }

  if (tick % 7 === 0) {
    const assigned = new Map<number, number>();
    const commuting = new Set<number>();
    for (const trip of economy.trips) {
      if (trip.kind !== "commute") continue;
      commuting.add(trip.from);
      assigned.set(trip.to, (assigned.get(trip.to) ?? 0) + trip.quantity);
    }
    for (const firm of Object.values(economy.firms)) firm.staff = 0;
    for (const home of homes) {
      if (commuting.has(home.id)) continue;
      const origin = lots.get(home.id)!;
      const slack = Math.max(0, home.money - home.rent);
      if (slack < home.workers) continue;
      const candidates = firms
        .map((firm) => {
          const lot = lots.get(firm.id)!;
          if (firm.jobs <= (assigned.get(firm.id) ?? 0)) return undefined;
          const edges = router.route(origin.roadId, lot.roadId);
          return edges
            ? {
                firm,
                lot,
                edges,
                time: edges.reduce((sum, id) => sum + travelDays(router.roads.get(id)!), 0),
              }
            : undefined;
        })
        .filter((candidate) => candidate !== undefined)
        .sort((a, b) => a.time - b.time || a.firm.id - b.firm.id);
      let available = home.workers;
      for (const candidate of candidates) {
        const quantity = Math.min(
          available,
          candidate.firm.jobs - (assigned.get(candidate.firm.id) ?? 0),
        );
        start(city, "commute", origin, candidate.lot, candidate.edges, quantity, router);
        assigned.set(candidate.firm.id, (assigned.get(candidate.firm.id) ?? 0) + quantity);
        available -= quantity;
        if (available === 0) break;
      }
      if (available && external(origin)) {
        const income = available * 3;
        transfer(city, "regional", `home:${home.id}`, income, "External commute wages");
        home.income += income;
      }
    }
  }

  if (tick % 4 === 0) {
    const incoming = new Set(
      economy.trips.filter((trip) => trip.kind === "shipment").map((trip) => trip.to),
    );
    for (const shop of shops) {
      const target = lots.get(shop.id)!;
      if (!shop.staff || incoming.has(shop.id) || shop.inventory > 19) continue;
      let ordered = false;
      for (const factory of factories) {
        const origin = lots.get(factory.id)!;
        if (!factory.inventory || shop.money < 2) continue;
        const edges = router.route(origin.roadId, target.roadId);
        if (!edges) continue;
        const quantity = Math.min(28, factory.inventory, Math.floor(shop.money / 2));
        factory.inventory -= quantity;
        transfer(city, `firm:${shop.id}`, "cargo", quantity * 2, "Wholesale order");
        start(city, "shipment", origin, target, edges, quantity, router);
        ordered = true;
        break;
      }
      if (!ordered && external(target) && shop.money >= 42) {
        transfer(city, `firm:${shop.id}`, "regional", 42, "Imports");
        shop.inventory += 14;
        economy.imported += 14;
      }
    }

    const shopping = new Set(
      economy.trips.filter((trip) => trip.kind === "shopping").map((trip) => trip.from),
    );
    for (const home of homes) {
      if (shopping.has(home.id) || home.money < 6) continue;
      const origin = lots.get(home.id)!;
      for (const shop of shops) {
        if (!shop.inventory || !shop.staff) continue;
        const target = lots.get(shop.id)!;
        const edges = router.route(origin.roadId, target.roadId);
        if (!edges) continue;
        start(
          city,
          "shopping",
          origin,
          target,
          edges,
          Math.max(1, Math.floor(home.residents / 6)),
          router,
        );
        break;
      }
    }
  }

  if (tick % 30 === 0) {
    for (const factory of factories) {
      const origin = lots.get(factory.id)!;
      if (factory.inventory > 46 && external(origin)) {
        factory.inventory -= 40;
        economy.exported += 40;
        transfer(city, "regional", `firm:${factory.id}`, 120, "Goods exports");
      }
    }
    for (const home of homes) {
      const rate = city.region.districts[landId(lots.get(home.id)!)]?.tax ?? city.tax;
      const propertyBill = Math.floor((home.residents * rate) / 5);
      const tax = Math.min(propertyBill, home.money);
      transfer(city, `home:${home.id}`, "city", tax, "Household taxes");
      transfer(
        city,
        `home:${home.id}`,
        "regional",
        Math.min(home.rent, home.money),
        "Housing rent",
      );
    }
    for (const firm of firms) {
      if (lots.get(firm.id)!.zone === "offices" && firm.staff > 0) {
        transfer(
          city,
          "regional",
          `firm:${firm.id}`,
          firm.staff * 14,
          "Regional professional services",
        );
      }
      const rate = city.region.districts[landId(lots.get(firm.id)!)]?.tax ?? city.tax;
      const tax = Math.min(Math.floor((firm.jobs * rate) / 3), firm.money);
      transfer(city, `firm:${firm.id}`, "city", tax, "Business taxes");
    }
    const transitCost = city.region.lines.reduce(
      (sum, line) => sum + vehicles[line.kind].upkeep * 30,
      0,
    );
    const upkeep = city.facilities.reduce(
      (sum, facility) => {
        const budget = city.region.districts[landId(facility)]?.budget ?? 100;
        return sum + Math.floor((services[facility.service].upkeep * 30 * budget) / 100);
      },
      city.roads.length * 9 + (city.land.length - 1) * LAND_UPKEEP + transitCost,
    );
    transfer(city, "city", "regional", upkeep, "Monthly infrastructure operations");
  }
}

export function prepareEconomy(city: RegionalCity) {
  const router = planner(city);
  const supplied = suppliedParcels(city);
  synchronizeEconomy(city, router);
  return { router, supplied };
}

export function economicSummary(city: EconomicCity) {
  const { economy } = city;
  const homes = Object.values(economy.households);
  const firms = Object.values(economy.firms);
  const supplied = suppliedParcels(city);
  const residents = homes.reduce((total, home) => total + home.residents, 0);
  const jobs = firms.reduce((total, firm) => total + firm.jobs, 0);
  const staff = firms.reduce((total, firm) => total + firm.staff, 0);
  const workers = homes.reduce((total, home) => total + home.workers, 0);
  const savings = homes.reduce((total, home) => total + home.money, 0);
  const vacancies = city.parcels.filter((lot) => !lot.built).length;
  return {
    residents,
    jobs,
    staff,
    workers,
    savings,
    vacancies,
    outages: city.parcels.length - supplied.size,
    tax: city.tax,
    estimatedTaxes: Math.floor((residents * city.tax) / 5 + (jobs * city.tax) / 3),
    receipts: economy.receipts,
    expenses: economy.expenses,
    consumed: economy.consumed,
    produced: economy.produced,
    shipments: economy.deliveries,
    lost: economy.lost,
    queued: economy.queued,
    demand: {
      housing: Math.max(0, Math.min(100, 55 + (jobs - workers) * 2 - vacancies - city.tax)),
      retail: Math.max(0, Math.min(100, residents / 3 + economy.consumed / 10 - city.tax)),
      industry: Math.max(
        0,
        Math.min(100, 30 + (workers - staff) / 2 + (city.gateway ? 20 : 0) - city.tax),
      ),
    },
    ledger: economy.ledger.slice(-8).reverse(),
  };
}
