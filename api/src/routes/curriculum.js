import express from "express";
import mongoose from "mongoose";
import { DictionaryEntry } from "../models/DictionaryEntry.js";
import { Segment } from "../models/Segment.js";
import { SavedWord } from "../models/SavedWord.js";
import { lookup } from "./words.js";

const router = express.Router();

/* The levelled curriculum, and quizzes built from it.
 *
 * The app's normal loop mines words from whatever video you happened to watch.
 * That is good for memory and bad for coverage — you learn what was said, in
 * the order it was said. A curriculum gives the other half: a defined set of
 * words in a sensible order, so "how far along am I" has an answer.
 *
 * The part that is not like Duolingo or Voscreen: quiz questions are built from
 * sentences in videos **you** transcribed, not from a fixed sentence bank. The
 * same word gets a different example depending on what you have watched, and
 * where the video was uploaded there is a real clip of it being said.
 */

const Curriculum = mongoose.model(
  "Curriculum",
  new mongoose.Schema({}, { collection: "curriculum", strict: false }),
);

const Progress = mongoose.model(
  "Progress",
  new mongoose.Schema(
    {
      lang: { type: String, index: true },
      word: String,
      // seen -> answered right at least once; known -> right three times.
      // Deliberately coarse: real spaced repetition needs intervals and ease
      // factors, and a half-built version that forgets state between sessions
      // would be worse than an honest counter.
      correct: { type: Number, default: 0 },
      wrong: { type: Number, default: 0 },
      status: { type: String, default: "learning" },
    },
    { timestamps: true, collection: "progress" },
  ),
);

Progress.schema.index({ lang: 1, word: 1 }, { unique: true });

/* Every language that has a course, with its progress.
 *
 * The course used to open on Korean with a dropdown to change it, which buried
 * the other three and made the language feel like a setting rather than the
 * choice it is. This mirrors the deck: pick the language, then work inside it.
 */
