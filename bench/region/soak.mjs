import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import { denseCity } from "./fixture.mjs";

const duration = Number(process.env.REGIONAL_SOAK_MS ?? 300_000);
const url = process.env.REGIONAL_URL ?? "http://127.0.0.1:4178";
const browser = await chromium.launch({
  channel: "chrome",
  args: [
    "--ignore-gpu-blocklist",
    "--enable-gpu",
    "--use-angle=metal",
    "--disable-background-timer-throttling",
  ],
});
try {
  const page = await browser.newPage({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${url}/?qa&empty`);
  await page.waitForFunction(() => window.regionalQA?.view.measurements().firstRender > 0);
  const reply = await page.evaluate(
    (checkpoint) => window.regionalQA.send({ kind: "restore", checkpoint }),
    denseCity(),
  );
  assert.ok(reply.result.ok, JSON.stringify(reply));
  await page.waitForTimeout(1200);
  const start = await page.evaluate(async () => {
    const { send, tick } = window.regionalQA;
    const start = { tick: tick(), time: performance.now() };
    await send({ kind: "speed", speed: 16 });
    return start;
  });
  await page.waitForTimeout(duration);
  const end = await page.evaluate(async () => {
    const { send, tick } = window.regionalQA;
    await send({ kind: "speed", speed: 0 });
    return { tick: tick(), time: performance.now() };
  });
  const advanced = end.tick - start.tick;
  const expected = Math.floor((end.time - start.time) / 250) * 16;
  assert.ok(advanced > expected * 0.985, `Advanced ${advanced} of ${expected} scheduled days`);
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      durationMs: Math.round(end.time - start.time),
      advanced,
      expected,
      browser: browser.version(),
    }),
  );
} finally {
  await browser.close();
}
