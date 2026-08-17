import mongoose from "mongoose";

// Read-only from the API's point of view. Built by ml/src/build_dictionary.py
// from CC-CEDICT (Chinese, CC BY-SA 4.0) and Wiktionary via kaikki.org
// (Korean, CC BY-SA 3.0). Both need attribution in the report.
const dictionaryEntrySchema = new mongoose.Schema(
  {
    lang: { type: String, enum: ["ko", "zh"] },
    word: String,
    pos: String,
    pinyin: String,
    senses: [String],
  },
  { collection: "dictionary" },
);

dictionaryEntrySchema.index({ lang: 1, word: 1 });

export const DictionaryEntry = mongoose.model("DictionaryEntry", dictionaryEntrySchema);
