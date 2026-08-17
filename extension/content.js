/* Overlay clickable vocabulary on a streaming platform's own subtitles.
 *
 * This exists because DRM leaves no alternative. Widevine means the decrypted
 * audio samples are unreadable, so Whisper cannot run on Netflix or Prime Video
 * at all, and both refuse to be embedded in another page. What *is* readable is
 * the subtitle text the player already rendered into the DOM — which is how
 * Language Reactor works too.
 *
 * Consequences, all of them DRM's doing rather than shortcuts:
 *   - no word-level timings, so no video clips on this route
 *   - dialect detection is text-only
 *   - subtitle quality is whatever the platform shipped
 *
 * The tokenising, lemmatising and dictionary lookup still come from the same
 * API as the uploaded-file route, so a word saved here lands in the same deck
 * with the same lemma.
 */

const API = "http://localhost:4000";

// Each platform renders subtitles into its own container. Kept as a table
// because these selectors are the most brittle part of the whole project — when
// a platform ships a redesign, this is the line that breaks, and it should be
// obvious where to fix it.
const PLATFORMS = [
  {
    id: "netflix",
    match: /netflix\.com/,
    // Netflix renders cues into .player-timedtext, one div per line.
    container: ".player-timedtext",
    lines: ".player-timedtext-text-container",
  },
  {
    id: "prime",
    match: /primevideo\.com/,
    container: ".atvwebplayersdk-captions-overlay",
    lines: ".atvwebplayersdk-captions-text",
  },
  {
    id: "gagaoolala",
    match: /gagaoolala\.com/,
    container: ".vjs-text-track-display",
    lines: ".vjs-text-track-cue",
  },
];

const platform = PLATFORMS.find((p) => p.match.test(location.hostname));
if (platform) init();

let language = "ko";
let overlay = null;
let lastText = "";
const cache = new Map();

async function init() {
  const stored = await chrome.storage.local.get(["language"]);
  language = stored.language || "ko";

  chrome.storage.onChanged.addListener((changes) => {
    if (changes.language) {
      language = changes.language.newValue;
      lastText = ""; // force a re-render in the new language
    }
  });

  buildOverlay();
  // The player re-renders subtitle nodes constantly, so polling the text is
  // more reliable than trying to observe a container that gets replaced.
  setInterval(tick, 300);
}

function buildOverlay() {
  overlay = document.createElement("div");
  overlay.className = "lexicon-overlay";
  overlay.innerHTML = `
    <div class="lexicon-bar">
      <span class="lexicon-brand">LEXICON</span>
      <span class="lexicon-hint">click a word to save it</span>
    </div>
    <div class="lexicon-line"></div>
  `;
  document.body.appendChild(overlay);
}

function currentSubtitle() {
  const container = document.querySelector(platform.container);
  if (!container) return "";
  const nodes = container.querySelectorAll(platform.lines);
  const text = (nodes.length ? [...nodes] : [container])
    .map((n) => n.innerText || n.textContent || "")
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  return text;
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
  // The subtitle may have changed while the request was in flight.
  if (lastText !== text) return;
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
    return data.tokens || [];
  } catch {
    // Lexicon not running is the normal case for someone who just installed
    // this, so fail quietly to the plain subtitle rather than shouting.
    return [];
  }
}

function render(line, text, tokens) {
  if (!tokens.length) return;
  line.innerHTML = "";

  // Same character-ownership approach the web app uses: tokens can overlap on
  // one character, so each character gets exactly one owning token and the
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
        span.title = `${token.lemma}${token.senses?.length ? " — " + token.senses[0] : ""}`;
        span.addEventListener("click", () => save(token, text, span));
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
