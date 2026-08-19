/* Parse subtitle files.
 *
 * Handles SRT and WebVTT, which between them cover essentially everything you
 * can download. Both are the same idea — a timestamp range then some lines of
 * text — so one parser reads both.
 *
 * This exists so the app can show the subtitles for something it cannot play.
 * Netflix will not let any website embed its player, so the alternative to
 * giving up is to keep the words and let the learner run them alongside
 * whatever they are actually watching on.
 */

// 00:01:23,456 (SRT, comma) or 00:01:23.456 (VTT, dot). Hours optional in VTT.
const TIME = /(?:(\d+):)?(\d{1,2}):(\d{2})[,.](\d{1,3})/;

function seconds(match) {
  const [, h, m, s, ms] = match;
  return (
    Number(h || 0) * 3600 + Number(m) * 60 + Number(s) + Number(ms.padEnd(3, "0")) / 1000
  );
}

export function parseSubtitles(text) {
  const clean = text.replace(/\r\n/g, "\n").replace(/^﻿/, "");
  const cues = [];

  // Blocks are separated by blank lines in both formats.
  for (const block of clean.split(/\n{2,}/)) {
    const lines = block.split("\n").filter((l) => l.trim() !== "");
    if (!lines.length) continue;

    const arrowIndex = lines.findIndex((l) => l.includes("-->"));
    if (arrowIndex === -1) continue; // WEBVTT header, NOTE blocks, or junk

    const [from, to] = lines[arrowIndex].split("-->");
    const start = TIME.exec(from || "");
    const end = TIME.exec(to || "");
    if (!start || !end) continue;

    const body = lines
      .slice(arrowIndex + 1)
      // Strip the inline markup both formats allow. A learner clicking a word
      // should not be clicking <i> or a positioning cue.
      .map((l) => l.replace(/<[^>]+>/g, "").replace(/\{\\[^}]*\}/g, "").trim())
      .filter(Boolean)
      .join(" ");
    if (!body) continue;

    cues.push({ start: seconds(start), end: seconds(end), text: body });
  }

  cues.sort((a, b) => a.start - b.start);
  return cues;
}

export function formatTime(t) {
  const sign = t < 0 ? "-" : "";
  const v = Math.abs(t);
  const m = Math.floor(v / 60);
  const s = Math.floor(v % 60);
  return `${sign}${m}:${String(s).padStart(2, "0")}`;
}
