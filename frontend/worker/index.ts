/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import {handleSitesApi} from "../edge/api";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Sites serves the API itself using D1 and on-demand SGP4. The Docker
    // gateway continues to route the same URLs to the existing Python stack.
    if (url.pathname.startsWith("/api/v1/")) {
      if (!env.DB) return Response.json({detail: "Sites D1 binding unavailable"}, {status: 503});
      return handleSitesApi(request, env.DB);
    }

    // Preserve the nginx map proxy contract for hosted Sites. The origin is
    // fixed, so user-supplied paths cannot turn this into an open HTTP proxy.
    if (url.pathname.startsWith("/map/openfreemap/")) {
      const path = url.pathname.slice("/map/openfreemap/".length);
      if (!/^[\w./-]+$/.test(path) || path.includes("..")) {
        return new Response("Invalid tile path", {status: 400});
      }
      const target = new URL("https://tiles.openfreemap.org/" + path);
      target.search = url.search;
      const upstream = await fetch(target.toString(), {headers: {Accept: request.headers.get("Accept") || "*/*"}});
      const headers = new Headers(upstream.headers);
      headers.delete("Set-Cookie");
      headers.set("Access-Control-Allow-Origin", "*");
      headers.set("Cache-Control", "public, max-age=3600");
      if (path.endsWith("/dark") || path.endsWith(".json")) {
        const text = (await upstream.text()).replaceAll("https://tiles.openfreemap.org", "/map/openfreemap");
        // The upstream body has been decoded and rewritten. Forwarding its
        // original gzip encoding or byte length would corrupt the basemap.
        headers.delete("Content-Encoding");
        headers.delete("Content-Length");
        headers.set("Content-Type", "application/json; charset=utf-8");
        return new Response(text, {status: upstream.status, headers});
      }
      return new Response(upstream.body, {status: upstream.status, headers});
    }

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }

    return handler.fetch(request, env, ctx);
  },
};

export default worker;
