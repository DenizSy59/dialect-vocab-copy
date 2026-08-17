import { useEffect, useMemo, useState } from "react";
import { api } from "../api.js";
import { languageName } from "../i18n.js";

/* Saved words, grouped by the language they belong to, then studied.
 *
 * Grouping by language rather than by video is the right axis for a learner:
 * you study Korean, not "that interview from Tuesday". Only languages that
 * actually have saved words appear, so the list reflects what you have
 * collected rather than what the app supports.
 */

/* A study session over one language's words.
 *
 * Modelled on Anki's review loop but deliberately not a spaced-repetition
 * implementation: real scheduling needs persisted intervals and ease factors,
 * and inventing a half-version of SM-2 that silently forgets state between
 * sessions would be worse than an honest in-session queue.
 *
 * "Again" pushes the card back into the queue; "Good" and "Easy" retire it for
 * this session. Progress is not saved yet.
 */
function StudySession({ words, t, uiLanguage, onExit }) {
  const [queue, setQueue] = useState(() => words.map((w) => w._id));
  const [revealed, setRevealed] = useState(false);
  const [seen, setSeen] = useState(0);

  const byId = useMemo(() => Object.fromEntries(words.map((w) => [w._id, w])), [words]);
  const current = queue.length ? byId[queue[0]] : null;

  function grade(action) {
    setRevealed(false);
    setSeen((n) => n + 1);
    setQueue((q) => {
      const [head, ...rest] = q;
      // Again sends it to the back rather than immediately again, so you get
      // some distance from the answer you just read.
      return action === "again" ? [...rest, head] : rest;
    });
  }

  if (!current) {
    return (
      <div className="panel">
        <div className="panel-head">
          <span>★</span> {t("studyDeck")}
          <span className="spacer" />
          <button className="ghost" onClick={onExit}>
            {t("backToLibrary")}
          </button>
        </div>
        <div className="empty" style={{ padding: 48 }}>
          <div style={{ fontSize: 34, marginBottom: 10 }}>✓</div>
          {t("done")} — {seen} {t("wordsCount")}
        </div>
      </div>
    );
  }

  return (
    <div className="panel">
      <div className="panel-head">
        <span>★</span> {t("studyDeck")}
        <span className="spacer" />
        <span className="muted">
          {queue.length} {t("cardsLeft")}
        </span>
        <button className="ghost" onClick={onExit}>
          {t("backToLibrary")}
        </button>
      </div>

      <div className="card-stage">
        <div className="card-front">{current.lemma}</div>
        {current.pinyin && <div className="card-reading">{current.pinyin}</div>}

        {revealed ? (
          <>
            <div className="card-sense">
              {current.senses?.length
                ? current.senses.join("; ")
                : t("noDictionary")}
            </div>
            {current.sentence && (
              <div className="card-sentence">
                {current.sentence}
                {current.sentenceEnglish && (
                  <div className="card-sentence-en">{current.sentenceEnglish}</div>
                )}
              </div>
            )}
            {/* The clip is the reason for saving from video rather than a word
                list, so it belongs on the answer side of the card. */}
            <video className="card-clip" src={api.clipUrl(current._id)} controls />

            <div className="card-actions">
              <button onClick={() => grade("again")}>{t("again")}</button>
              <button onClick={() => grade("good")}>{t("good")}</button>
              <button className="primary" onClick={() => grade("easy")}>
                {t("easyBtn")}
              </button>
            </div>
          </>
        ) : (
          <button
            className="primary card-reveal"
            onClick={() => setRevealed(true)}
          >
            {t("showAnswer")}
          </button>
        )}
      </div>
    </div>
  );
}

export function DeckLibrary({ t, uiLanguage, onExit }) {
  const [words, setWords] = useState([]);
  const [language, setLanguage] = useState(null);
  const [studying, setStudying] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .listWords()
      .then((w) => setWords(w))
      .catch(() => setWords([]))
      .finally(() => setLoading(false));
  }, []);

  // A word knows its language either directly (extension route) or through the
  // video it came from, which the API resolves for us.
  const groups = useMemo(() => {
    const map = new Map();
    for (const w of words) {
      const code = w.language || w.videoLanguage;
      if (!code) continue;
      if (!map.has(code)) map.set(code, []);
      map.get(code).push(w);
    }
    return [...map.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [words]);

  const selected = language ? groups.find(([c]) => c === language) : null;

  if (studying && selected) {
    return (
      <StudySession
        words={selected[1]}
        t={t}
        uiLanguage={uiLanguage}
        onExit={() => setStudying(false)}
      />
    );
  }

  if (selected) {
    return (
      <div className="panel">
        <div className="panel-head">
          <span>★</span> {languageName(selected[0], uiLanguage)}
          <span className="spacer" />
          <span className="muted">
            {selected[1].length} {t("wordsCount")}
          </span>
          <button className="ghost" onClick={() => setLanguage(null)}>
            {t("backToLibrary")}
          </button>
        </div>
        <div className="panel-body">
          <div className="study-row">
            <button className="primary" onClick={() => setStudying(true)}>
              {t("startStudy")}
            </button>
            <a href={api.exportUrl(null, selected[0])} download>
              <button>{t("exportAnki")}</button>
            </a>
          </div>

          <div className="word-grid">
            {selected[1].map((w) => (
              <div key={w._id} className="word-chip">
                <span className="word-chip-lemma">{w.lemma}</span>
                <span className="word-chip-sense">
                  {w.senses?.length ? w.senses[0] : "—"}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="panel">
      <div className="panel-head">
        <span>★</span> {t("studyDeck")}
        <span className="spacer" />
        <button className="ghost" onClick={onExit}>
          {t("backToLibrary")}
        </button>
      </div>
      <div className="panel-body">
        {loading && <div className="empty">…</div>}
        {!loading && groups.length === 0 && (
          <div className="empty">{t("emptyDeck")}</div>
        )}
        <div className="lang-grid">
          {groups.map(([code, list]) => (
            <button
              key={code}
              className="lang-card"
              onClick={() => setLanguage(code)}
            >
              <span className="lang-card-name">{languageName(code, uiLanguage)}</span>
              <span className="lang-card-count">
                {list.length} {t("wordsCount")}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
