/* Saved Words — automated tests for the testing assignment.
 *
 * Feature under test: saving words to the vocabulary deck, removing them,
 * exporting them to Anki, and the video upload that feeds them.
 *
 * Unlike api.test.js, this file starts its OWN copy of the API on port 4100
 * with its OWN database (dialect_vocab_test). So it never touches your real
 * saved words, and it does not need the Python tokeniser or dictionaries.
 * It only needs MongoDB and Redis running.
 *
 *   cd api && node --test test/words.test.js
 *
 * Test case IDs (TC01...) match docs/testing/test-plan.md.
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import mongoose from "mongoose";
import { Segment } from "../src/models/Segment.js";
import { Video } from "../src/models/Video.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const apiDir = path.join(here, "..");

const PORT = Number(process.env.TEST_PORT || 4100);
const API = `http://127.0.0.1:${PORT}`;
const MONGO_URI =
  process.env.TEST_MONGO_URI || "mongodb://127.0.0.1:27017/dialect_vocab_test";

// Safety net: this file drops its database. Refuse to run on anything that
// is not clearly a test database, so it can never wipe real saved words.
if (!MONGO_URI.includes("test")) {
  throw new Error(`Refusing to run: ${MONGO_URI} does not look like a test database`);
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dv-test-"));
let server = null;
let serverLog = "";

// ---------- helpers ----------

function startApi() {
  serverLog = "";
  server = spawn(process.execPath, ["src/index.js"], {
    cwd: apiDir,
    env: {
      ...process.env,
      PORT: String(PORT),
      MONGO_URI,
      UPLOAD_DIR: path.join(tmpDir, "uploads"),
      CLIP_DIR: path.join(tmpDir, "clips"),
    },
  });
  server.stdout.on("data", (d) => (serverLog += d));
  server.stderr.on("data", (d) => (serverLog += d));
  server.on("exit", () => (server = null));
}

async function waitForApi() {
  for (let i = 0; i < 60; i++) {
    if (await isAlive()) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`API did not start on ${API}. Server output:\n${serverLog}`);
}

// If an earlier test crashed the server, start a fresh one so the next test
// is judged on its own, not on the previous crash.
async function ensureApi() {
  if (!(await isAlive())) {
    startApi();
    await waitForApi();
  }
}

// "Alive" means the API answers a normal request.
async function isAlive() {
  try {
    const res = await fetch(`${API}/api/words`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

// Returns the status, or null if the connection died (server crashed).
async function request(method, urlPath, payload) {
  try {
    const res = await fetch(`${API}${urlPath}`, {
      method,
      headers: payload ? { "Content-Type": "application/json" } : {},
      body: payload ? JSON.stringify(payload) : undefined,
      signal: AbortSignal.timeout(5000),
    });
    const text = await res.text();
    let body = text;
    try {
      body = JSON.parse(text);
    } catch {
      /* not JSON, keep text */
    }
    return { status: res.status, body, headers: res.headers };
  } catch {
    return { status: null, body: null };
  }
}

const post = (p, b) => request("POST", p, b);
const get = (p) => request("GET", p);
const del = (p) => request("DELETE", p);

// Unique names per run, so tests never collide with each other.
const uid = () => `${Date.now()}${Math.random().toString(36).slice(2, 6)}`;

// ---------- setup ----------

let video;
let segment;

before(async () => {
  await mongoose.connect(MONGO_URI);
  await mongoose.connection.dropDatabase();

  // A fake transcribed video with one subtitle line, so saving a word from a
  // transcript can be tested without running Whisper.
  video = await Video.create({
    originalName: "test.mp4",
    filename: "does-not-exist.mp4",
    language: "ko",
    status: "done",
  });
  segment = await Segment.create({
    videoId: video._id,
    index: 0,
    start: 10,
    end: 14,
    text: "저는 사람을 만났어요",
    translation: "I met a person",
    words: [{ word: "사람을", start: 11, end: 11.6, score: 0.9 }],
    tokens: [
      { surface: "저", lemma: "저", pos: "NP", content: true, start: 10, end: 10.4 },
      { surface: "사람", lemma: "사람", pos: "NNG", content: true, start: 11, end: 11.5 },
      { surface: "만났어요", lemma: "만나다", pos: "VV", content: true, start: 12, end: 13 },
    ],
  });

  startApi();
  await waitForApi();
});

