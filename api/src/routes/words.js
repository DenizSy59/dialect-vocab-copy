import express from "express";
import { SavedWord } from "../models/SavedWord.js";
import { Segment } from "../models/Segment.js";

const router = express.Router();

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

    const saved = await SavedWord.findOneAndUpdate(
      { videoId, lemma: token.lemma },
      {
        videoId,
        segmentId,
        lemma: token.lemma,
        surface: token.surface,
        pos: token.pos,
        sentence: segment.text,
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

router.get("/", async (req, res) => {
  const filter = req.query.videoId ? { videoId: req.query.videoId } : {};
  const words = await SavedWord.find(filter).sort({ createdAt: -1 });
  res.json(words);
});

router.delete("/:id", async (req, res) => {
  await SavedWord.findByIdAndDelete(req.params.id);
  res.json({ ok: true });
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

  const rows = words.map((w) =>
    [
      ankiField(w.lemma),
      ankiField(w.surface),
      ankiField(w.pos),
      ankiField(w.sentence),
      w.start != null ? w.start.toFixed(2) : "",
    ].join("\t"),
  );

  res.setHeader("Content-Type", "text/tab-separated-values; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="vocabulary.tsv"');
  res.send(rows.join("\n"));
});

export default router;
