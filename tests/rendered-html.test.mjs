import assert from "node:assert/strict";
import test from "node:test";

const developmentPreviewMeta =
  /<meta(?=[^>]*\bname=["']codex-preview["'])(?=[^>]*\bcontent=["']development["'])[^>]*>/i;

test("renders development preview metadata and server-rendered scene layers", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const {default: worker} = await import(workerUrl.href);

  const response = await worker.fetch(
    new Request("http://localhost/", {
      headers: {accept: "text/html"},
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", {status: 404}),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );

  assert.equal(response.status, 200);
  assert.match(
    response.headers.get("content-type") ?? "",
    /^text\/html\b/i,
  );
  const html = await response.text();
  assert.match(html, developmentPreviewMeta);
  assert.match(html, /data-layer=["']page["']/i);
  assert.match(html, /data-layer=["']space-background["']/i);
  assert.match(html, /data-layer=["']globe-map["']/i);
  assert.match(html, /data-layer=["']day-night-globe["']/i);
  assert.match(html, /data-layer=["']satellite-controls["']/i);
  assert.doesNotMatch(html, /data-layer=["']debug-overlay["']/i);
  assert.match(html, /WORLDSAT-01/);
});
