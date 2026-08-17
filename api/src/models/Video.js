import mongoose from "mongoose";

// One uploaded file and the state of its transcription job. The frontend polls
// this for progress, so status and progress are the fields that matter most.
const videoSchema = new mongoose.Schema(
  {
    originalName: { type: String, required: true },
    filename: { type: String, required: true }, // on disk, under uploadDir
    language: { type: String, enum: ["ko", "zh"], required: true },
    model: { type: String, default: "small" },

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
