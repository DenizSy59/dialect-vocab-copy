import { useEffect, useMemo, useRef, useState } from "react";

function fmt(t) {
  if (t == null) return "--:--";
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

/* Green through amber to red as a segment gets harder.
 *
 * Interpolated in hue rather than picked from buckets, so a long video reads as
 * a gradient the eye can scan instead of three flat bands. Unscored segments
 * stay neutral rather than defaulting to green — "not measured" and "easy" must
 * not look the same.
 */
function difficultyColour(d) {
  if (d == null) return undefined;
  const hue = 145 - Math.max(0, Math.min(1, d)) * 145; // 145 green -> 0 red
  return `hsl(${hue} 70% 45%)`;
}

/* Decide which token owns each character of the segment text.
 *
 * Tokens can overlap: kiwi splits 왔 into 오/VV and 았/EP, both pointing at the
 * same character. Rendering token by token would print 오 and 었 where the
 * transcript says 왔. Assigning each character a single owner instead means the
 * original text always renders exactly once, and content tokens win ties so the
 * clickable region is the part worth saving.
 */
function ownership(text, tokens) {
  const owner = new Array(text.length).fill(-1);
  const order = tokens
    .map((t, i) => ({ t, i }))
    .sort((a, b) => Number(b.t.content) - Number(a.t.content));

  for (const { t, i } of order) {
    for (let c = t.charStart; c < t.charEnd && c < text.length; c++) {
      if (owner[c] === -1) owner[c] = i;
    }
  }

  // Group runs of consecutive characters with the same owner into spans.
  const runs = [];
  let start = 0;
  for (let c = 1; c <= text.length; c++) {
    if (c === text.length || owner[c] !== owner[start]) {
      runs.push({ text: text.slice(start, c), tokenIndex: owner[start] });
      start = c;
    }
  }
  return runs;
}

function SubtitleLine({ segment, active, savedLemmas, onSeek, onSaveWord }) {
  const runs = useMemo(
    () => ownership(segment.text, segment.tokens || []),
    [segment],
  );

  return (
    <div className={`sub-line ${active ? "on" : ""}`}>
      <span className="sub-time" onClick={() => onSeek(segment.start)}>
        {fmt(segment.start)}
      </span>
      <span className="sub-text">
        {runs.map((run, i) => {
          const token = run.tokenIndex >= 0 ? segment.tokens[run.tokenIndex] : null;
          const clickable = token && token.content;
          const saved = token && savedLemmas.has(token.lemma);
          return (
            <span
              key={i}
              className={`tok ${clickable ? "content" : "fn"} ${saved ? "saved" : ""}`}
              title={clickable ? `${token.lemma} · ${token.pos}` : undefined}
              onClick={() => clickable && onSaveWord(segment, run.tokenIndex)}
            >
              {run.text}
            </span>
          );
        })}
      </span>
    </div>
  );
}

export function Player({ video, segments, savedLemmas, onSaveWord }) {
  const videoRef = useRef(null);
  const listRef = useRef(null);
  const [time, setTime] = useState(0);

  // timeupdate fires about four times a second, which is visibly late for
  // highlighting a word. rAF while playing keeps the subtitle in step.
  useEffect(() => {
    let raf;
    const tick = () => {
      const el = videoRef.current;
      if (el) setTime(el.currentTime);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const activeIndex = useMemo(() => {
    if (!segments.length) return -1;
    return segments.findIndex((s) => time >= s.start && time <= s.end);
  }, [time, segments]);

  // Follow the active line, but only when it changes, so the user can still
  // scroll back through the transcript without being yanked forward.
  useEffect(() => {
    if (activeIndex < 0 || !listRef.current) return;
    const el = listRef.current.children[activeIndex];
    if (el) el.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [activeIndex]);

  const duration = video.durationSec || segments.at(-1)?.end || 1;

  function seek(t) {
    if (videoRef.current) {
      videoRef.current.currentTime = t;
      videoRef.current.play().catch(() => {});
    }
  }

  return (
    <div className="panel">
      <div className="stage">
        <video ref={videoRef} src={`/media/${video.filename}`} controls playsInline />
        <div
          className="timeline"
          title="Segments by time — difficulty colouring goes here"
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            seek(((e.clientX - rect.left) / rect.width) * duration);
          }}
        >
          {segments.map((s, i) => (
            <div
              key={s._id}
              className={`timeline-seg ${i === activeIndex ? "on" : ""}`}
              title={
                s.difficulty != null
                  ? `${fmt(s.start)} · difficulty ${s.difficulty.toFixed(2)}`
                  : fmt(s.start)
              }
              style={{
                left: `${(s.start / duration) * 100}%`,
                width: `${Math.max(((s.end - s.start) / duration) * 100, 0.4)}%`,
                background: i === activeIndex ? undefined : difficultyColour(s.difficulty),
              }}
              onClick={(e) => {
                e.stopPropagation();
                seek(s.start);
              }}
            />
          ))}
          <div className="timeline-head" style={{ left: `${(time / duration) * 100}%` }} />
        </div>
      </div>

      <div className="panel-head" style={{ borderTop: "1px solid var(--line)" }}>
        <span>◇</span> Transcript
        <span className="spacer" />
        {segments.some((s) => s.difficulty != null) && (
          <span className="legend">
            easy <span className="legend-ramp" /> hard
          </span>
        )}
        <span className="muted">
          click an underlined word to save it · {segments.length} segments
        </span>
      </div>
      <div className="subs" ref={listRef}>
        {segments.length === 0 && <div className="empty">No segments.</div>}
        {segments.map((s, i) => (
          <SubtitleLine
            key={s._id}
            segment={s}
            active={i === activeIndex}
            savedLemmas={savedLemmas}
            onSeek={seek}
            onSaveWord={onSaveWord}
          />
        ))}
      </div>
    </div>
  );
}
