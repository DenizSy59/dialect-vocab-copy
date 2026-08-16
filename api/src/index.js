import express from "express";
import cors from "cors";
import { config } from "./config.js";
import { connectDb } from "./db.js";
import videosRouter from "./routes/videos.js";
import wordsRouter from "./routes/words.js";

const app = express();

app.use(cors());
app.use(express.json());

// Serving uploads through express.static rather than a custom handler because
// the player needs HTTP range requests to seek, and static already does that.
app.use("/media", express.static(config.uploadDir, { acceptRanges: true }));

app.use("/api/videos", videosRouter);
app.use("/api/words", wordsRouter);

app.get("/api/health", (req, res) => {
  res.json({ ok: true, model: config.defaultModel });
});

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
