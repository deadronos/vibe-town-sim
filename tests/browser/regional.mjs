import assert from "node:assert/strict";
import { chromium, firefox, webkit } from "@playwright/test";

const target = process.env.REGIONAL_URL ?? "http://127.0.0.1:4177";
const engines = {
  chrome: () =>
    chromium.launch({
      channel: "chrome",
      args: ["--ignore-gpu-blocklist", "--enable-gpu", "--use-angle=metal"],
    }),
  firefox: () => firefox.launch(),
  webkit: () => webkit.launch(),
};

for (const engine of process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(engines)) {
  const browser = await engines[engine]();
  try {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 1,
    });
    const exceptions = [];
    page.on("pageerror", (error) => exceptions.push(error.message));
    await page.goto(`${target}/regional.html?qa&empty`);
    await page.waitForFunction(() => window.regionalQA?.view.measurements().firstRender > 0);
    const legacy = '{"version":1,"marker":"classic fixture spacing  remains"}';
    await page.evaluate((raw) => localStorage.setItem("vibe-town-juniper-v1", raw), legacy);
    const renderer = await page.evaluate(() => {
      const gl = document.querySelector("canvas").getContext("webgl2");
      const info = gl?.getExtension("WEBGL_debug_renderer_info");
      return info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl?.getParameter(gl.RENDERER);
    });
    assert.ok(renderer, `${engine} provides WebGL2`);

    const command = (command) =>
      page.evaluate((command) => window.regionalQA.send({ kind: "command", command }), command);
    const worldClick = async (x, z, y) => {
      const screen = await page.evaluate(
        ({ x, z, y }) => window.regionalQA.view.project({ x, z }, y),
        { x, z, y },
      );
      await page.mouse.click(screen.x, screen.y);
    };
    async function focus(x, z, mode) {
      await page.evaluate(({ x, z, mode }) => window.regionalQA.view.cameraAt({ x, z }, mode), {
        x,
        z,
        mode,
      });
    }
    async function status(message) {
      await page.getByRole("status").getByText(message, { exact: true }).waitFor();
    }
    async function checkpoint() {
      return (await page.evaluate(() => window.regionalQA.send({ kind: "checkpoint" }))).checkpoint;
    }

    await focus(-660, -720, "planning");
    await page.getByRole("button", { name: "Road", exact: true }).click();
    await worldClick(-810, -720);
    const endpoint = await page.evaluate(() =>
      window.regionalQA.view.project({ x: -510, z: -720 }),
    );
    await page.mouse.move(endpoint.x, endpoint.y);
    await page.getByText("Peak grade", { exact: true }).waitFor();
    await worldClick(-510, -720);
    await status("Road built");
    const road = (await checkpoint()).roads[0];
    assert.ok(road);

    for (const angle of ["planning", "low"]) {
      await focus(-660, -720, angle);
      await page.getByRole("button", { name: "Inspect", exact: true }).click();
      const point = {
        x: (road.points[0].x + road.points[1].x) / 2,
        z: (road.points[0].z + road.points[1].z) / 2,
      };
      await worldClick(point.x, point.z);
      await page.getByRole("heading", { name: `Address ${road.id}`, exact: true }).waitFor();
    }

    await page.getByRole("button", { name: "Save", exact: true }).click();
    await status("Checkpoint saved");
    await page.evaluate(async () => {
      await new Promise((resolve, reject) => {
        const open = indexedDB.open("vibe-town-regional-v2", 1);
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction("checkpoints", "readwrite");
          tx.onabort = () => {
            db.close();
            resolve();
          };
          const write = tx
            .objectStore("checkpoints")
            .put({ version: 2, interrupted: true }, "active");
          write.onsuccess = () => tx.abort();
        };
      });
    });
    await page.locator('input[type="file"]').setInputFiles({
      name: "malformed.json",
      mimeType: "application/json",
      buffer: Buffer.from('{"version":2,"cash":0}'),
    });
    await status("Invalid regional checkpoint");
    assert.equal((await checkpoint()).roads[0].id, road.id);

    await page.getByRole("button", { name: "Demolish", exact: true }).click();
    await worldClick(
      (road.points[0].x + road.points[1].x) / 2,
      (road.points[0].z + road.points[1].z) / 2,
    );
    await status("Demolished");
    assert.equal((await checkpoint()).roads.length, 0);
    await page.getByRole("button", { name: "Load", exact: true }).click();
    await status("Checkpoint loaded");
    assert.equal((await checkpoint()).roads[0].id, road.id);

    await page.goto(`${target}/regional.html`);
    await status("Regional checkpoint restored");
    await page.goto(`${target}/regional.html?qa&seed=7`);
    await page.waitForFunction(() => window.regionalQA?.view.measurements().firstRender > 0);
    assert.ok((await checkpoint()).parcels.some((lot) => lot.built));
    await page.getByRole("button", { name: "Land", exact: true }).click();
    await worldClick(1000, -1000, 30);
    await page.getByRole("button", { name: "Purchase selected tile" }).click();
    await status("Land purchased");
    const owned = (await checkpoint()).land;
    assert.ok(owned.includes("2,1"), `Expected east bank, owned: ${owned}`);

    const commands = [
      {
        kind: "road",
        points: [
          { x: -365, z: -500 },
          { x: 445, z: -500 },
        ],
        road: "street",
        bridge: true,
      },
      {
        kind: "road",
        points: [
          { x: 445, z: -500 },
          { x: 760, z: -500 },
        ],
        road: "avenue",
      },
    ];
    for (const edit of commands) {
      const reply = await command(edit);
      assert.ok(reply.result.ok, JSON.stringify(reply));
    }
    const eastRoad = (await checkpoint()).roads.at(-1).id;
    assert.ok(
      (await command({ kind: "zone", roadId: eastRoad, zone: "mixed", side: "both" })).result.ok,
    );
    await page.getByRole("button", { name: "Layers", exact: true }).click();
    await page.getByLabel("Map layer").selectOption("utilities");
    await page.getByText("sewage", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await status("Checkpoint saved");
    assert.equal(await page.evaluate(() => localStorage.getItem("vibe-town-juniper-v1")), legacy);
    assert.deepEqual(exceptions, []);
    console.log(
      JSON.stringify({
        engine,
        browser: browser.version(),
        renderer,
        checks:
          "planning and low-angle picking, demolition, failed import, interrupted transaction, reload, river expansion and utility layer",
      }),
    );
  } finally {
    await browser.close();
  }
}