after(async () => {
  if (server) server.kill();
  await mongoose.connection.dropDatabase().catch(() => {});
  await mongoose.disconnect();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------- tests ----------

describe("TC01 save a word from a transcript", () => {
  test("card keeps the real sentence, timings and confidence", async () => {
    const { status, body } = await post("/api/words", {
      videoId: video._id,
      segmentId: segment._id,
      tokenIndex: 1,
    });
    assert.equal(status, 201);
    assert.equal(body.lemma, "사람");
    assert.equal(body.language, "ko");

    const occ = body.occurrences[0];
    assert.equal(occ.sentence, "저는 사람을 만났어요", "sentence must come from the transcript");
    assert.equal(occ.sentenceTranslation, "I met a person");
    assert.equal(occ.start, 11);
    assert.equal(occ.sentenceStart, 10);
    assert.equal(occ.sentenceEnd, 14);
    assert.equal(occ.confidence, 0.9, "confidence comes from the overlapping aligned word");
  });
});

describe("TC02 save with a segment that does not exist", () => {
  test("returns 404, not a broken card", async () => {
    const { status } = await post("/api/words", {
      videoId: video._id,
      segmentId: new mongoose.Types.ObjectId(),
      tokenIndex: 0,
    });
    assert.equal(status, 404);
  });
});

describe("TC03 tokenIndex boundaries (segment has 3 tokens: 0, 1, 2)", () => {
  test("last valid index (2) is accepted", async () => {
    const { status, body } = await post("/api/words", {
      videoId: video._id,
      segmentId: segment._id,
      tokenIndex: 2,
    });
    assert.equal(status, 201);
    assert.equal(body.lemma, "만나다");
  });

  test("one past the end (3) is rejected", async () => {
    const { status } = await post("/api/words", {
      videoId: video._id,
      segmentId: segment._id,
      tokenIndex: 3,
    });
    assert.equal(status, 400);
  });

  test("negative index (-1) is rejected", async () => {
    const { status } = await post("/api/words", {
      videoId: video._id,
      segmentId: segment._id,
      tokenIndex: -1,
    });
    assert.equal(status, 400);
  });
});

describe("TC04 + TC05 one card per word", () => {
  const lemma = `단어${uid()}`;
  const save = (sentence) =>
    post("/api/words/external", { language: "ko", lemma, sentence, source: "test" });

  test("TC04 same word in a second sentence adds a second occurrence", async () => {
    await save("첫 번째 문장");
    const { status, body } = await save("두 번째 문장");
    assert.equal(status, 201);
    assert.equal(body.occurrences.length, 2, "two encounters, one card");
  });

  test("TC05 clicking the same spot again does not duplicate", async () => {
    const { body } = await save("두 번째 문장");
    assert.equal(body.occurrences.length, 2);
  });
});

describe("TC06 required fields (decision table)", () => {
  test("missing lemma is rejected", async () => {
    const { status } = await post("/api/words/external", { language: "ko", sentence: "x" });
    assert.equal(status, 400);
  });

  test("missing language is rejected", async () => {
    const { status } = await post("/api/words/external", { lemma: `x${uid()}` });
    assert.equal(status, 400);
  });

  test("language + lemma is enough", async () => {
    const { status } = await post("/api/words/external", { language: "ko", lemma: `x${uid()}` });
    assert.equal(status, 201);
  });
});

describe("TC07 + TC08 unsaving", () => {
  const lemma = `삭제${uid()}`;

  before(async () => {
    await post("/api/words/external", { language: "ko", lemma, sentence: "A 문장" });
    await post("/api/words/external", { language: "ko", lemma, sentence: "B 문장" });
  });

  test("TC07 removing one occurrence keeps the card", async () => {
    const { body } = await post("/api/words/unsave", { language: "ko", lemma, sentence: "B 문장" });
    assert.equal(body.removed, true);
    assert.equal(body.remaining, 1, "the other occurrence must survive");
  });

  test("TC08 removing the last occurrence deletes the card", async () => {
    const { body } = await post("/api/words/unsave", { language: "ko", lemma, sentence: "A 문장" });
    assert.equal(body.deleted, true);
    const list = await get("/api/words?language=ko");
    assert.ok(!list.body.some((w) => w.lemma === lemma), "card should be gone");
  });
});

describe("TC09 Anki export", () => {
  test("tabs and line breaks inside a sentence do not break the row", async () => {
    const lemma = `내보내기${uid()}`;
    await post("/api/words/external", {
      language: "ko",
      lemma,
      sentence: "line one\twith tab\nline two",
    });

    const { status, body, headers } = await get("/api/words/export?language=ko");
    assert.equal(status, 200);
    assert.match(headers.get("content-type"), /tab-separated-values/);

    const row = body.split("\n").find((r) => r.startsWith(lemma + "\t"));
    assert.ok(row, "the word should have a row");
    const cols = row.split("\t");
    assert.equal(cols.length, 7, "every row has exactly 7 columns");
    assert.equal(cols[3], "line one with tab line two");
  });
});

describe("TC10 video upload, language field (equivalence partitions)", () => {
  const form = (language) => {
    const f = new FormData();
    f.append("video", new Blob([Buffer.from("not really a video")]), "clip.mp4");
    if (language) f.append("language", language);
    return f;
  };
  const upload = async (body) => {
    const res = await fetch(`${API}/api/videos`, { method: "POST", body });
    return { status: res.status, body: await res.json() };
  };

  test("no file is rejected", async () => {
    const { status } = await upload(new FormData());
    assert.equal(status, 400);
  });

  test("unsupported language (de) is rejected", async () => {
    const { status } = await upload(form("de"));
    assert.equal(status, 400);
  });

  test("supported language (ko) is queued for transcription", async () => {
    const { status, body } = await upload(form("ko"));
    assert.equal(status, 201);
    assert.equal(body.status, "queued");
    await del(`/api/videos/${body._id}`);
  });
});

describe("TC11 robustness: malformed IDs", () => {
  before(ensureApi);

  test("deleting a word with a malformed id does not crash the server", async () => {
    const { status } = await del("/api/words/abc");
    assert.ok(await isAlive(), "server must still be running after a bad request");
    assert.ok([400, 404].includes(status), `expected 400 or 404, got ${status}`);
  });

  test("opening a video with a malformed id does not crash the server", async () => {
    await ensureApi();
    const { status } = await get("/api/videos/abc");
    assert.ok(await isAlive(), "server must still be running after a bad request");
    assert.ok([400, 404].includes(status), `expected 400 or 404, got ${status}`);
  });
});

describe("TC12 security: NoSQL injection on unsave", () => {
  before(async () => {
    await ensureApi();
    await post("/api/words/external", { language: "ko", lemma: `피해자${uid()}`, sentence: "x" });
  });

  test("a query operator instead of a word must not delete anyone's card", async () => {
    const before = (await get("/api/words?language=ko")).body.length;

    // {"$ne": null} means "any word at all". If the server passes it straight
    // to MongoDB, it deletes whichever card it finds first.
    await post("/api/words/unsave", { language: "ko", lemma: { $ne: null } });

    const after = (await get("/api/words?language=ko")).body.length;
    assert.equal(after, before, "no card should be deleted by an injected operator");
  });
});

describe("TC13 robustness: dictionary lookup with a non-text word", () => {
  before(ensureApi);

  test("?word[x]=1 is rejected, and the server keeps running", async () => {
    // Express turns word[x]=1 into an object, not a string. The lookup then
    // calls .endsWith() on it, which throws. Just opening this URL in a
    // browser was enough to stop the whole API.
    const { status } = await get("/api/dictionary?lang=ko&word[x]=1");
    assert.ok(await isAlive(), "server must still be running");
    assert.equal(status, 400);
  });
});

describe("TC14 robustness: word list filtered by a malformed videoId", () => {
  before(ensureApi);

  test("?videoId=abc does not crash the server", async () => {
    const { status } = await get("/api/words?videoId=abc");
    assert.ok(await isAlive(), "server must still be running");
    assert.ok([200, 400].includes(status), `expected 200 or 400, got ${status}`);
  });
});

describe("TC15 unsave without saying which occurrence (decision table)", () => {
  const lemma = `전부${uid()}`;

  before(async () => {
    await ensureApi();
    await post("/api/words/external", { language: "ko", lemma, sentence: "하나" });
    await post("/api/words/external", { language: "ko", lemma, sentence: "둘" });
  });

  test("no segmentId and no sentence is rejected, card keeps both clips", async () => {
    // Unsave is meant to remove ONE occurrence. With neither field given,
    // the filter removed every occurrence and deleted the whole card.
    const { status } = await post("/api/words/unsave", { language: "ko", lemma });
    assert.equal(status, 400);

    const list = await get("/api/words?language=ko");
    const card = list.body.find((w) => w.lemma === lemma);
    assert.ok(card, "card must still exist");
    assert.equal(card.occurrences.length, 2);
  });
});

describe("TC16 rejected upload leaves no file behind", () => {
  before(ensureApi);

  test("a video refused for its language is not kept on disk", async () => {
    // multer writes the file BEFORE the route checks the language, and the
    // route never deletes it. Up to 2 GB per refused upload stays forever.
    const uploads = path.join(tmpDir, "uploads");
    const countBefore = fs.readdirSync(uploads).length;

    const f = new FormData();
    f.append("video", new Blob([Buffer.from("x".repeat(1000))]), "clip.mp4");
    f.append("language", "de");
    const res = await fetch(`${API}/api/videos`, { method: "POST", body: f });
    assert.equal(res.status, 400);

    assert.equal(fs.readdirSync(uploads).length, countBefore, "refused file must be deleted");
  });
});

describe("TC17 security: other websites cannot use the API", () => {
  before(ensureApi);

  test("a request from an unknown website gets no CORS permission", async () => {
    // The API has no login, so CORS is the only thing stopping a random
    // website you visit from reading or deleting your saved words through
    // localhost. cors() with no options allows every origin.
    const res = await fetch(`${API}/api/words`, {
      headers: { Origin: "https://evil.example" },
    });
    const allowed = res.headers.get("access-control-allow-origin");
    assert.ok(
      allowed !== "*" && allowed !== "https://evil.example",
      `unknown website was allowed (Access-Control-Allow-Origin: ${allowed})`,
    );
  });
});

describe("TC18 security: other devices on the Wi-Fi cannot reach the API", () => {
  before(ensureApi);

  test("the API does not answer on the computer's network address", async (t) => {
    // app.listen(port) with no host listens on EVERY network interface. On
    // dorm, cafe or university Wi-Fi, anyone could open http://<your-ip>:4000,
    // list your videos, watch them through /media, and delete your words.
    const lanIp = Object.values(os.networkInterfaces())
      .flat()
      .find((a) => a && a.family === "IPv4" && !a.internal)?.address;
    if (!lanIp) return t.skip("this machine has no network address to test");

    let reachable = true;
    try {
      await fetch(`http://${lanIp}:${PORT}/api/videos`, { signal: AbortSignal.timeout(2000) });
    } catch {
      reachable = false;
    }
    assert.equal(reachable, false, `API answered on ${lanIp}, other devices could reach it`);
  });
});

describe("TC19 security: /media cannot be used to read other files", () => {
  before(ensureApi);

  test("path traversal out of the uploads folder is blocked", async () => {
    // Expected to PASS: express.static already blocks this. Kept as a guard,
    // so a future custom file handler cannot quietly reopen it.
    for (const evil of ["/media/..%2f..%2fpackage.json", "/media/..%2f..%2f.env"]) {
      const { status } = await get(evil);
      assert.ok([400, 403, 404].includes(status), `${evil} returned ${status}`);
    }
  });
});

describe("TC20 security: uploading a web page instead of a video", () => {
  before(ensureApi);

  test("an .html file is refused, or at least never served as a web page", async () => {
    // Uploads keep their file extension and /media serves them back. An
    // uploaded evil.html would open as a real page on localhost:4000, the
    // same origin as the app, so its script could read and delete everything.
    const f = new FormData();
    f.append(
      "video",
      new Blob(["<script>fetch('/api/words').then(r=>r.json()).then(console.log)</script>"], {
        type: "text/html",
      }),
      "evil.html",
    );
    f.append("language", "ko");
    const res = await fetch(`${API}/api/videos`, { method: "POST", body: f });
    const body = await res.json();

    if (res.status === 201) {
      const served = await fetch(`${API}/media/${body.filename}`);
      await del(`/api/videos/${body._id}`);
      assert.doesNotMatch(
        served.headers.get("content-type") || "",
        /text\/html/,
        "an uploaded file was served back as a runnable web page",
      );
      assert.fail("a non-video file was accepted as a video");
    }
    assert.equal(res.status, 400);
  });
});

describe("TC21 security: Netflix login never ends up in git", () => {
  const root = path.join(apiDir, "..");
  const git = (...args) => spawnSync("git", args, { cwd: root, encoding: "utf8" });

  test(".chrome-profile (holds the streaming login cookies) is ignored and was never committed", (t) => {
    if (git("rev-parse", "--git-dir").status !== 0) return t.skip("not a git checkout");

    // A file that Chrome really creates inside a profile.
    const ignored = git("check-ignore", "-q", ".chrome-profile/Default/Cookies").status === 0;
    assert.ok(ignored, ".chrome-profile must be in .gitignore");

    const history = git("log", "--all", "--format=%h", "--", ".chrome-profile").stdout.trim();
    assert.equal(history, "", `.chrome-profile appears in commits: ${history}`);
  });
});
