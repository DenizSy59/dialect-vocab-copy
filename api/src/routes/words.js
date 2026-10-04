import express from "express";
import mongoose from "mongoose";
import path from "node:path";
import { SavedWord } from "../models/SavedWord.js";
import { Segment } from "../models/Segment.js";
import { Video } from "../models/Video.js";
import { DictionaryEntry } from "../models/DictionaryEntry.js";
import { cutClip } from "../clips.js";
import { config } from "../config.js";

const router = express.Router();

// FIX (TC11): reject malformed ids before they reach MongoDB. A bad id made
// findById throw, and in Express 4 an error thrown inside an async route is
// not caught, so it stopped the whole server.
router.param("id", (req, res, next, id) => {
  if (!mongoose.isValidObjectId(id)) return res.status(400).json({ error: "invalid id" });
  next();
});

// FIX (TC12, TC13): user input must be plain text. An object like
// {"$ne": null} would otherwise be read by MongoDB as a query.
const isText = (v) => typeof v === "string" && v.length > 0;

/* Look a word up, trying progressively looser forms.
 *
 * The lemma is what a dictionary is keyed on, which is why the pipeline
 * lemmatises at all. But plenty of real words still missed: Korean verbs are
 * stored with the 다 ending in some sources and without it in others, Chinese
 * words appear in traditional form, and lemmatising can simply go wrong. Each
 * of those was showing as "no dictionary entry" for a word that was in the
 * dictionary under a slightly different key.
 */
export async function lookup(language, lemma, surface) {
  const tried = new Set();
  const candidates = [];

  const push = (w) => {
    if (w && !tried.has(w)) {
      tried.add(w);
      candidates.push(w);
    }
  };

  push(lemma);
  push(surface);

  if (language === "ko") {
    // 먹다 <-> 먹: sources disagree on whether the citation form keeps 다.
    if (lemma?.endsWith("다")) push(lemma.slice(0, -1));
    else push(`${lemma}다`);
    if (surface?.endsWith("다")) push(surface.slice(0, -1));
  }

  if (language === "en") {
    push(lemma?.toLowerCase());
    push(surface?.toLowerCase());
  }

  for (const word of candidates) {
    const entry = await DictionaryEntry.findOne({ lang: language, word });
    if (entry) return entry;
  }
  return null;
}

/* Add one place a word was met.
 *
 * Same word met again in another scene appends an occurrence rather than
 * creating a second card — one card, several clips. Re-clicking the exact same
 * spot is ignored, since that is a double click rather than a new encounter.
 */
async function addOccurrence(language, token, occurrence) {
  const entry = await lookup(language, token.lemma, token.surface);

  const existing = await SavedWord.findOne({ language, lemma: token.lemma });
  if (existing) {
    const duplicate = existing.occurrences.some(
      (o) =>
        String(o.segmentId || "") === String(occurrence.segmentId || "") &&
        o.sentence === occurrence.sentence,
    );
    if (!duplicate) {
      existing.occurrences.push(occurrence);
      await existing.save();
    }
    return existing;
  }

  return SavedWord.create({
    language,
    lemma: token.lemma,
    surface: token.surface,
    pos: token.pos,
    reading: token.reading || "",
    senses: entry?.senses ?? [],
    pinyin: entry?.pinyin ?? "",
    occurrences: [occurrence],
  });
}

// Save a clicked word from a transcript. The sentence and timings are looked
// up here rather than trusted from the client, so a card always matches what is
// actually in the transcript.
router.post("/", async (req, res) => {
  try {
    const { videoId, segmentId, tokenIndex } = req.body;
    const segment = await Segment.findById(segmentId);
    if (!segment) return res.status(404).json({ error: "segment not found" });

    const token = segment.tokens[tokenIndex];
    if (!token) return res.status(400).json({ error: "bad tokenIndex" });

    const video = await Video.findById(videoId);
    const language = video?.language || "";

    // Confidence comes from the aligned word overlapping this token. Low scores
    // correlated with mis-transcriptions in Korean, so it is worth keeping.
    const overlapping = segment.words.filter(
      (w) =>
        w.start != null &&
        token.start != null &&
        w.start < (token.end ?? 0) &&
        (token.start ?? 0) < w.end,
    );
    const confidence = overlapping.length
      ? overlapping.reduce((a, w) => a + (w.score ?? 0), 0) / overlapping.length
      : null;

    const saved = await addOccurrence(language, token, {
      videoId,
      segmentId,
      surface: token.surface,
      sentence: segment.text,
      sentenceTranslation: segment.translation || segment.english || "",
      start: token.start,
      end: token.end,
      sentenceStart: segment.start,
      sentenceEnd: segment.end,
      source: "upload",
      confidence,
    });

    res.status(201).json(saved);
  } catch (err) {
    console.error("save word failed:", err);
    res.status(500).json({ error: err.message });
  }
});

/* Saved from a streaming platform. No video and no timings — DRM leaves only
 * the subtitle text — so this stores what it can and leaves the clip fields
 * empty rather than pretending.
 */
