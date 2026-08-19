import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api.js";
import { parseSubtitles, formatTime } from "../subtitles.js";
import { ownership } from "../tokens.js";

/* Subtitles running alongside a video this app cannot play.
 *
 * Netflix, Prime, Viki and the rest refuse to be embedded and their video is
 * encrypted, so no website can play them. What a website *can* do is keep the
 * words: load the episode's subtitle file, run a clock alongside it, and show
 * each line as it comes up with everything clickable.
 *
 * You watch on Netflix as normal — another window, another screen, the TV — and
 * press play here at the same moment. It behaves like karaoke lyrics.
 *
 * No extension, no install, and it works for any platform at all, because it
 * never touches the player. The cost is that there is no video here, so no
 * clips, and sync is your responsibility — hence the offset control, which is
 * the one thing that has to be easy.
 */

// Poll rate for the clock. Fast enough that a line never looks late, cheap
// enough to be irrelevant.
const TICK_MS = 100;

const glossCache = new Map();

function Token({ token, text, language, saved, onSave }) {
  const [hover, setHover] = useState(false);
  const [gloss, setGloss] = useState(() =>
    token ? glossCache.get(`${language}:${token.lemma}`) : null,
  );

  useEffect(() => {
    if (!hover || !token?.content) return;
    const key = `${language}:${token.lemma}`;
    if (glossCache.has(key)) return setGloss(glossCache.get(key));
    let cancelled = false;
    api
      .lookup(language, token.lemma, token.surface)
      .then((r) => {
        glossCache.set(key, r);
        if (!cancelled) setGloss(r);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [hover, token, language]);

  if (!token || !token.content) return <span className="tok fn">{text}</span>;

  return (
    <span
      className={`tok content ${saved ? "saved" : ""}`}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={onSave}
      title={gloss?.senses?.length ? gloss.senses[0] : token.lemma}
    >
      {text}
    </span>
  );
}

function Line({ cue, language, savedLemmas, onSave, big }) {
  const [tokens, setTokens] = useState(null);

  useEffect(() => {
    let cancelled = false;
    api
      .tokenise(cue.text, language)
      .then((r) => !cancelled && setTokens(r.tokens || []))
      .catch(() => !cancelled && setTokens([]));
    return () => {
      cancelled = true;
    };
  }, [cue, language]);

  // Show the raw line until the tokens arrive, so nothing ever looks empty.
  if (!tokens) return <div className={big ? "cue-now" : "cue-side"}>{cue.text}</div>;

  // Rendered by character run, not token by token, so the original spacing and
  // punctuation survive — otherwise Korean and Turkish words run together.
  const runs = ownership(cue.text, tokens);
  return (
    <div className={big ? "cue-now" : "cue-side"}>
      {runs.map((run, i) => {
        const token = run.tokenIndex >= 0 ? tokens[run.tokenIndex] : null;
        return (
          <Token
            key={i}
            token={token}
            text={run.text}
            language={language}
            saved={!!token && savedLemmas.has(token.lemma)}
            onSave={() => token && onSave(token, cue.text)}
          />
        );
      })}
    </div>
  );
}

export function Companion({ platform }) {
  const [cues, setCues] = useState([]);
  const [fileName, setFileName] = useState("");
  const [language, setLanguage] = useState("ko");
  const [playing, setPlaying] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [offset, setOffset] = useState(0);
  const [saved, setSaved] = useState([]);
  const [error, setError] = useState("");
  const inputRef = useRef(null);
  const startedAt = useRef(0);

  // The clock is wall-time based rather than an accumulating counter, so it
  // cannot drift away from the episode over forty minutes.
  useEffect(() => {
    if (!playing) return;
    startedAt.current = Date.now() - elapsed * 1000;
    const id = setInterval(() => {
      setElapsed((Date.now() - startedAt.current) / 1000);
    }, TICK_MS);
    return () => clearInterval(id);
  }, [playing]); // eslint-disable-line react-hooks/exhaustive-deps

  const t = elapsed + offset;
  const index = useMemo(() => {
    if (!cues.length) return -1;
    // Last cue that has started. Using "started" rather than "started and not
    // ended" means the line stays on screen through the gaps between cues,
    // which is what you want when you are reading rather than glancing.
    let lo = 0, hi = cues.length - 1, found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (cues[mid].start <= t) {
        found = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return found;
  }, [cues, t]);

  const savedLemmas = useMemo(() => new Set(saved.map((w) => w.lemma)), [saved]);

  const refreshSaved = useCallback(() => {
    api.listWords(null, language).then(setSaved).catch(() => {});
  }, [language]);

  useEffect(() => {
    refreshSaved();
  }, [refreshSaved]);

  async function loadFile(file) {
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = parseSubtitles(text);
      if (!parsed.length) {
        setError("No subtitles found in that file. It should be .srt or .vtt.");
        return;
      }
      setError("");
      setCues(parsed);
      setFileName(file.name);
      setElapsed(0);
      setOffset(0);
      setPlaying(false);
    } catch (e) {
      setError(e.message);
    }
  }

  async function save(token, sentence) {
    try {
      await api.saveExternal({
        language,
        lemma: token.lemma,
        surface: token.surface,
        pos: token.pos,
        sentence,
        source: platform?.id || "companion",
      });
      refreshSaved();
    } catch (e) {
      setError(e.message);
    }
  }

  function jump(seconds) {
    setElapsed((e) => Math.max(0, e + seconds));
    startedAt.current = Date.now() - Math.max(0, elapsed + seconds) * 1000;
  }

  if (!cues.length) {
    return (
      <div className="panel">
        <div className="panel-head">
          <span>◎</span> Subtitle companion
        </div>
        <div className="panel-body">
          <p className="source-detail" style={{ marginTop: 0 }}>
            <strong>Watch on {platform?.name || "any platform"} as normal.</strong>{" "}
            Load the episode's subtitle file here, press play at the same moment
            you press play there, and the lines will scroll along with it — every
            word clickable, like karaoke lyrics beside the screen.
          </p>
          <p className="source-detail">
            Nothing is installed and nothing touches the player, so this works
            for Netflix, Prime, Viki, iQIYI, GagaOOLala — anything at all. You
            will not get video clips, because the video is not here.
          </p>

          <div
            className="dropzone"
            style={{ marginTop: 16 }}
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              loadFile(e.dataTransfer.files?.[0]);
            }}
          >
            <strong>Drop a subtitle file</strong>
            .srt or .vtt — search "&lt;show name&gt; korean subtitles srt"
          </div>
          <input
            ref={inputRef}
            type="file"
            accept=".srt,.vtt,text/plain"
            hidden
            onChange={(e) => loadFile(e.target.files?.[0])}
          />

          <label className="field" style={{ marginTop: 14 }}>
            Subtitle language
            <select value={language} onChange={(e) => setLanguage(e.target.value)}>
              <option value="ko">Korean</option>
              <option value="zh">Chinese</option>
              <option value="tr">Turkish</option>
            </select>
          </label>

          {error && <div className="error-box" style={{ marginTop: 12 }}>{error}</div>}
        </div>
      </div>
    );
  }

  const current = index >= 0 ? cues[index] : null;

  return (
    <div className="panel">
      <div className="panel-head">
        <span>◎</span> {fileName}
        <span className="spacer" />
        <span className="muted">{cues.length} lines</span>
        <button className="ghost" onClick={() => setCues([])}>
          ✕
        </button>
      </div>

      <div className="companion">
        <div className="cue-stage">
          {index > 0 && (
            <Line
              cue={cues[index - 1]}
              language={language}
              savedLemmas={savedLemmas}
              onSave={save}
            />
          )}
          {current ? (
            <Line
              cue={current}
              language={language}
              savedLemmas={savedLemmas}
              onSave={save}
              big
            />
          ) : (
            <div className="cue-now dim">
              press play when the episode starts
            </div>
          )}
          {index + 1 < cues.length && (
            <Line
              cue={cues[index + 1]}
              language={language}
              savedLemmas={savedLemmas}
              onSave={save}
            />
          )}
        </div>

        <div className="transport">
          <button className="primary big-play" onClick={() => setPlaying((p) => !p)}>
            {playing ? "❚❚" : "▶"}
          </button>
          <span className="clock">{formatTime(t)}</span>

          <button onClick={() => jump(-10)}>−10s</button>
          <button onClick={() => jump(10)}>+10s</button>

          <span className="spacer" />

          {/* The one control that has to be obvious: if the lines run early or
              late, this is how you fix it without restarting. */}
          <span className="offset">
            <span className="offset-label">sync</span>
            <button onClick={() => setOffset((o) => o - 0.5)}>−</button>
            <span className="offset-value">{offset.toFixed(1)}s</span>
            <button onClick={() => setOffset((o) => o + 0.5)}>+</button>
          </span>
        </div>

        <div className="companion-hint">
          Lines running early? Press <strong>−</strong>. Running late? Press{" "}
          <strong>+</strong>. Saved words go to your {language.toUpperCase()} deck.
        </div>
      </div>

      {error && <div className="error-box" style={{ margin: 16 }}>{error}</div>}
    </div>
  );
}
