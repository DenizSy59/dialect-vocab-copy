import express from "express";
import { lookup } from "./words.js";

const router = express.Router();

// Preview a definition without saving. The frontend calls this on hover, so a
// learner can decide whether a word is worth keeping before it lands in the
// deck — otherwise the deck fills with words they already knew.
router.get("/", async (req, res) => {
  const { lang, word, surface } = req.query;
  if (!lang || !word) {
    return res.status(400).json({ error: "lang and word are required" });
  }
  const entry = await lookup(lang, word, surface);
  if (!entry) return res.json({ found: false, word });
  res.json({
    found: true,
    word: entry.word,
    pinyin: entry.pinyin || "",
    senses: entry.senses || [],
  });
});

export default router;
