/* Overlay clickable vocabulary on a streaming platform's own subtitles.
 *
 * You log into Netflix yourself, in your own browser, as normal. This extension
 * does not touch your account, does not proxy the video, and never sees your
 * credentials — it reads the subtitle text the player has already drawn into
 * the page and puts an interactive copy on top.
 *
 * That is the only route DRM leaves open. Widevine means the decrypted audio is
 * unreadable, so Whisper cannot run on Netflix at all, and Netflix sends
 * x-frame-options: DENY so it cannot be embedded in our own page either.
 *
 * Consequences, all of them DRM's doing:
 *   - no word-level timings, so no video clips on this route
 *   - dialect detection is text-only
 *   - subtitle quality is whatever the platform shipped
 *
 * Tokenising, lemmatising and dictionary lookup still go through the same API
 * as uploaded files, so a word saved here gets the same lemma and lands in the
 * same deck.
 *
 * SELECTORS ARE THE FRAGILE PART. Every platform can rename a class in any
 * release and break this. So each platform lists several candidates and there
 * is a structural fallback that finds the subtitle container by behaviour
 * rather than by name. When something breaks, this is the file to look at.
 */

const API = "http://localhost:4000";

const PLATFORMS = [
  {
    id: "netflix",
    match: /netflix\.com/,
    // Netflix has used .player-timedtext for years, with cues in
    // .player-timedtext-text-container. Both are listed plus the parent, so a
    // rename of the inner one alone does not break it.
    containers: [".player-timedtext", "[data-uia='player-timedtext']"],
    lines: [".player-timedtext-text-container", "span"],
  },
  {
    id: "prime",
    match: /primevideo\.com|amazon\.[a-z.]+\/gp\/video/,
    containers: [".atvwebplayersdk-captions-overlay", ".fkpovp9", ".captions"],
    lines: [".atvwebplayersdk-captions-text", "span"],
  },
  {
    id: "viki",
    match: /viki\.com/,
    containers: [".vjs-text-track-display", ".subtitle-container", ".vjs-subtitles"],
    lines: [".vjs-text-track-cue", "div", "span"],
  },
  {
    id: "iqiyi",
    match: /iq\.com|iqiyi\.com/,
    containers: [".subtitle-container", ".iqp-subtitle", "[class*='subtitle']"],
    lines: ["span", "div"],
  },
  {
    id: "gagaoolala",
    match: /gagaoolala\.com/,
    containers: [".vjs-text-track-display", "[class*='subtitle']"],
    lines: [".vjs-text-track-cue", "div", "span"],
  },
  {
    // Local harness that mimics the Netflix DOM, so the whole pipeline can be
    // checked without a subscription or a login.
    id: "test",
    match: /localhost|127\.0\.0\.1/,
    containers: [".player-timedtext"],
    lines: [".player-timedtext-text-container"],
  },
];

const platform = PLATFORMS.find((p) => p.match.test(location.hostname));

let language = "ko";
let overlay = null;
let lastText = "";
let statusEl = null;
const cache = new Map();

if (platform) init();

async function init() {
  const stored = await chrome.storage.local.get(["language"]);
  language = stored.language || "ko";

  chrome.storage.onChanged.addListener((changes) => {
    if (changes.language) {
      language = changes.language.newValue;
      lastText = "";
      cache.clear();
    }
  });

  buildOverlay();
  // The player replaces subtitle nodes constantly, so polling the text is more
  // reliable than observing a container that itself gets swapped out.
  setInterval(tick, 300);
}

function buildOverlay() {
  overlay = document.createElement("div");
  overlay.className = "lexicon-overlay";
  overlay.innerHTML = `
    <div class="lexicon-bar">
      <span class="lexicon-brand">LEXICON</span>
      <span class="lexicon-hint">click a word to save it</span>
      <span class="lexicon-status"></span>
    </div>
    <div class="lexicon-line"></div>
  `;
  document.body.appendChild(overlay);
  statusEl = overlay.querySelector(".lexicon-status");
}

