import express from "express";
import cors from "cors";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";

const here = path.dirname(fileURLToPath(import.meta.url));
import { connectDb } from "./db.js";
import videosRouter from "./routes/videos.js";
import wordsRouter from "./routes/words.js";
import dictionaryRouter from "./routes/dictionary.js";
import tokeniseRouter from "./routes/tokenise.js";
import curriculumRouter from "./routes/curriculum.js";

const app = express();

app.use(cors());
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

app.get("/api/health", (req, res) => {
  res.json({ ok: true, model: config.defaultModel });
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
  app.listen(config.port, () => {
    console.log(`api listening on http://localhost:${config.port}`);
  });
}

main().catch((err) => {
  console.error("failed to start:", err);
  process.exit(1);
});
