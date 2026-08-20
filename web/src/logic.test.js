/* Frontend logic tests.
 *
 * The React layer has produced its share of bugs — readings overlapping each
 * other above the text, a prop named the same as a state variable, a cache
 * keyed without its language — and until now nothing here was tested at all.
 *
 * These cover the pure functions, which is where the logic that can be wrong
 * actually lives. Rendering is checked in the browser; what is worth locking
 * down in a test is the character arithmetic, the parsing and the clamping.
 */

import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { ownership } from "./tokens.js";
import { parseSubtitles, formatTime } from "./subtitles.js";
import { makeT, languageName } from "./i18n.js";
import { difficultyColour, popoverPosition } from "./components/Player.jsx";
import { youtubeId } from "./components/PlatformPanel.jsx";

describe("ownership", () => {
  test("every character is rendered exactly once", () => {
    const text = "안녕하세요";
    const tokens = [
      { surface: "안녕", charStart: 0, charEnd: 2, content: true },
      { surface: "하", charStart: 2, charEnd: 3, content: false },
      { surface: "세요", charStart: 3, charEnd: 5, content: false },
    ];
    const runs = ownership(text, tokens);
    expect(runs.map((r) => r.text).join("")).toBe(text);
  });

  test("overlapping tokens do not duplicate text", () => {
    // The bug this exists for: kiwi splits 왔 into 오/VV and 았/EP, both pointing
    // at the same character. Rendering token by token printed 오었 where the
    // transcript said 왔.
    const text = "왔다";
    const tokens = [
      { surface: "오", charStart: 0, charEnd: 1, content: true },
      { surface: "았", charStart: 0, charEnd: 1, content: false },
      { surface: "다", charStart: 1, charEnd: 2, content: false },
    ];
    const runs = ownership(text, tokens);
    expect(runs.map((r) => r.text).join("")).toBe("왔다");
  });

  test("a content token wins the character over a function token", () => {
    const text = "왔";
    const tokens = [
      { surface: "았", charStart: 0, charEnd: 1, content: false },
      { surface: "오", charStart: 0, charEnd: 1, content: true },
    ];
    const runs = ownership(text, tokens);
    expect(tokens[runs[0].tokenIndex].content).toBe(true);
  });

  test("text no token claims still renders", () => {
    // Spaces and punctuation belong to nothing but must not vanish.
    const text = "밥 을";
    const tokens = [{ surface: "밥", charStart: 0, charEnd: 1, content: true }];
    const runs = ownership(text, tokens);
    expect(runs.map((r) => r.text).join("")).toBe(text);
    expect(runs.some((r) => r.tokenIndex === -1)).toBe(true);
  });

  test("no tokens at all is not a crash", () => {
    expect(ownership("안녕", []).map((r) => r.text).join("")).toBe("안녕");
  });

  test("empty text produces no runs", () => {
    expect(ownership("", [])).toEqual([]);
  });
});

describe("parseSubtitles", () => {
  const srt = `1
00:00:01,000 --> 00:00:03,500
안녕하세요.

2
00:00:04,000 --> 00:00:06,000
반갑습니다.
`;

  test("reads SRT cues and timings", () => {
    const cues = parseSubtitles(srt);
    expect(cues).toHaveLength(2);
    expect(cues[0].text).toBe("안녕하세요.");
    expect(cues[0].start).toBeCloseTo(1.0, 3);
    expect(cues[0].end).toBeCloseTo(3.5, 3);
  });

  test("reads VTT, which uses a dot for the decimal", () => {
    const vtt = `WEBVTT

00:00:01.000 --> 00:00:03.500
안녕하세요.
`;
    const cues = parseSubtitles(vtt);
    expect(cues).toHaveLength(1);
    expect(cues[0].start).toBeCloseTo(1.0, 3);
  });

  test("joins a cue split over two lines", () => {
    const two = `1
00:00:01,000 --> 00:00:03,000
first line
second line
`;
    expect(parseSubtitles(two)[0].text).toContain("second line");
  });

  test("garbage returns nothing rather than throwing", () => {
    expect(parseSubtitles("not a subtitle file at all")).toEqual([]);
    expect(parseSubtitles("")).toEqual([]);
  });
});

