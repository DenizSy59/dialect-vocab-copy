import mongoose from "mongoose";

/* One place a word was met.
 *
 * A word is worth more the more times you have run into it, and the second
 * encounter is often what makes it stick. So a saved word keeps every place it
 * was clicked rather than only the first, each with its own sentence and its
 * own clip. Watching the same word in two different scenes is the point.
 */
const occurrenceSchema = new mongoose.Schema(
  {
    videoId: { type: mongoose.Schema.Types.ObjectId, ref: "Video", default: null },
    segmentId: { type: mongoose.Schema.Types.ObjectId, ref: "Segment", default: null },

    surface: String, // the inflected form as it appeared here
    sentence: String,
    sentenceTranslation: { type: String, default: "" },

    start: Number, // word timing within the video
    end: Number,
    // Segment bounds, used when cutting the clip — a clip of just the word is
    // too short to be useful, so the sentence is the natural unit.
    sentenceStart: Number,
    sentenceEnd: Number,

    source: { type: String, default: "upload" }, // upload | netflix | viki | ...
    sourceUrl: { type: String, default: "" },

    // Cut on demand by ffmpeg when first played, not upfront.
    clipPath: { type: String, default: "" },

    // Alignment confidence of the underlying word. Low values are worth
    // surfacing: in Korean the mis-transcribed words scored far below the rest.
    confidence: { type: Number, default: null },

    addedAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

/* A word the learner kept.
 *
 * Keyed on (language, lemma) rather than on the video it came from. Clicking
 * 사람 in two different videos should build one card with two clips, not two
 * cards that both claim to teach the same word.
 */
const savedWordSchema = new mongoose.Schema(
  {
    language: { type: String, required: true, index: true },
    lemma: { type: String, required: true, index: true },
    surface: String, // the form of the first occurrence
    pos: String,
    reading: { type: String, default: "" },

    // Copied from the dictionary at save time rather than looked up on read.
    // The card should keep the meaning it had when it was made, and the Anki
    // export has to be self-contained once it leaves the app.
    senses: { type: [String], default: [] },
    pinyin: { type: String, default: "" },

    occurrences: { type: [occurrenceSchema], default: [] },
  },
  { timestamps: true },
);

// One card per word per language.
savedWordSchema.index({ language: 1, lemma: 1 }, { unique: true });

export const SavedWord = mongoose.model("SavedWord", savedWordSchema);
