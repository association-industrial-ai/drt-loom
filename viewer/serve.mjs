/**
 * Static file server for the viewer. Node standard library only, so `npm run
 * view` holds to the same promise as the rest of the repository: no network
 * access, no install step, nothing to trust.
 *
 *   node viewer/serve.mjs [port]      default 5173, or set PORT
 *
 * Serves the repository root, because the viewer reads ../data/generated.
 */

import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { join, normalize, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.argv[2] || process.env.PORT || 5173);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".nxjson": "application/json; charset=utf-8",
  ".cypher": "text/plain; charset=utf-8",
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    let rel = normalize(decodeURIComponent(url.pathname));

    // Refuse anything that climbs out of the repository.
    if (rel.includes("\0") || rel.split("/").includes("..")) {
      res.writeHead(400).end("Bad request");
      return;
    }
    if (rel === "/") rel = "/viewer/index.html";

    let file = join(ROOT, rel);
    let info = await stat(file).catch(() => null);
    if (info?.isDirectory()) {
      file = join(file, "index.html");
      info = await stat(file).catch(() => null);
    }
    if (!info?.isFile()) {
      res.writeHead(404, { "content-type": "text/plain" }).end(`Not found: ${rel}`);
      return;
    }

    res.writeHead(200, {
      "content-type": TYPES[extname(file).toLowerCase()] || "application/octet-stream",
      "content-length": info.size,
      "cache-control": "no-cache",
    });
    createReadStream(file).pipe(res);
  } catch (err) {
    res.writeHead(500, { "content-type": "text/plain" }).end(String(err));
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`DRT Loom viewer  →  http://localhost:${PORT}/viewer/`);
  console.log(`serving ${ROOT}`);
});