describe("formatTime", () => {
  test("formats minutes and seconds", () => {
    expect(formatTime(0)).toBe("0:00");
    expect(formatTime(65)).toBe("1:05");
  });

  test("survives nothing to format", () => {
    expect(() => formatTime(null)).not.toThrow();
    expect(() => formatTime(undefined)).not.toThrow();
  });
});

describe("interface language", () => {
  test("returns the chosen language", () => {
    expect(makeT("tr")("library")).toBe("Kütüphane");
  });

  test("falls back to English rather than showing a key", () => {
    // A missing translation should degrade to a readable string, never to
    // "studyDeck" appearing in the interface.
    const t = makeT("ko");
    expect(t("library")).not.toBe("library");
    const unknown = makeT("xx");
    expect(unknown("library")).toBe("Library");
  });

  test("an unknown key returns the key rather than undefined", () => {
    expect(makeT("en")("noSuchKeyAnywhere")).toBe("noSuchKeyAnywhere");
  });

  test("language names are localised, and unknown codes pass through", () => {
    expect(languageName("ko", "tr")).toBe("Korece");
    expect(languageName("ko", "en")).toBe("Korean");
    expect(languageName("xx", "en")).toBe("xx");
  });
});

describe("difficultyColour", () => {
  test("unscored is not coloured", () => {
    // "not measured" and "easy" must not look the same.
    expect(difficultyColour(null)).toBeUndefined();
    expect(difficultyColour(undefined)).toBeUndefined();
  });

  test("easy is green and hard is red", () => {
    expect(difficultyColour(0)).toContain("hsl(145");
    expect(difficultyColour(1)).toContain("hsl(0");
  });

  test("out-of-range values are clamped, not wrapped", () => {
    expect(difficultyColour(5)).toBe(difficultyColour(1));
    expect(difficultyColour(-5)).toBe(difficultyColour(0));
  });
});

describe("popoverPosition", () => {
  const W = 1000;
  const H = 800;
  const original = global.window;

  // These tests run in node, where there is no window. Stubbing just the two
  // properties the function reads is enough, and keeps the suite free of a
  // jsdom dependency for three assertions about arithmetic.
  beforeAll(() => {
    global.window = { innerWidth: W, innerHeight: H };
  });
  afterAll(() => {
    global.window = original;
  });

  test("a word at the left edge does not push the popover off screen", () => {
    const pos = popoverPosition({ left: 2, right: 20, width: 18, top: 400, bottom: 420 });
    expect(pos.left).toBeGreaterThanOrEqual(0);
  });

  test("a word at the right edge stays inside the viewport", () => {
    const pos = popoverPosition({ left: 980, right: 998, width: 18, top: 400, bottom: 420 });
    expect(pos.left + 280).toBeLessThanOrEqual(W);
  });

  test("flips below when there is no room above", () => {
    const high = popoverPosition({ left: 500, right: 520, width: 20, top: 10, bottom: 30 });
    expect(high.flipped).toBe(true);
    expect(high.top).toBeDefined();

    const low = popoverPosition({ left: 500, right: 520, width: 20, top: 600, bottom: 620 });
    expect(low.flipped).toBe(false);
    expect(low.bottom).toBeDefined();
  });
});

describe("youtubeId", () => {
  test("accepts the forms people actually paste", () => {
    const id = "dQw4w9WgXcQ";
    expect(youtubeId(`https://www.youtube.com/watch?v=${id}`)).toBe(id);
    expect(youtubeId(`https://youtu.be/${id}`)).toBe(id);
    expect(youtubeId(`https://www.youtube.com/embed/${id}`)).toBe(id);
    expect(youtubeId(`https://www.youtube.com/shorts/${id}`)).toBe(id);
    expect(youtubeId(id)).toBe(id);
    expect(youtubeId(`  ${id}  `)).toBe(id);
  });

  test("keeps extra query parameters out of the id", () => {
    expect(youtubeId("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s")).toBe(
      "dQw4w9WgXcQ",
    );
  });

  test("rejects things that are not videos", () => {
    expect(youtubeId("https://www.netflix.com/watch/123")).toBeNull();
    expect(youtubeId("")).toBeNull();
    expect(youtubeId("hello")).toBeNull();
  });
});
