import express from "express";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { lookup } from "./words.js";

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
function tokenise(text, language) {
  return new Promise((resolve, reject) => {
    const script = [
      "import sys, json",
      "sys.path.insert(0, 'src')",
      "from lemmatise import get_tokeniser",
      "payload = json.loads(sys.stdin.read())",
      "tk = get_tokeniser(payload['language'])",
      "print(json.dumps([t.to_dict() for t in tk(payload['text'])], ensure_ascii=False))",
    ].join("\n");

    const proc = spawn(path.join(ML, ".venv", "bin", "python"), ["-c", script], {
      cwd: ML,
    });

    // The payload goes over stdin rather than argv: subtitle text is arbitrary
    // user content and must never be interpolated into a command line.
    proc.stdin.write(JSON.stringify({ text, language }));
    proc.stdin.end();

    let out = "";
    let err = "";
    proc.stdout.on("data", (d) => (out += d));
    proc.stderr.on("data", (d) => (err += d));
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code !== 0) return reject(new Error(err.slice(-400) || `exited ${code}`));
      try {
        // The tokeniser libraries print load messages to stdout on first use,
        // so take the last line rather than the whole buffer.
        const lines = out.trim().split("\n");
        resolve(JSON.parse(lines[lines.length - 1]));
      } catch (e) {
        reject(new Error(`could not parse tokeniser output: ${e.message}`));
      }
    });
  });
}

router.post("/", async (req, res) => {
  try {
    const { text, language } = req.body;
    if (!text || !language) {
      return res.status(400).json({ error: "text and language are required" });
    }
    if (!["ko", "zh", "tr"].includes(language)) {
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
        };
        if (!t.content) return base;
        const entry = await lookup(language, t.lemma, t.surface);
        return { ...base, senses: entry?.senses ?? [], pinyin: entry?.pinyin ?? "" };
      }),
    );

    res.json({ language, text, tokens });
  } catch (err) {
    console.error("tokenise failed:", err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
