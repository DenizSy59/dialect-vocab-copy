import mongoose from "mongoose";

// A word the learner clicked and kept. The sentence and the timings are stored
// with it because that is the whole point — a bare word on a flashcard is much
// harder to learn than one with the moment it was said attached.
const savedWordSchema = new mongoose.Schema(
  {
    videoId: { type: mongoose.Schema.Types.ObjectId, ref: "Video", index: true },
    segmentId: { type: mongoose.Schema.Types.ObjectId, ref: "Segment" },

    lemma: { type: String, required: true, index: true },
    surface: String, // the inflected form as it appeared
    pos: String,

    sentence: String, // the full segment text, for context on the card
    sentenceEnglish: { type: String, default: "" }, // second track, if available
    start: Number, // word timing within the video
    end: Number,

    // Segment bounds, used when cutting the clip — a clip of just the word is
    // too short to be useful, so the sentence is the natural unit.
    sentenceStart: Number,
    sentenceEnd: Number,

    // Copied from the dictionary at save time rather than looked up on read.
    // The card should keep the meaning it had when it was made, and the Anki
    // export has to be self-contained once it leaves the app.
    senses: { type: [String], default: [] },
    pinyin: { type: String, default: "" },

    // Cut on demand by ffmpeg when requested, not upfront.
    clipPath: { type: String, default: "" },

    // Alignment confidence of the underlying word. Low values are worth
    // surfacing: in Korean the mis-transcribed words scored far below the rest,
    // so this is a hint that the saved word may not be what was actually said.
    confidence: { type: Number, default: null },
  },
  { timestamps: true },
);

// One entry per lemma per video — clicking the same word twice should not
// create duplicates.
savedWordSchema.index({ videoId: 1, lemma: 1 }, { unique: true });

export const SavedWord = mongoose.model("SavedWord", savedWordSchema);
