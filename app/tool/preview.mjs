// Browser preview of the BagSpec app, for checking screens in Chrome's
// phone view. Serves the web build and forwards API calls to a BagSpec
// Worker on the same origin, so the browser never makes a cross-site call.
//
//   cd app
//   flutter build web --dart-define=BAGSPEC_API=
//   node tool/preview.mjs                      # uses https://bagspec.com
//   node tool/preview.mjs http://127.0.0.1:8787  # a local `wrangler dev`
//
// Then open http://localhost:8790. Push notifications only work on iPhone.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const target = new URL(process.argv[2] || "https://bagspec.com");
const port = Number(process.env.PORT || 8790);
const root = fileURLToPath(new URL("../build/web/", import.meta.url));
const API = /^\/(deals|listings|diagnostics|api)(\/|$|\?)/;
const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript",
  ".json": "application/json", ".wasm": "application/wasm", ".png": "image/png",
  ".ico": "image/x-icon", ".svg": "image/svg+xml", ".otf": "font/otf", ".ttf": "font/ttf",
  ".frag": "application/octet-stream", ".bin": "application/octet-stream",
};

async function forward(req, res) {
  const body = await new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c)).on("end", () => resolve(Buffer.concat(chunks)));
  });
  const headers = {};
  for (const name of ["authorization", "content-type", "x-bagspec-quiet"]) {
    if (req.headers[name]) headers[name] = req.headers[name];
  }
  try {
    const upstream = await fetch(new URL(req.url, target), {
      method: req.method,
      headers,
      body: ["GET", "HEAD"].includes(req.method) ? undefined : body,
      redirect: "manual",
    });
    // Drop the login prompt header so the browser doesn't pop its own box.
    const out = {};
    upstream.headers.forEach((value, name) => {
      if (!["www-authenticate", "content-encoding", "content-length", "transfer-encoding"].includes(name)) out[name] = value;
    });
    res.writeHead(upstream.status, out).end(Buffer.from(await upstream.arrayBuffer()));
  } catch (error) {
    res.writeHead(502, { "content-type": "application/json" })
      .end(JSON.stringify({ error: `Could not reach ${target.origin}: ${error.message}` }));
  }
}

async function serveFile(req, res) {
  const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  const file = normalize(join(root, path === "/" ? "index.html" : path));
  if (!file.startsWith(normalize(root))) return res.writeHead(403).end();
  try {
    const data = await readFile(file);
    res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream", "cache-control": "no-store" }).end(data);
  } catch {
    try {
      // Unknown paths load the app (Flutter handles its own routes).
      res.writeHead(200, { "content-type": TYPES[".html"] }).end(await readFile(join(root, "index.html")));
    } catch {
      res.writeHead(500).end("No web build yet. Run: flutter build web --dart-define=BAGSPEC_API=");
    }
  }
}

createServer((req, res) => (API.test(req.url) ? forward(req, res) : serveFile(req, res)))
  .listen(port, "127.0.0.1", () => {
    console.log(`BagSpec app preview: http://localhost:${port}  (API: ${target.origin})`);
  });