/* Find the element holding the current subtitle.
 *
 * Named selectors first. If none match — which is what a platform redesign
 * looks like — fall back to structure: the subtitle container sits on top of a
 * <video>, holds a short run of text, and is not a control. That is slower and
 * less precise, so it is only a safety net, but it means a class rename
 * degrades the extension instead of killing it.
 */
function findContainer() {
  for (const sel of platform.containers) {
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
    // Inside the video area, and in its lower half where subtitles live.
    const inside =
      r.left >= vr.left - 8 && r.right <= vr.right + 8 &&
      r.top >= vr.top + vr.height * 0.45 && r.bottom <= vr.bottom + 8;
    if (!inside) continue;
    // Prefer the deepest match, which is the cue rather than a wrapper.
    if (!best || el.compareDocumentPosition(best) & Node.DOCUMENT_POSITION_CONTAINS) {
      best = el;
    }
  }
  return best;
}

function currentSubtitle() {
  const container = findContainer();
  if (!container) return "";

  let nodes = [];
  for (const sel of platform.lines) {
    nodes = [...container.querySelectorAll(sel)];
    if (nodes.length) break;
  }
  const source = nodes.length ? nodes : [container];
  return source
    .map((n) => n.innerText || n.textContent || "")
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function setStatus(text, kind) {
  if (!statusEl) return;
  statusEl.textContent = text || "";
  statusEl.className = `lexicon-status ${kind || ""}`;
}

async function tick() {
  const text = currentSubtitle();
  if (text === lastText) return;
  lastText = text;

  const line = overlay.querySelector(".lexicon-line");
  if (!text) {
    line.innerHTML = "";
    overlay.classList.remove("visible");
    return;
  }
  overlay.classList.add("visible");
  line.textContent = text; // show the raw line immediately, enrich after

  const tokens = await tokenise(text);
  if (lastText !== text) return; // subtitle moved on while we were waiting
  render(line, text, tokens);
}

async function tokenise(text) {
  if (cache.has(text)) return cache.get(text);
  try {
    const res = await fetch(`${API}/api/tokenise`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, language }),
    });
    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();
    cache.set(text, data.tokens || []);
    setStatus("");
    return data.tokens || [];
  } catch {
    // Lexicon not running is the normal case for someone who just installed
    // this, so say so once rather than failing silently or shouting.
    setStatus("Lexicon not running on :4000", "bad");
    return [];
  }
}

function render(line, text, tokens) {
  if (!tokens.length) return;
  line.innerHTML = "";

  // Same character-ownership approach as the web app: tokens can overlap on a
  // single character, so each character gets exactly one owning token and the
  // original text renders once.
  const owner = new Array(text.length).fill(-1);
  const ordered = tokens
    .map((t, i) => ({ t, i }))
    .sort((a, b) => Number(b.t.content) - Number(a.t.content));
  for (const { t, i } of ordered) {
    for (let c = t.charStart; c < t.charEnd && c < text.length; c++) {
      if (owner[c] === -1) owner[c] = i;
    }
  }

  let start = 0;
  for (let c = 1; c <= text.length; c++) {
    if (c === text.length || owner[c] !== owner[start]) {
      const slice = text.slice(start, c);
      const token = owner[start] >= 0 ? tokens[owner[start]] : null;
      const span = document.createElement("span");
      span.textContent = slice;
      if (token && token.content) {
        span.className = "lexicon-tok";
        const gloss = token.senses?.length ? ` — ${token.senses[0]}` : "";
        span.title = `${token.lemma}${gloss}`;
        span.addEventListener("click", (e) => {
          e.stopPropagation(); // never let a click reach the player and pause it
          save(token, text, span);
        });
      }
      line.appendChild(span);
      start = c;
    }
  }
}

async function save(token, sentence, span) {
  span.classList.add("saving");
  try {
    const res = await fetch(`${API}/api/words/external`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        language,
        lemma: token.lemma,
        surface: token.surface,
        pos: token.pos,
        sentence,
        source: platform.id,
        sourceUrl: location.href,
      }),
    });
    span.classList.remove("saving");
    span.classList.add(res.ok ? "saved" : "failed");
  } catch {
    span.classList.remove("saving");
    span.classList.add("failed");
  }
}
