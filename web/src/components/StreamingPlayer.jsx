import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api.js";

/* Streaming platform inside the desktop shell.
 *
 * The video itself is not in this component. It is a native view the shell
 * positions over the empty rectangle below — the site is a real top-level page
 * as far as it is concerned, which is the only reason DRM playback works at
 * all. This component reserves the space, reports where it is, and owns
 * everything around it.
 *
 * Subtitles arrive as plain text over IPC and are rendered here rather than
 * drawn onto the streaming page, so the words use our fonts, our theme and our
 * click handling, and the deck behaves exactly as it does for uploads.
 */
export function StreamingPlayer({ platform, language, onLanguage, onExit, t, showReading }) {
  const slotRef = useRef(null);
  const [line, setLine] = useState("");
  const [tokens, setTokens] = useState([]);
  const [saved, setSaved] = useState(new Set());
  // What the server decided the subtitle language actually is.
  const [detected, setDetected] = useState("");
  const [history, setHistory] = useState([]);
  const cache = useRef(new Map());

  // Tell the shell where the player rectangle is, and keep telling it whenever
  // the layout moves. Without the observer the video detaches from its slot on
  // any resize or theme change that shifts things by a pixel.
  useEffect(() => {
    const el = slotRef.current;
    if (!el || !window.lexicon) return;

    const report = () => {
      const r = el.getBoundingClientRect();
      window.lexicon.setPlayerBounds({
        x: r.left,
        y: r.top,
        width: r.width,
        height: r.height,
      });
    };

    report();
    const ro = new ResizeObserver(report);
    ro.observe(el);
    window.addEventListener("resize", report);
    window.addEventListener("scroll", report, true);

    return () => {
      ro.disconnect();
      window.removeEventListener("resize", report);
      window.removeEventListener("scroll", report, true);
    };
  }, []);

  // Open the platform once, and take the view away when leaving so it does not
  // sit invisibly over another screen.
  useEffect(() => {
    if (!window.lexicon) return;
    window.lexicon.openPlatform(platform.id);
    return () => window.lexicon.closePlatform();
  }, [platform.id]);

  const tokenise = useCallback(
    async (text) => {
      // Keyed by language as well as text: the same line tokenises differently
      // per language, and caching on text alone returned Korean tokens after
      // switching the picker to Chinese.
      const key = `${language}:${text}`;
      if (cache.current.has(key)) return cache.current.get(key);
      try {
        const res = await fetch("/api/tokenise", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, language }),
        });
        if (!res.ok) throw new Error(await res.text());
        const data = await res.json();
        if (data.language) setDetected(data.language);
        cache.current.set(key, data.tokens || []);
        return data.tokens || [];
      } catch {
        return [];
      }
    },
    [language],
  );

  useEffect(() => {
    if (!window.lexicon) return;
    let current = "";
    return window.lexicon.onSubtitle(async (text) => {
      current = text;
      setLine(text);
      setTokens([]);
      if (!text) return;
      const toks = await tokenise(text);
      // The subtitle may have moved on while the request was in flight.
      if (current !== text) return;
      setTokens(toks);
      setHistory((h) => (h[0]?.text === text ? h : [{ text, toks }, ...h].slice(0, 40)));
    });
  }, [tokenise]);

  /* Clicking a saved word again takes it back out.
   *
   * Only this encounter is removed, not the word — the same word saved from
   * another scene keeps its own clip. A misclick should be undoable without
   * losing everything collected elsewhere.
   */
  async function save(token) {
    const lang = detected || language;
    const already = saved.has(token.lemma);
    try {
      if (already) {
        await fetch("/api/words/unsave", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ language: lang, lemma: token.lemma, sentence: line }),
        });
        setSaved((s) => {
          const n = new Set(s);
          n.delete(token.lemma);
          return n;
        });
        return;
      }
      await fetch("/api/words/external", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          language: lang,
          lemma: token.lemma,
          surface: token.surface,
          pos: token.pos,
          reading: token.reading || "",
          sentence: line,
          source: platform.id,
        }),
      });
      setSaved((s) => new Set(s).add(token.lemma));
    } catch {
      /* the deck panel will simply not show it */
    }
  }

  return (
    <div className="stream">
      <div className="stream-bar">
        <button className="ghost" onClick={onExit}>
          ← {t("source")}
        </button>
        <span className="source-icon">{platform.icon}</span>
        <strong>{platform.name}</strong>
        <span className="spacer" />
        {/* Detected from the subtitle script rather than chosen. The player's
            subtitle language changes without telling us, so a picker was a
            question the user had to keep answering — and answering wrongly
            meant nothing was clickable. */}
        <span className="tag">
          {detected ? `detected: ${detected}` : "waiting for subtitles"}
        </span>
      </div>

      {/* The native view is positioned over this. It must stay empty. */}
      <div className="stream-slot" ref={slotRef} />

      <div className="stream-subs">
        {!line && (
          <div className="stream-hint">
            Log in and play something with subtitles on. Lines appear here, and
            clicking a word saves it to your deck.
          </div>
        )}
        {line && (
          <div className="stream-line">
            {tokens.length === 0
              ? line
              : renderTokens(line, tokens, saved, save, showReading)}
          </div>
        )}
      </div>

      {history.length > 1 && (
        <div className="stream-history">
          {history.slice(1, 6).map((h, i) => (
            <div key={i} className="stream-past">
              {h.text}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* Give every character exactly one owning token, so overlapping tokens do not
 * duplicate text. Same approach as the transcript view — kiwi can return two
 * tokens pointing at one character, and rendering both prints it twice.
 */
function renderTokens(text, tokens, saved, save, showReading) {
  const owner = new Array(text.length).fill(-1);
  const ordered = tokens
    .map((t, i) => ({ t, i }))
    .sort((a, b) => Number(b.t.content) - Number(a.t.content));
  for (const { t, i } of ordered) {
    for (let c = t.charStart; c < t.charEnd && c < text.length; c++) {
      if (owner[c] === -1) owner[c] = i;
    }
  }

  const out = [];
  let start = 0;
  for (let c = 1; c <= text.length; c++) {
    if (c === text.length || owner[c] !== owner[start]) {
      const slice = text.slice(start, c);
      const token = owner[start] >= 0 ? tokens[owner[start]] : null;
      const clickable = token && token.content;
      out.push(
        <span
          key={start}
          className={`tok ${clickable ? "content" : "fn"} ${
            token && saved.has(token.lemma) ? "saved" : ""
          }`}
          title={
            clickable
              ? `${token.lemma}${token.senses?.length ? " — " + token.senses[0] : ""}`
              : undefined
          }
          onClick={() => clickable && save(token)}
        >
          {showReading && token?.reading ? (
            <ruby>
              {slice}
              <rt>{token.reading}</rt>
            </ruby>
          ) : (
            slice
          )}
        </span>,
      );
      start = c;
    }
  }
  return out;
}
