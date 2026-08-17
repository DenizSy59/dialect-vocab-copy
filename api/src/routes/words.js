import express from "express";
import path from "node:path";
import { SavedWord } from "../models/SavedWord.js";
import { Segment } from "../models/Segment.js";
import { Video } from "../models/Video.js";
import { DictionaryEntry } from "../models/DictionaryEntry.js";
import { cutClip } from "../clips.js";
import { config } from "../config.js";

const router = express.Router();

/* Look a word up, trying the lemma before the surface form.
 *
 * The lemma is what a dictionary is keyed on, which is the whole reason the
 * pipeline lemmatises. But lemmatising can go wrong — a merged proper noun or a
 * mis-stemmed verb — so the surface form is worth a second try before giving up.
 */
export async function lookup(language, lemma, surface) {
  const candidates = [lemma, surface].filter(Boolean);
  for (const word of candidates) {
    const entry = await DictionaryEntry.findOne({ lang: language, word });
    if (entry) return entry;
  }
  return null;
}

// Save a clicked word. The client sends the segment and which token inside it
// was clicked; the sentence and timings are looked up here rather than trusted
// from the client, so a saved card always matches what is actually in the
// transcript.
router.post("/", async (req, res) => {
  try {
    const { videoId, segmentId, tokenIndex } = req.body;
    const segment = await Segment.findById(segmentId);
    if (!segment) return res.status(404).json({ error: "segment not found" });

    const token = segment.tokens[tokenIndex];
    if (!token) return res.status(400).json({ error: "bad tokenIndex" });

    // Confidence comes from the aligned word overlapping this token. Worth
    // keeping: low scores correlated with mis-transcriptions in Korean.
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

    const video = await Video.findById(videoId);
    const entry = await lookup(video?.language, token.lemma, token.surface);

    const saved = await SavedWord.findOneAndUpdate(
      { videoId, source: "upload", lemma: token.lemma },
      {
        videoId,
        segmentId,
        lemma: token.lemma,
        surface: token.surface,
        pos: token.pos,
        senses: entry?.senses ?? [],
        pinyin: entry?.pinyin ?? "",
        sentence: segment.text,
        sentenceEnglish: segment.english || "",
        start: token.start,
        end: token.end,
        sentenceStart: segment.start,
        sentenceEnd: segment.end,
        confidence,
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );

    res.status(201).json(saved);
  } catch (err) {
    console.error("save word failed:", err);
    res.status(500).json({ error: err.message });
  }
});

// Saved from the browser extension. There is no video and no timings — DRM
// leaves only the subtitle text — so this stores what it can and is honest
// about the rest by leaving the clip fields empty.
router.post("/external", async (req, res) => {
  try {
    const { language, lemma, surface, pos, sentence, source, sourceUrl } = req.body;
    if (!language || !lemma) {
      return res.status(400).json({ error: "language and lemma are required" });
    }
    const entry = await lookup(language, lemma, surface);
    const saved = await SavedWord.findOneAndUpdate(
      { videoId: null, source: source || "extension", lemma },
      {
        videoId: null,
        segmentId: null,
        language,
        lemma,
        surface: surface || lemma,
        pos: pos || "",
        sentence: sentence || "",
        source: source || "extension",
        sourceUrl: sourceUrl || "",
        senses: entry?.senses ?? [],
        pinyin: entry?.pinyin ?? "",
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    res.status(201).json(saved);
  } catch (err) {
    console.error("external save failed:", err);
    res.status(500).json({ error: err.message });
  }
});

router.get("/", async (req, res) => {
  const filter = req.query.videoId ? { videoId: req.query.videoId } : {};
  const words = await SavedWord.find(filter).sort({ createdAt: -1 });
  res.json(words);
});

router.delete("/:id", async (req, res) => {
  await SavedWord.findByIdAndDelete(req.params.id);
  res.json({ ok: true });
});

// The clip for a saved word. Cut on first request and reused after that, so the
// first play of a word costs a second or two and every later one is instant.
router.get("/:id/clip", async (req, res) => {
  try {
    const word = await SavedWord.findById(req.params.id);
    if (!word) return res.status(404).json({ error: "word not found" });

    const video = await Video.findById(word.videoId);
    if (!video) return res.status(404).json({ error: "source video is gone" });

    const clipPath = await cutClip({
      sourcePath: path.join(config.uploadDir, video.filename),
      start: word.sentenceStart,
      end: word.sentenceEnd,
      outName: `${word._id}.mp4`,
    });

    if (!word.clipPath) {
      word.clipPath = path.basename(clipPath);
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
  const filter = req.query.videoId ? { videoId: req.query.videoId } : {};
  const words = await SavedWord.find(filter).sort({ createdAt: 1 });

  // Column order is the card layout: front, then reading, then meaning, then
  // the sentence it came from. A card without the meaning column would send the
  // learner back to a dictionary, which is the thing this is meant to avoid.
  const rows = words.map((w) =>
    [
      ankiField(w.lemma),
      ankiField(w.pinyin),
      ankiField(w.senses.join("; ")),
      ankiField(w.sentence),
      ankiField(w.sentenceEnglish),
      ankiField(w.surface),
      ankiField(w.pos),
      w.start != null ? w.start.toFixed(2) : "",
    ].join("\t"),
  );

  res.setHeader("Content-Type", "text/tab-separated-values; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="vocabulary.tsv"');
  res.send(rows.join("\n"));
});

export default router;
