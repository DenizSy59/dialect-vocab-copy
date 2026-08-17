import mongoose from "mongoose";

// A word as the aligner produced it. Kept alongside tokens because the aligner
// splits Chinese per character and Korean per spacing unit, which does not match
// what the tokeniser considers a word — both views are needed.
const wordSchema = new mongoose.Schema(
  {
    word: String,
    start: Number,
    end: Number,
    score: Number, // alignment confidence; low values often mean a misheard word
  },
  { _id: false },
);

// A token as the tokeniser produced it. This is what the UI makes clickable.
const tokenSchema = new mongoose.Schema(
  {
    surface: String, // as it appears in the subtitle
    lemma: String, // dictionary form, what gets saved
    pos: String,
    charStart: Number,
    charEnd: Number,
    content: Boolean, // worth offering as vocabulary
    start: Number, // word timing, may be null if alignment missed it
    end: Number,
  },
  { _id: false },
);

const segmentSchema = new mongoose.Schema({
  videoId: { type: mongoose.Schema.Types.ObjectId, ref: "Video", index: true },
  index: Number,
  start: Number,
  end: Number,
  text: String,
  words: [wordSchema],
  tokens: [tokenSchema],

  // Filled in by the difficulty scorer later. Null until then, so the timeline
  // strip can tell "not scored" from "scored as easy".
  difficulty: { type: Number, default: null },
});

// The player asks for segments in playback order constantly.
segmentSchema.index({ videoId: 1, start: 1 });

export const Segment = mongoose.model("Segment", segmentSchema);
