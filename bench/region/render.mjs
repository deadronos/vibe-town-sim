import { chromium } from "@playwright/test";
import assert from "node:assert/strict";

const url = process.env.REGIONAL_URL ?? "http://127.0.0.1:4177";
const interval = Number(process.env.REGIONAL_SAMPLE_MS ?? 4_000);
const browser = await chromium.launch({
  channel: "chrome",
  args: [
    "--ignore-gpu-blocklist",
    "--enable-gpu",
    "--use-angle=metal",
    "--enable-unsafe-webgpu",
    "--enable-precise-memory-info",
  ],
});
const percentile = (samples, p) =>
  samples.slice().sort((a, b) => a - b)[Math.ceil(samples.length * p) - 1];

try {
  for (const backend of ["webgl", "webgpu"]) {
    const page = await browser.newPage({
      viewport: { width: 1920, height: 1080 },
      deviceScaleFactor: 1,
    });
    await page.addInitScript(() => {
      window.geometryWrites = 0;
      const geometryTarget = (target) => target === 0x8892 || target === 0x8893;
      const gl = WebGL2RenderingContext.prototype;
      for (const [method, argument] of [
        ["bufferData", 1],
        ["bufferSubData", 2],
      ]) {
        const original = gl[method];
        gl[method] = function (...args) {
          const source = args[argument];
          if (geometryTarget(args[0]) && source?.byteLength) {
            const element = source.BYTES_PER_ELEMENT ?? 1;
            const offset = args[3] ?? 0;
            const count = args[4];
            window.geometryWrites += count ? count * element : source.byteLength - offset * element;
          }
          return Reflect.apply(original, this, args);
        };
      }
      if (!window.GPUQueue) return;
      const queue = GPUQueue.prototype;
      const write = queue.writeBuffer;
      queue.writeBuffer = function (buffer, offset, data, sourceOffset = 0, size) {
        if (buffer.usage & (GPUBufferUsage.VERTEX | GPUBufferUsage.INDEX)) {
          const element = data.BYTES_PER_ELEMENT ?? 1;
          window.geometryWrites +=
            size === undefined ? data.byteLength - sourceOffset * element : size * element;
        }
        return Reflect.apply(write, this, arguments);
      };
    });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const started = performance.now();
    await page.goto(`${url}/?benchmark&backend=${backend}&qa`);
    await page.waitForFunction(() => window.regionalBenchmark?.measurements().firstRender > 0);
    const cold = Math.round(performance.now() - started);
    const device = await page.evaluate(async (backend) => {
      const canvas = document.querySelector("canvas");
      const gl = backend === "webgl" ? canvas.getContext("webgl2") : null;
      const ext = gl?.getExtension("WEBGL_debug_renderer_info");
      if (gl && ext) return gl.getParameter(ext.UNMASKED_RENDERER_WEBGL);
      const adapter = await navigator.gpu?.requestAdapter();
      return adapter?.info.description || adapter?.info.vendor || "Unidentified";
    }, backend);
    const initial = await page.evaluate(() => window.regionalBenchmark.measurements());
    assert.equal(initial.backend, backend);
    for (const [route, paused] of [
      ["overview", false],
      ["low", false],
      ["low", true],
    ]) {
      await page.evaluate(
        ([route, paused]) => {
          window.geometryWrites = 0;
          window.regionalBenchmark.benchmark(route, paused);
        },
        [route, paused],
      );
      await page.waitForTimeout(1_200);
      await page.evaluate(
        ([route, paused]) => {
          window.geometryWrites = 0;
          window.regionalBenchmark.benchmark(route, paused);
        },
        [route, paused],
      );
      await page.waitForTimeout(interval);
      const result = await page.evaluate(() => ({
        ...window.regionalBenchmark.measurements(),
        jsHeap: performance.memory?.usedJSHeapSize,
        geometryWrites: window.geometryWrites,
      }));
      assert.ok(result.samples.length > 4, JSON.stringify({ result, device }));
      if (paused) {
        assert.equal(result.uploads, 0);
        assert.equal(result.geometryWrites, 0);
      }
      console.log(
        JSON.stringify({
          backend,
          browser: browser.version(),
          device,
          route,
          paused,
          coldMs: cold,
          viewportColdMs: Math.round(result.firstRender),
          durationMs: interval,
          samples: result.samples.length,
          frame: result.frame,
          p50Ms: percentile(result.samples, 0.5),
          p95Ms: percentile(result.samples, 0.95),
          maxMs: Math.max(...result.samples),
          generatedUploadBytes: result.uploads,
          vertexIndexUploadBytes: result.geometryWrites,
          jsHeap: result.jsHeap,
          drawCalls: result.calls,
          geometry: result.geometry,
        }),
      );
    }
    const construction = await page.evaluate(async () => {
      const results = [];
      const view = window.regionalBenchmark;
      for (let i = 0; i < 20; i++) {
        const z = -1600 + i * 30;
        const t = performance.now();
        const reply = await window.regionalQA.send({
          kind: "command",
          command: {
            kind: "road",
            road: "street",
            points: [
              { x: -1700, z },
              { x: -1550, z },
            ],
          },
        });
        if (!reply.result.ok) throw Error(reply.result.reason);
        const ack = performance.now() - t;
        await new Promise((resolve) => {
          function followingPaint() {
            if (view.measurements().renderedRevision >= reply.result.revision)
              requestAnimationFrame(resolve);
            else requestAnimationFrame(followingPaint);
          }
          requestAnimationFrame(followingPaint);
        });
        results.push({ ack, visible: performance.now() - t });
      }
      return results;
    });
    console.log(
      JSON.stringify({
        backend,
        constructionCount: construction.length,
        p95AcknowledgementMs: percentile(
          construction.map((r) => r.ack),
          0.95,
        ),
        p95FollowingPaintMs: percentile(
          construction.map((r) => r.visible),
          0.95,
        ),
      }),
    );
    assert.deepEqual(errors, []);
    await page.close();
  }
} finally {
  await browser.close();
}
