import express from "express";
import mongoose from "mongoose";
import { translate } from "../tokeniser.js";
import { detectScript } from "./tokenise.js";

const router = express.Router();

/* Translate subtitle lines into whichever language you want to read.
 *
 * The second subtitle track used to be fixed at upload: you picked a target
 * before you had seen the video and could not change it afterwards. That is the
 * wrong time to ask — which language you want to lean on depends on how hard
 * the video turns out to be.
 *
 * Results are cached in Mongo by (text, source, target). Subtitle lines repeat
 * constantly within a video and across rewatches, and translation is the
 * slowest thing in this path, so the cache earns its place quickly.
 */
const TranslationCache = mongoose.model(
  "TranslationCache",
  new mongoose.Schema(
    {
      text: String,
      source: String,
      target: String,
      result: String,
    },
    { collection: "translations", timestamps: true },
  ).index({ text: 1, source: 1, target: 1 }, { unique: true }),
);

router.post("/", async (req, res) => {
  try {
    const { texts, target } = req.body;
    let { source } = req.body;

    if (!Array.isArray(texts) || !texts.length) {
      return res.status(400).json({ error: "texts must be a non-empty array" });
    }
    if (!["en", "tr", "zh", "ko"].includes(target)) {
      return res.status(400).json({ error: "unsupported target language" });
    }

    // Same reasoning as tokenising: the script is more reliable than whatever
    // the caller believes the language to be.
    source = detectScript(texts.join(" ").slice(0, 400), source || "en");

    if (source === target) {
      return res.json({ source, target, texts, cached: texts.length });
    }

    const cached = await TranslationCache.find({
      source,
      target,
      text: { $in: texts },
    }).lean();
    const byText = Object.fromEntries(cached.map((c) => [c.text, c.result]));

    const missing = [...new Set(texts.filter((t) => t.trim() && !byText[t]))];

    if (missing.length) {
      const results = await translate(missing, source, target);
      const rows = missing.map((text, i) => ({
        text,
        source,
        target,
        result: results[i] || "",
      }));
      for (const r of rows) byText[r.text] = r.result;
      // Unordered so one duplicate key does not discard the rest of the batch.
      TranslationCache.insertMany(rows, { ordered: false }).catch(() => {});
    }

    res.json({
      source,
      target,
      texts: texts.map((t) => byText[t] ?? ""),
      cached: texts.length - missing.length,
    });
  } catch (err) {
    console.error("translate failed:", err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
