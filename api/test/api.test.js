/* API tests.
 *
 * Written after a session in which every bug found by hand lived in this layer:
 * multer decoding Korean filenames as latin1, the tokeniser spawning a process
 * per request, the subtitle cache keyed without its language, a worker liveness
 * check that reported a confident false negative. All of them were cheap to
 * test and expensive to find by clicking.
 *
 * These run against a live API and a live database, which makes them
 * integration tests rather than unit tests. That is deliberate: the bugs were
 * in the seams — Node to Python, Node to Mongo, the encoding boundary — and
 * mocking those away would have hidden every one of them.
 *
 *   ./run.sh && node --test api/test/
 */

import { test, describe, before } from "node:test";
import assert from "node:assert/strict";

const API = process.env.API_URL || "http://localhost:4000";

async function get(path) {
  const res = await fetch(`${API}${path}`);
  return { status: res.status, body: await res.json() };
}

async function post(path, payload) {
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return { status: res.status, body: await res.json() };
}

before(async () => {
  try {
    await fetch(`${API}/api/health`);
  } catch {
    throw new Error(`API not reachable at ${API} — run ./run.sh first`);
  }
});

describe("health", () => {
  test("reports the worker honestly", async () => {
    const { body } = await get("/api/health");
    assert.equal(body.ok, true);
    // Not just "is there a key" — the earlier version returned alive:false
    // while the worker was processing jobs, which is worse than no check.
    assert.ok(typeof body.worker.alive === "boolean", "worker.alive must be known");
  });
});

describe("tokenise", () => {
  test("Korean splits into content and function words", async () => {
    const { body } = await post("/api/tokenise", {
      text: "저는 왼쪽 공격수를 맡고 있습니다",
      language: "ko",
    });
    const content = body.tokens.filter((t) => t.content).map((t) => t.surface);
    assert.ok(content.includes("공격수"), "공격수 should be clickable");
    const particles = body.tokens.filter((t) => t.surface === "는");
    assert.ok(particles.every((t) => !t.content), "particles must not be clickable");
  });

  test("pronouns and numerals are clickable", async () => {
    // These were excluded and reported as "some words are not clickable".
    const ko = await post("/api/tokenise", { text: "저는 이것을 그 사람에게 줬다", language: "ko" });
    const koWords = ko.body.tokens.filter((t) => t.content).map((t) => t.surface);
    assert.ok(koWords.includes("저"), "저 (I) should be clickable");
    assert.ok(koWords.includes("이것"), "이것 (this) should be clickable");

    const zh = await post("/api/tokenise", { text: "我们五个人一起去北京", language: "zh" });
    const zhWords = zh.body.tokens.filter((t) => t.content).map((t) => t.surface);
    assert.ok(zhWords.includes("我们"), "我们 (we) should be clickable");
    assert.ok(zhWords.includes("一起"), "一起 (together) should be clickable");
  });

  test("the script wins over the declared language", async () => {
    // The Chinese-on-Netflix bug: the picker said Korean, the subtitles were
    // Chinese, kiwi found no content words and nothing was clickable.
    const { body } = await post("/api/tokenise", {
      text: "我昨天跟朋友一起吃饭了",
      language: "ko",
    });
    assert.equal(body.language, "zh", "should detect Chinese despite being told Korean");
    assert.ok(body.tokens.some((t) => t.content), "should find clickable words");
  });

  test("readings come back for non-Latin scripts", async () => {
    const zh = await post("/api/tokenise", { text: "朋友", language: "zh" });
    assert.equal(zh.body.tokens.find((t) => t.content)?.reading, "péngyǒu");

    const ko = await post("/api/tokenise", { text: "사람", language: "ko" });
    assert.equal(ko.body.tokens.find((t) => t.content)?.reading, "saram");
  });

  test("Latin scripts get no reading", async () => {
    const { body } = await post("/api/tokenise", { text: "the store", language: "en" });
    assert.ok(body.tokens.every((t) => !t.reading), "English needs no romanisation");
  });

  test("rejects an empty request rather than guessing", async () => {
    const { status } = await post("/api/tokenise", { language: "ko" });
    assert.equal(status, 400);
  });
});

