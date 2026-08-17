import mongoose from "mongoose";

// One uploaded file and the state of its transcription job. The frontend polls
// this for progress, so status and progress are the fields that matter most.
const videoSchema = new mongoose.Schema(
  {
    originalName: { type: String, required: true },
    filename: { type: String, required: true }, // on disk, under uploadDir
    // "auto" until the worker detects it, then replaced with the real code.
    language: { type: String, enum: ["ko", "zh", "tr", "auto"], required: true },
    languageConfidence: { type: Number, default: null },
    model: { type: String, default: "auto" },
    target: { type: String, default: "en" }, // second subtitle track language

    status: {
      type: String,
      enum: ["queued", "processing", "done", "error"],
      default: "queued",
      index: true,
    },
    progress: { type: Number, default: 0 }, // 0-100, coarse
    stage: { type: String, default: "" }, // human readable: "transcribing" etc
    error: { type: String, default: "" },

    durationSec: Number,

    // Copied off the pipeline result so the UI can show quality information
    // without loading every segment.
    coverage: {
      tokensTotal: Number,
      tokensWithTiming: Number,
      tokensPct: Number,
      contentTotal: Number,
      contentWithTiming: Number,
      contentPct: Number,
    },
    // Text-marker heuristic, not a trained classifier. `method` and `caveat`
    // are stored with the result and shown in the UI, because a dialect claim
    // without its basis is not something a learner or a supervisor can check.
    dialect: {
      available: Boolean,
      detected: Boolean,
      dialect: String,
      label: String,
      score: Number,
      standardScore: Number,
      method: String,
      caveat: String,
      evidence: [{ marker: String, count: Number, weight: Number }],
    },

    timing: {
      transcribeSec: Number,
      alignSec: Number,
      computeSec: Number,
      totalSec: Number,
      computeRealtimeFactor: Number,
    },
  },
  { timestamps: true },
);

export const Video = mongoose.model("Video", videoSchema);
