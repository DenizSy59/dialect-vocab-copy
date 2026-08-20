import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { lookup } from "./words.js";
import { tokenise } from "../tokeniser.js";

const router = express.Router();
const here = path.dirname(fileURLToPath(import.meta.url));
const ML = path.join(here, "..", "..", "..", "ml");

/* Tokenise a line of subtitle text.
 *
 * The browser extension needs this: on Netflix and Prime the subtitle text is
 * all DRM leaves readable, and it arrives as a plain string with no tokens,
 * lemmas or timings. Sending it here means a word clicked on Netflix gets the
 * same lemma as the same word in an uploaded file, and lands in the same deck.
 *
 * Shells out to the Python tokeniser rather than reimplementing kiwi and jieba
 * in JavaScript, which would guarantee the two routes disagreed eventually.
 */
/* Work out the language from the script.
 *
 * On streaming platforms the subtitle language is whatever the viewer switched
 * the player to, and it changes without telling us. Trusting the picker meant
 * Chinese subtitles were fed to the Korean tokeniser, which returned no content
 * words at all — so nothing was clickable and it looked like Chinese was
 * unsupported.
 *
 * Hangul, Han and Latin are far enough apart that counting characters is
 * reliable and costs nothing. Turkish is told from English by its own letters;
 * when neither appears the caller's choice decides, since both use plain Latin.
 */
export function detectScript(text, fallback = "en") {
  let hangul = 0;
  let han = 0;
  let latin = 0;
  let turkish = 0;

  for (const ch of text) {
    const c = ch.codePointAt(0);
    if (c >= 0xac00 && c <= 0xd7a3) hangul++;
    else if ((c >= 0x4e00 && c <= 0x9fff) || (c >= 0x3400 && c <= 0x4dbf)) han++;
    else if (/[a-z]/i.test(ch)) latin++;
    if ("çğıöşüÇĞİÖŞÜ".includes(ch)) turkish++;
  }

  if (hangul > 0 && hangul >= han) return "ko";
  if (han > 0) return "zh";
  if (turkish > 0) return "tr";
  if (latin > 0) return ["tr", "en"].includes(fallback) ? fallback : "en";
  return fallback;
}

router.post("/", async (req, res) => {
  try {
    const { text } = req.body;
    let { language } = req.body;
    if (!text) {
      return res.status(400).json({ error: "text is required" });
    }

    // The script is the authority, not the picker.
    language = detectScript(text, language || "en");

    if (!["ko", "zh", "tr", "en"].includes(language)) {
      return res.status(400).json({ error: "unsupported language" });
    }

    const raw = await tokenise(text, language);

    // Attach a definition to content words so the extension can show a meaning
    // on hover without a second round trip per word.
    const tokens = await Promise.all(
      raw.map(async (t) => {
        const base = {
          surface: t.surface,
          lemma: t.lemma,
          pos: t.pos,
          charStart: t.char_start,
          charEnd: t.char_end,
          content: t.content,
          reading: t.reading || "",
        };
        if (!t.content) return base;
        const entry = await lookup(language, t.lemma, t.surface);
        return { ...base, senses: entry?.senses ?? [], pinyin: entry?.pinyin ?? "" };
      }),
    );

    // language is what was detected, which may differ from what was asked
    res.json({ language, text, tokens });
  } catch (err) {
    console.error("tokenise failed:", err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