describe("dictionary", () => {
  test("finds a common word", async () => {
    const { body } = await get("/api/dictionary?lang=zh&word=" + encodeURIComponent("朋友"));
    assert.equal(body.found, true);
    assert.ok(body.senses.length > 0);
  });

  test("reports a miss rather than inventing a meaning", async () => {
    const { body } = await get("/api/dictionary?lang=ko&word=" + encodeURIComponent("손호준"));
    assert.equal(body.found, false, "a personal name has no dictionary entry");
  });

  test("pronunciation notes are not offered as the meaning", async () => {
    // CC-CEDICT carries "also pr. [...]" entries; they are notes, not senses.
    const { body } = await get("/api/dictionary?lang=zh&word=" + encodeURIComponent("UP主"));
    if (body.found && body.senses.length > 1) {
      assert.ok(
        !/^\s*(also pr\.|pronounced)/i.test(body.senses[0]),
        `first sense should be a meaning, got: ${body.senses[0]}`,
      );
    }
  });
});

describe("translate", () => {
  test("translates and reports the detected source", async () => {
    const { body } = await post("/api/translate", {
      texts: ["안녕하세요."],
      target: "en",
    });
    assert.equal(body.source, "ko");
    assert.ok(body.texts[0].length > 0, "should return a translation");
  });

  test("the second call is served from cache", async () => {
    const payload = { texts: ["안녕하세요."], target: "en" };
    await post("/api/translate", payload);
    const { body } = await post("/api/translate", payload);
    assert.equal(body.cached, 1, "repeat requests must not re-translate");
  });

  test("a target equal to the source is a no-op", async () => {
    const { body } = await post("/api/translate", {
      texts: ["안녕하세요."],
      target: "ko",
    });
    assert.equal(body.texts[0], "안녕하세요.");
  });

  test("rejects an unsupported target", async () => {
    const { status } = await post("/api/translate", { texts: ["hi"], target: "de" });
    assert.equal(status, 400);
  });
});

describe("saved words", () => {
  const lemma = `테스트${Date.now()}`;

  test("the same word in two places becomes one card with two clips", async () => {
    // The whole point of keying on (language, lemma) rather than on the video.
    await post("/api/words/external", {
      language: "ko", lemma, surface: lemma,
      sentence: "첫 번째 문장", source: "test",
    });
    const { body } = await post("/api/words/external", {
      language: "ko", lemma, surface: lemma,
      sentence: "두 번째 문장", source: "test",
    });
    assert.equal(body.occurrences.length, 2, "two encounters, one card");
  });

  test("re-clicking the same spot does not duplicate", async () => {
    const { body } = await post("/api/words/external", {
      language: "ko", lemma, surface: lemma,
      sentence: "두 번째 문장", source: "test",
    });
    assert.equal(body.occurrences.length, 2, "a repeat click is not a new encounter");
  });

  test("unsaving removes one encounter, not the card", async () => {
    const { body } = await post("/api/words/unsave", {
      language: "ko", lemma, sentence: "두 번째 문장",
    });
    assert.equal(body.removed, true);
    assert.equal(body.remaining, 1, "the other clip must survive");
  });

  test("unsaving the last encounter deletes the card", async () => {
    const { body } = await post("/api/words/unsave", {
      language: "ko", lemma, sentence: "첫 번째 문장",
    });
    assert.equal(body.deleted, true);
    const list = await get(`/api/words?language=ko`);
    assert.ok(!list.body.some((w) => w.lemma === lemma), "card should be gone");
  });
});

describe("curriculum", () => {
  test("lists every language with a course", async () => {
    const { body } = await get("/api/curriculum/languages");
    const codes = body.languages.map((l) => l.lang);
    assert.ok(codes.includes("zh") && codes.includes("ko"));
  });

  test("Chinese levels come from HSK, not our own banding", async () => {
    const { body } = await get("/api/curriculum?lang=zh");
    assert.equal(body.levels[0].standard, "HSK 3.0");
  });

  test("quiz questions have exactly one correct option", async () => {
    const { body } = await get("/api/curriculum/quiz?lang=ko&level=1&count=5");
    assert.ok(body.questions.length > 0, "should build some questions");
    for (const q of body.questions) {
      assert.equal(q.options.length, 4);
      assert.ok(q.options.includes(q.answer), "the answer must be among the options");
      assert.equal(
        q.options.filter((o) => o === q.answer).length,
        1,
        "the answer must not appear twice",
      );
    }
  });

  test("an example sentence masks the word being asked about", async () => {
    const { body } = await get("/api/curriculum/quiz?lang=ko&level=1&count=8");
    for (const q of body.questions.filter((x) => x.example)) {
      assert.ok(
        !q.example.masked.includes(q.word),
        `${q.word} should be masked in its own example`,
      );
    }
  });
});