router.get("/languages", async (req, res) => {
  try {
    const totals = await Curriculum.aggregate([
      {
        $group: {
          _id: "$lang",
          total: { $sum: 1 },
          levels: { $addToSet: "$level" },
          standard: { $first: "$standard" },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    const progress = await Progress.aggregate([
      { $match: { status: "known" } },
      { $group: { _id: "$lang", known: { $sum: 1 } } },
    ]);
    const knownByLang = Object.fromEntries(progress.map((p) => [p._id, p.known]));

    res.json({
      languages: totals.map((t) => ({
        lang: t._id,
        total: t.total,
        levels: t.levels.length,
        known: knownByLang[t._id] || 0,
        standard: t.standard,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Levels with counts and how much of each is done.
router.get("/", async (req, res) => {
  try {
    const lang = req.query.lang || "zh";

    const levels = await Curriculum.aggregate([
      { $match: { lang } },
      {
        $group: {
          _id: "$level",
          total: { $sum: 1 },
          standard: { $first: "$standard" },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    const done = await Progress.find({ lang, status: "known" }, "word").lean();
    const knownSet = new Set(done.map((d) => d.word));

    // Counting per level needs the words themselves; levels are small enough
    // that fetching the words beats a second aggregation with a $lookup.
    const words = await Curriculum.find({ lang }, "word level").lean();
    const knownByLevel = {};
    for (const w of words) {
      if (knownSet.has(w.word)) {
        knownByLevel[w.level] = (knownByLevel[w.level] || 0) + 1;
      }
    }

    res.json({
      lang,
      levels: levels.map((l) => ({
        level: l._id,
        total: l.total,
        known: knownByLevel[l._id] || 0,
        standard: l.standard,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// The words in one level, with meanings and whether they appear in your videos.
router.get("/level/:level", async (req, res) => {
  try {
    const lang = req.query.lang || "zh";
    const level = Number(req.params.level);

    const words = await Curriculum.find({ lang, level })
      .sort({ index: 1 })
      .limit(400)
      .lean();

    const list = words.map((w) => w.word);
    const [entries, progress, seenIn] = await Promise.all([
      DictionaryEntry.find({ lang, word: { $in: list } }).lean(),
      Progress.find({ lang, word: { $in: list } }).lean(),
      // Which of these you have actually met on screen. This is the bridge
      // between the curriculum and the video side of the app.
      Segment.find({ "tokens.lemma": { $in: list } }, "tokens.lemma").lean(),
    ]);

    const senses = Object.fromEntries(entries.map((e) => [e.word, e.senses]));
    const prog = Object.fromEntries(progress.map((p) => [p.word, p]));
    const met = new Set();
    for (const s of seenIn) {
      for (const t of s.tokens || []) if (list.includes(t.lemma)) met.add(t.lemma);
    }

    res.json({
      lang,
      level,
      words: words.map((w) => ({
        word: w.word,
        pinyin: w.pinyin || "",
        unit: w.unit,
        senses: senses[w.word] || [],
        status: prog[w.word]?.status || "new",
        correct: prog[w.word]?.correct || 0,
        inYourVideos: met.has(w.word),
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* Build a quiz.
 *
 * Each question takes a curriculum word and asks what it means, with three
 * wrong answers drawn from other words at the same level — same-level
 * distractors matter, because a level-1 word against level-7 distractors is
 * guessable from difficulty alone.
 *
 * Where the word appears in a segment from one of your videos, that sentence
 * comes with it, with the word masked so the question cannot be answered by
 * reading a translation. That is the Voscreen-shaped part, except the clip is
 * from something you chose rather than a curated library.
 */
router.get("/quiz", async (req, res) => {
  try {
    const lang = req.query.lang || "zh";
    const level = Number(req.query.level || 1);
    const count = Math.min(Number(req.query.count || 8), 20);

    const pool = await Curriculum.find({ lang, level }).limit(600).lean();
    if (pool.length < 4) {
      return res.status(400).json({ error: "not enough words at this level" });
    }

    // Prefer words not yet known, so a session is not spent on what you have.
    const progress = await Progress.find({ lang, status: "known" }, "word").lean();
    const known = new Set(progress.map((p) => p.word));
    const unknown = pool.filter((w) => !known.has(w.word));
    const source = unknown.length >= count ? unknown : pool;

    /* Prefer words that appear in videos you have actually watched.
     *
     * This is the whole reason for building a curriculum on top of a video
     * miner rather than shipping another flashcard app. Picking at random gave
     * questions about 의원 ("member of parliament") with no example, when the
     * same level contained words that had just been said on screen. Words you
     * have met come first, and only then does it fall back to filling the
     * session from the rest of the level.
     */
    const poolWords = source.map((w) => w.word);
    const metDocs = await Segment.find(
      { "tokens.lemma": { $in: poolWords } },
      "tokens.lemma",
    ).limit(2000).lean();

    const met = new Set();
    for (const seg of metDocs) {
      for (const t of seg.tokens || []) if (t.lemma) met.add(t.lemma);
    }

    const seen = shuffle(source.filter((w) => met.has(w.word)));
    const unseen = shuffle(source.filter((w) => !met.has(w.word)));
    const picked = [...seen, ...unseen].slice(0, count);
    const wordList = picked.map((p) => p.word);

    const [entries, segments] = await Promise.all([
      DictionaryEntry.find({ lang, word: { $in: pool.map((p) => p.word) } }).lean(),
      Segment.find({ "tokens.lemma": { $in: wordList } })
        .populate("videoId", "originalName language")
        .limit(400)
        .lean(),
    ]);

    const senseFor = Object.fromEntries(
      entries.filter((e) => e.senses?.length).map((e) => [e.word, e.senses[0]]),
    );

    // Index example sentences by the curriculum word they contain.
    const examples = {};
    for (const seg of segments) {
      for (const tok of seg.tokens || []) {
        if (!wordList.includes(tok.lemma) || examples[tok.lemma]) continue;
        examples[tok.lemma] = {
          text: seg.text,
          translation: seg.translation || seg.english || "",
          videoId: seg.videoId?._id || null,
          videoName: seg.videoId?.originalName || "",
          start: tok.start,
          end: tok.end,
          segmentStart: seg.start,
          segmentEnd: seg.end,
        };
      }
    }

    const questions = [];
    for (const w of picked) {
      const answer = senseFor[w.word];
      // A word with no definition cannot be asked about; skip rather than
      // inventing an answer.
      if (!answer) continue;

      const distractors = shuffle(
        pool
          .filter((p) => p.word !== w.word && senseFor[p.word] && senseFor[p.word] !== answer)
          .map((p) => senseFor[p.word]),
      ).slice(0, 3);
      if (distractors.length < 3) continue;

      const example = examples[w.word] || null;
      questions.push({
        word: w.word,
        pinyin: w.pinyin || "",
        answer,
        options: shuffle([answer, ...distractors]),
        // Masked so the sentence gives context without giving the answer away.
        example: example
          ? { ...example, masked: example.text.split(w.word).join("____") }
          : null,
      });
    }

    res.json({ lang, level, questions });
  } catch (err) {
    console.error("quiz failed:", err);
    res.status(500).json({ error: err.message });
  }
});

// Record an answer.
router.post("/answer", async (req, res) => {
  try {
    const { lang, word, correct } = req.body;
    if (!lang || !word) {
      return res.status(400).json({ error: "lang and word are required" });
    }

    const update = correct ? { $inc: { correct: 1 } } : { $inc: { wrong: 1 } };
    const doc = await Progress.findOneAndUpdate({ lang, word }, update, {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true,
    });

    // Three correct answers marks it known. Arbitrary, and honest about being
    // so — without persisted review intervals there is nothing better to base
    // it on.
    const status = doc.correct >= 3 ? "known" : "learning";
    if (doc.status !== status) {
      doc.status = status;
      await doc.save();
    }

    res.json({ word, status: doc.status, correct: doc.correct });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export default router;
