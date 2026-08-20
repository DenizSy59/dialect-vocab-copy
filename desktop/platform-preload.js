/* Runs inside the streaming site's view. Reads subtitles, sends them out.
 *
 * This replaces the injected overlay. Previously the extension's content script
 * drew clickable words on top of Netflix; inside the desktop shell that is the
 * wrong shape, because the app can render them itself in a panel it controls,
 * with its own fonts, themes and click handling.
 *
 * So this script does one job: watch the subtitle element and post the text
 * out. Nothing is drawn here, and nothing is modified on the page.
 *
 * The selector table is duplicated from extension/content.js, which stays the
 * canonical list — when a platform changes its markup, fix it there first and
 * mirror it here.
 */

const { contextBridge, ipcRenderer } = require("electron");

const PLATFORMS = [
  {
    match: /netflix\.com/,
    containers: [".player-timedtext", "[data-uia='player-timedtext']"],
    lines: [".player-timedtext-text-container", "span"],
  },
  {
    match: /primevideo\.com|amazon\.[a-z.]+\/gp\/video/,
    containers: [".atvwebplayersdk-captions-overlay", ".fkpovp9", ".captions"],
    lines: [".atvwebplayersdk-captions-text", "span"],
  },
  {
    match: /viki\.com/,
    containers: [".vjs-text-track-display", ".subtitle-container", ".vjs-subtitles"],
    lines: [".vjs-text-track-cue", "div", "span"],
  },
  {
    match: /iq\.com|iqiyi\.com/,
    containers: [".subtitle-container", ".iqp-subtitle", "[class*='subtitle']"],
    lines: ["span", "div"],
  },
  {
    match: /gagaoolala\.com/,
    containers: [".vjs-text-track-display", "[class*='subtitle']"],
    lines: [".vjs-text-track-cue", "div", "span"],
  },
];

function platform() {
  return PLATFORMS.find((p) => p.match.test(location.hostname));
}

/* Locate the subtitle element.
 *
 * Named selectors first, then a structural fallback: a short run of text
 * sitting over the lower half of a <video>. The fallback is what keeps this
 * alive through a platform redesign.
 */
function findContainer(p) {
  for (const sel of p.containers) {
    const el = document.querySelector(sel);
    if (el) return el;
  }
  const video = document.querySelector("video");
  if (!video) return null;
  const vr = video.getBoundingClientRect();
  if (!vr.width) return null;

  let best = null;
  for (const el of document.querySelectorAll("div, span, p")) {
    const text = (el.innerText || "").trim();
    if (!text || text.length > 220) continue;
    if (el.querySelector("button, input, a")) continue;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    const inside =
      r.left >= vr.left - 8 && r.right <= vr.right + 8 &&
      r.top >= vr.top + vr.height * 0.45 && r.bottom <= vr.bottom + 8;
    if (!inside) continue;
    if (!best || el.compareDocumentPosition(best) & Node.DOCUMENT_POSITION_CONTAINS) {
      best = el;
    }
  }
  return best;
}

function currentSubtitle(p) {
  const container = findContainer(p);
  if (!container) return "";
  let nodes = [];
  for (const sel of p.lines) {
    nodes = [...container.querySelectorAll(sel)];
    if (nodes.length) break;
  }
  return (nodes.length ? nodes : [container])
    .map((n) => n.innerText || n.textContent || "")
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

let last = "";
let ticks = 0;

function tick() {
  const p = platform();
  if (!p) {
    if (ticks++ % 40 === 0) ipcRenderer.send("reader-status", `no platform match: ${location.hostname}`);
    return;
  }
  const text = currentSubtitle(p);
  // Report periodically even when nothing is found, so the difference between
  // "reader is dead" and "no subtitle on screen right now" is visible.
  if (ticks++ % 40 === 0) {
    ipcRenderer.send("reader-status",
      `alive on ${location.hostname}, container=${!!findContainer(p)}, text=${text ? text.length + " chars" : "none"}`);
  }
  if (text === last) return;
  last = text;
  ipcRenderer.send("subtitle", text);
}

// Polling rather than a MutationObserver: players replace the whole subtitle
// node constantly, and observers attached to a node that gets swapped out stop
// firing silently.
window.addEventListener("DOMContentLoaded", () => setInterval(tick, 250));
setInterval(tick, 250);

// Lets the app show whether it is actually reading anything.
contextBridge.exposeInMainWorld("lexiconReader", { active: true });
ipcRenderer.send("reader-status", "preload loaded on " + location.hostname);
