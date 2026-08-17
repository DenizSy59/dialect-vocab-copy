import express from "express";
import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import { config } from "../config.js";
import { Video } from "../models/Video.js";
import { Segment } from "../models/Segment.js";
import { enqueueTranscription } from "../queue.js";

const router = express.Router();

fs.mkdirSync(config.uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, config.uploadDir),
  filename: (req, file, cb) => {
    // Keep the extension so ffmpeg can sniff the container, but not the
    // original name — uploaded names are user input and end up in shell-
    // adjacent places.
    const ext = path.extname(file.originalname).slice(0, 10);
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 10)}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 * 1024 }, // 2 GB
});

// Upload a video and queue it. Returns immediately with a queued video; the
// frontend polls GET /:id for progress. Transcribing takes minutes, so doing
// this synchronously would just time out.
router.post("/", upload.single("video"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "no file uploaded" });

    // "auto" is the default: the worker detects the language from the audio,
    // which is a question the software can answer without asking.
    const language = req.body.language || "auto";
    if (!["ko", "zh", "tr", "auto"].includes(language)) {
      return res.status(400).json({ error: "language must be ko, zh, tr or auto" });
    }

    // multer hands back originalname as latin1-decoded bytes, which turns any
    // Korean or Chinese filename into mojibake. Since those are exactly the
    // filenames this project gets, decode it back to utf8.
    const originalName = Buffer.from(req.file.originalname, "latin1").toString("utf8");

    const video = await Video.create({
      originalName,
      filename: req.file.filename,
      language,
      model: req.body.model || "auto",
      status: "queued",
      stage: "waiting for worker",
    });

    await enqueueTranscription({
      videoId: video._id.toString(),
      path: path.join(config.uploadDir, req.file.filename),
      language,
      model: video.model,
    });

    res.status(201).json(video);
  } catch (err) {
    console.error("upload failed:", err);
    res.status(500).json({ error: err.message });
  }
});

router.get("/", async (req, res) => {
  const videos = await Video.find().sort({ createdAt: -1 }).limit(50);
  res.json(videos);
});

router.get("/:id", async (req, res) => {
  const video = await Video.findById(req.params.id);
  if (!video) return res.status(404).json({ error: "not found" });
  res.json(video);
});

// Segments are fetched once when the player loads and then held in memory —
// the subtitle sync runs per animation frame and cannot be hitting the network.
router.get("/:id/segments", async (req, res) => {
  const segments = await Segment.find({ videoId: req.params.id }).sort({ start: 1 });
  res.json(segments);
});

router.delete("/:id", async (req, res) => {
  const video = await Video.findById(req.params.id);
  if (!video) return res.status(404).json({ error: "not found" });
  await Segment.deleteMany({ videoId: video._id });
  const file = path.join(config.uploadDir, video.filename);
  fs.promises.unlink(file).catch(() => {}); // already gone is fine
  await video.deleteOne();
  res.json({ ok: true });
});

export default router;