router.post("/external", async (req, res) => {
  try {
    const { language, lemma, surface, pos, reading, sentence, source, sourceUrl } = req.body;
    if (!isText(language) || !isText(lemma)) {
      return res.status(400).json({ error: "language and lemma are required, as text" });
    }

    const saved = await addOccurrence(
      language,
      { lemma, surface: surface || lemma, pos: pos || "", reading: reading || "" },
      {
        surface: surface || lemma,
        sentence: sentence || "",
        source: source || "extension",
        sourceUrl: sourceUrl || "",
      },
    );

    res.status(201).json(saved);
  } catch (err) {
    console.error("external save failed:", err);
    res.status(500).json({ error: err.message });
  }
});

/* Remove one encounter, or the whole card when it was the last one.
 *
 * Clicking a saved word again should undo the click, not delete every clip of
 * that word collected from elsewhere.
 */
router.post("/unsave", async (req, res) => {
  try {
    const { language, lemma, segmentId, sentence } = req.body;
    if (!isText(language) || !isText(lemma)) {
      return res.status(400).json({ error: "language and lemma are required, as text" });
    }
    // FIX (TC15): say WHICH occurrence to remove. With neither field the
    // filter below removed every occurrence and deleted the whole card.
    if (!isText(segmentId) && !isText(sentence)) {
      return res.status(400).json({ error: "segmentId or sentence is required" });
    }
    const word = await SavedWord.findOne({ language, lemma });
    if (!word) return res.json({ removed: false, remaining: 0 });

    const before = word.occurrences.length;
    word.occurrences = word.occurrences.filter((o) => {
      if (segmentId) return String(o.segmentId || "") !== String(segmentId);
      if (sentence) return o.sentence !== sentence;
      return false;
    });

    if (word.occurrences.length === 0) {
      await word.deleteOne();
      return res.json({ removed: true, remaining: 0, deleted: true });
    }
    await word.save();
    res.json({ removed: word.occurrences.length < before, remaining: word.occurrences.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/", async (req, res) => {
  const { language, videoId } = req.query;
  // FIX (TC14): same crash as TC11, through the query string this time.
  if (videoId !== undefined && !mongoose.isValidObjectId(videoId)) {
    return res.status(400).json({ error: "invalid videoId" });
  }
  if (language !== undefined && typeof language !== "string") {
    return res.status(400).json({ error: "invalid language" });
  }
  const filter = {};
  if (language) filter.language = language;
  if (videoId) filter["occurrences.videoId"] = videoId;
  const words = await SavedWord.find(filter).sort({ updatedAt: -1 }).lean();
  res.json(words);
});

router.delete("/:id", async (req, res) => {
  await SavedWord.findByIdAndDelete(req.params.id);
  res.json({ ok: true });
});

/* The clip for one occurrence of a word.
 *
 * Cut on first request and reused after that, so the first play costs a second
 * or two and every later one is instant. The index selects which encounter —
 * the same word in a different scene is a different clip.
 */
router.get("/:id/clip", async (req, res) => {
  try {
    const index = Number(req.query.i || 0);
    const word = await SavedWord.findById(req.params.id);
    if (!word) return res.status(404).json({ error: "word not found" });

    const occ = word.occurrences[index];
    if (!occ) return res.status(404).json({ error: "no such occurrence" });
    if (!occ.videoId) {
      // Streaming route: DRM means there is no readable video to cut from.
      return res.status(409).json({ error: "no clip — saved from a streaming platform" });
    }

    const video = await Video.findById(occ.videoId);
    if (!video) return res.status(404).json({ error: "source video is gone" });

    const clipPath = await cutClip({
      sourcePath: path.join(config.uploadDir, video.filename),
      start: occ.sentenceStart,
      end: occ.sentenceEnd,
      outName: `${word._id}-${index}.mp4`,
    });

    if (!occ.clipPath) {
      occ.clipPath = path.basename(clipPath);
      await word.save();
    }

    // sendFile handles range requests, which the video element needs to seek.
    res.sendFile(clipPath);
  } catch (err) {
    console.error("clip failed:", err);
    res.status(500).json({ error: err.message });
  }
});

// Anki import accepts tab separated values. Tabs and newlines inside a field
// would break the row, so they are stripped rather than quoted — Anki's TSV
// reader does not handle quoting the way a CSV reader would.
function ankiField(text) {
  return String(text ?? "").replace(/[\t\r\n]+/g, " ").trim();
}

router.get("/export", async (req, res) => {
  const filter = {};
  if (typeof req.query.language === "string") filter.language = req.query.language;
  const words = await SavedWord.find(filter).sort({ createdAt: 1 }).lean();

  // Column order is the card layout: front, reading, meaning, then the
  // sentence it came from. A card without the meaning column would send the
  // learner back to a dictionary, which is what this exists to avoid.
  const rows = words.map((w) => {
    const first = w.occurrences?.[0] || {};
    return [
      ankiField(w.lemma),
      ankiField(w.pinyin || w.reading),
      ankiField(w.senses.join("; ")),
      ankiField(first.sentence),
      ankiField(first.sentenceTranslation),
      ankiField(w.pos),
      String(w.occurrences?.length || 0),
    ].join("\t");
  });

  res.setHeader("Content-Type", "text/tab-separated-values; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="vocabulary.tsv"');
  res.send(rows.join("\n"));
});

export default router;
