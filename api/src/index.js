import express from "express";
import cors from "cors";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";

const here = path.dirname(fileURLToPath(import.meta.url));
import { connectDb } from "./db.js";
import { transcriptionQueue } from "./queue.js";
import videosRouter from "./routes/videos.js";
import wordsRouter from "./routes/words.js";
import dictionaryRouter from "./routes/dictionary.js";
import tokeniseRouter from "./routes/tokenise.js";
import curriculumRouter from "./routes/curriculum.js";
import translateRouter from "./routes/translate.js";

const app = express();

// FIX (TC17): only the app's own pages, the browser extension, and the
// streaming sites the extension runs on may call the API from a browser.
// cors() with no options let EVERY website read and delete saved words.
const ALLOWED_ORIGINS = [
  /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/,
  /^chrome-extension:\/\//,
  /^https:\/\/www\.(netflix|primevideo|viki|iq|gagaoolala)\.com$/,
];
app.use(
  cors({
    origin: (origin, cb) => {
      // No Origin header: same-origin page, curl, the tests. Not a browser
      // request from another website, so nothing to block.
      if (!origin) return cb(null, true);
      cb(null, ALLOWED_ORIGINS.some((re) => re.test(origin)));
    },
  }),
);
app.use(express.json());

// One line per API call. Added while debugging whether the browser extension
// was reaching the server at all — without it, "nothing happens" and "nothing
// was even requested" look identical, and they need completely different fixes.
// Static assets are skipped so the log stays readable.
app.use((req, res, next) => {
  if (!req.path.startsWith("/api/")) return next();
  const started = Date.now();
  res.on("finish", () => {
    console.log(
      `${new Date().toISOString().slice(11, 19)} ${req.method} ${req.path} ` +
        `${res.statusCode} ${Date.now() - started}ms`,
    );
  });
  next();
});

// Serving uploads through express.static rather than a custom handler because
// the player needs HTTP range requests to seek, and static already does that.
app.use("/media", express.static(config.uploadDir, { acceptRanges: true }));

app.use("/api/videos", videosRouter);
app.use("/api/words", wordsRouter);
app.use("/api/dictionary", dictionaryRouter);
app.use("/api/tokenise", tokeniseRouter);
app.use("/api/curriculum", curriculumRouter);
app.use("/api/translate", translateRouter);

/* Health, including whether the worker is alive.
 *
 * The worker died silently after a job once and nothing showed it: the API
 * stayed up, the UI looked normal, and uploads would have queued forever. A
 * status that only reports the process answering the request is not a health
 * check.
 *
 * Liveness is inferred from the queue rather than from a process handle,
 * because the worker is a separate Python process that may not even be on this
 * machine. If jobs are waiting and none has been picked up, something is wrong
 * whatever the cause.
 */
app.get("/api/health", async (req, res) => {
  let worker = { alive: null, waiting: 0, active: 0 };
  try {
    const [waiting, active] = await Promise.all([
      transcriptionQueue.getWaitingCount(),
      transcriptionQueue.getActiveCount(),
    ]);
    // The worker's own heartbeat, not getWorkers(). The Python client does not
    // register the way the Node one does, so getWorkers() reported zero while
    // the worker was happily processing jobs.
    const beat = await transcriptionQueue.client.then((c) =>
      c.get("lexicon:worker:alive"),
    );
    worker = { alive: beat === "1", waiting, active };
  } catch (e) {
    worker.error = e.message;
  }
  res.json({ ok: true, model: config.defaultModel, worker });
});

// Serve the built frontend from the same origin. Handy for the demo — one
// process to start on the presenting machine — and it removes the cross-origin
// question for the video element entirely. Run `npm run build` in web/ first.
const webDist = path.join(here, "..", "..", "web", "dist");
if (fs.existsSync(webDist)) {
  app.use(express.static(webDist));
  // Single page app: anything that is not an API or media path is the client's
  // to route, so hand back index.html rather than 404.
  app.get(/^\/(?!api|media).*/, (req, res) => {
    res.sendFile(path.join(webDist, "index.html"));
  });
  console.log(`serving frontend from ${webDist}`);
}

async function main() {
  await connectDb();
  // FIX (TC18): listen on this computer only. With no address, Node listened
  // on every network interface, so anyone on the same Wi-Fi could open the
  // API, watch uploaded videos through /media, and delete saved words.
  app.listen(config.port, config.host, () => {
    console.log(`api listening on http://localhost:${config.port}`);
  });
}

main().catch((err) => {
  console.error("failed to start:", err);
  process.exit(1);
});
