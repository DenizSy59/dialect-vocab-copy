import { useCallback, useEffect, useState } from "react";
import { languageName } from "../i18n.js";

/* Levelled vocabulary course, with quizzes drawn from your own videos.
 *
 * Three screens: the roadmap of levels, the word list for one level, and a
 * quiz. The quiz is the interesting one — its example sentences come from
 * videos you transcribed, so the same word is practised in the context you met
 * it in, with the clip of it being said. A fixed sentence bank would be easier
 * and would lose exactly the thing this project is for.
 */

/* Language picker: the first screen of the course.
 *
 * Previously the course opened on Korean with a dropdown in the header, which
 * buried the other three and made the language read as a setting rather than
 * the choice it actually is. Same shape as the deck, so the two halves of the
 * app behave alike.
 */
function LanguagePicker({ languages, onPick, uiLanguage }) {
  return (
    <div className="panel">
      <div className="panel-head">
        <span>◈</span> Course
        <span className="spacer" />
        <span className="muted">{languages.length} languages</span>
      </div>
      <div className="panel-body">
        {languages.length === 0 && (
          <div className="empty">
            No course built yet. Run <code>python src/curriculum.py</code> in{" "}
            <code>ml/</code>.
          </div>
        )}
        <div className="lang-grid">
          {languages.map((l) => {
            const pct = l.total ? Math.round((l.known / l.total) * 100) : 0;
            return (
              <button key={l.lang} className="lang-card" onClick={() => onPick(l.lang)}>
                <span className="lang-card-name">{languageName(l.lang, uiLanguage)}</span>
                <span className="lang-card-count">
                  {l.known} / {l.total} words · {l.levels} levels
                </span>
                {/* Says which levels are a published standard and which are our
                    own banding, because those are different claims. */}
                <span className="tag">{l.standard}</span>
                <span className="bar" style={{ width: "100%", marginTop: 8 }}>
                  <i style={{ width: `${pct}%` }} />
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Roadmap({ lang, levels, onPick, onBack, uiLanguage }) {
  const totalKnown = levels.reduce((a, l) => a + l.known, 0);
  const total = levels.reduce((a, l) => a + l.total, 0);

  return (
    <div className="panel">
      <div className="panel-head">
        <span>◈</span> {languageName(lang, uiLanguage)}
        <span className="spacer" />
        <span className="muted">
          {totalKnown} / {total} words
        </span>
        <button className="ghost" onClick={onBack}>
          Back
        </button>
      </div>
      <div className="panel-body">

        <div className="road">
          {levels.map((l, i) => {
            const pct = l.total ? Math.round((l.known / l.total) * 100) : 0;
            // A level unlocks when the one before it is half done, so the path
            // stays ordered without blocking someone who wants to push ahead.
            const locked = i > 0 && levels[i - 1].known < levels[i - 1].total * 0.5;
            return (
              <button
                key={l.level}
                className={`road-node ${locked ? "locked" : ""} ${pct === 100 ? "done" : ""}`}
                onClick={() => onPick(l.level)}
                title={locked ? "Finish half of the previous level first" : ""}
              >
                <span className="road-num">{l.level}</span>
                <span className="road-body">
                  <span className="road-title">
                    {l.standard === "HSK 3.0" ? `HSK ${l.level}` : `Level ${l.level}`}
                  </span>
                  <span className="road-count">
                    {l.known} / {l.total}
                  </span>
                  <span className="bar">
                    <i style={{ width: `${pct}%` }} />
                  </span>
                </span>
              </button>
            );
          })}
        </div>

        {/* The two sources are not equivalent and the difference matters: HSK is
            a published standard, our banding is not. */}
        {levels[0] && (
          <div className="muted" style={{ marginTop: 14 }}>
            {levels[0].standard === "HSK 3.0"
              ? "Levels follow HSK 3.0, the official Chinese proficiency standard."
              : "No open levelled word list exists for this language, so levels are frequency-ranked — commonest words first. That is a convention, not a standard."}
          </div>
        )}
      </div>
    </div>
  );
}

function LevelView({ lang, level, onBack, onQuiz }) {
  const [words, setWords] = useState([]);

  useEffect(() => {
    fetch(`/api/curriculum/level/${level}?lang=${lang}`)
      .then((r) => r.json())
      .then((d) => setWords(d.words || []))
      .catch(() => setWords([]));
  }, [lang, level]);

  const met = words.filter((w) => w.inYourVideos).length;

  return (
    <div className="panel">
      <div className="panel-head">
        <span>◇</span> Level {level}
        <span className="spacer" />
        <span className="muted">{words.length} words</span>
        <button className="ghost" onClick={onBack}>
          Back
        </button>
      </div>
      <div className="panel-body">
        <div className="study-row">
          <button className="primary" onClick={onQuiz}>
            Practise
          </button>
          <span className="muted" style={{ alignSelf: "center" }}>
            {met} of these appear in videos you have transcribed
          </span>
        </div>

        <div className="word-grid">
          {words.map((w) => (
            <div key={w.word} className={`word-chip ${w.status}`}>
              <span className="word-chip-lemma">
                {w.word}
                {w.inYourVideos && <span className="seen-dot" title="in your videos" />}
              </span>
              {w.pinyin && <span className="word-chip-sense">{w.pinyin}</span>}
              <span className="word-chip-sense">{w.senses[0] || "—"}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Quiz({ lang, level, onExit }) {
  const [questions, setQuestions] = useState(null);
  const [i, setI] = useState(0);
  const [chosen, setChosen] = useState(null);
  const [score, setScore] = useState({ right: 0, wrong: 0 });

  useEffect(() => {
    fetch(`/api/curriculum/quiz?lang=${lang}&level=${level}&count=10`)
      .then((r) => r.json())
      .then((d) => setQuestions(d.questions || []))
      .catch(() => setQuestions([]));
  }, [lang, level]);

  const answer = useCallback(
    (option) => {
      if (chosen) return; // one answer per question
      const q = questions[i];
      const correct = option === q.answer;
      setChosen(option);
      setScore((s) => ({
        right: s.right + (correct ? 1 : 0),
        wrong: s.wrong + (correct ? 0 : 1),
      }));
      fetch("/api/curriculum/answer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lang, word: q.word, correct }),
      }).catch(() => {});
    },
    [chosen, questions, i, lang],
  );

  if (!questions) return <div className="panel"><div className="empty">…</div></div>;

  if (questions.length === 0) {
    return (
      <div className="panel">
        <div className="panel-head">
          <span>◈</span> Practice
          <span className="spacer" />
          <button className="ghost" onClick={onExit}>Back</button>
        </div>
        <div className="empty" style={{ padding: 40 }}>
          Not enough words with definitions at this level to build a quiz.
        </div>
      </div>
    );
  }

  if (i >= questions.length) {
    return (
      <div className="panel">
        <div className="panel-head">
          <span>◈</span> Practice
          <span className="spacer" />
          <button className="ghost" onClick={onExit}>Back</button>
        </div>
        <div className="card-stage">
          <div style={{ fontSize: 40 }}>✓</div>
          <div className="card-sense">
            {score.right} right, {score.wrong} wrong
          </div>
          <button className="primary" onClick={onExit}>Done</button>
        </div>
      </div>
    );
  }

  const q = questions[i];

  return (
    <div className="panel">
      <div className="panel-head">
        <span>◈</span> Practice
        <span className="spacer" />
        <span className="muted">
          {i + 1} / {questions.length}
        </span>
        <button className="ghost" onClick={onExit}>Back</button>
      </div>

      <div className="quiz">
        {/* Context first, when it exists. Reading the sentence before the
            options is the point — the word is masked so it cannot be guessed
            from a translation sitting next to it. */}
        {q.example ? (
          <div className="quiz-context">
            <div className="quiz-sentence">{q.example.masked}</div>
            {q.example.videoName && (
              <div className="quiz-source">from {q.example.videoName}</div>
            )}
            {q.example.videoId && (
              <video
                className="quiz-clip"
                src={`/media/clip-placeholder`}
                controls
                style={{ display: "none" }}
              />
            )}
          </div>
        ) : (
          <div className="quiz-source">not yet seen in your videos</div>
        )}

        <div className="quiz-word">
          {q.word}
          {q.pinyin && <span className="quiz-pinyin">{q.pinyin}</span>}
        </div>

        <div className="quiz-options">
          {q.options.map((o) => {
            const state = !chosen
              ? ""
              : o === q.answer
                ? "right"
                : o === chosen
                  ? "wrong"
                  : "dim";
            return (
              <button key={o} className={`quiz-option ${state}`} onClick={() => answer(o)}>
                {o}
              </button>
            );
          })}
        </div>

        {chosen && (
          <button
            className="primary"
            onClick={() => {
              setChosen(null);
              setI((n) => n + 1);
            }}
          >
            Next
          </button>
        )}
      </div>
    </div>
  );
}

export function Curriculum({ uiLanguage, onExit }) {
  // null until a language is chosen, so the picker is the entry point.
  const [lang, setLang] = useState(null);
  const [languages, setLanguages] = useState([]);
  const [levels, setLevels] = useState([]);
  const [level, setLevel] = useState(null);
  const [quiz, setQuiz] = useState(false);

  const loadLanguages = useCallback(() => {
    fetch("/api/curriculum/languages")
      .then((r) => r.json())
      .then((d) => setLanguages(d.languages || []))
      .catch(() => setLanguages([]));
  }, []);

  const load = useCallback(() => {
    if (!lang) return;
    fetch(`/api/curriculum?lang=${lang}`)
      .then((r) => r.json())
      .then((d) => setLevels(d.levels || []))
      .catch(() => setLevels([]));
  }, [lang]);

  useEffect(() => {
    loadLanguages();
  }, [loadLanguages]);

  useEffect(() => {
    load();
  }, [load]);

  if (!lang) {
    return (
      <LanguagePicker
        languages={languages}
        onPick={setLang}
        uiLanguage={uiLanguage}
      />
    );
  }

  if (quiz && level != null) {
    return (
      <Quiz
        lang={lang}
        level={level}
        onExit={() => {
          setQuiz(false);
          load(); // progress may have changed
          loadLanguages();
        }}
      />
    );
  }

  if (level != null) {
    return (
      <LevelView
        lang={lang}
        level={level}
        onBack={() => setLevel(null)}
        onQuiz={() => setQuiz(true)}
      />
    );
  }

  return (
    <Roadmap
      lang={lang}
      levels={levels}
      onPick={setLevel}
      onBack={() => {
        setLang(null);
        loadLanguages(); // progress may have moved while inside
      }}
      uiLanguage={uiLanguage}
    />
  );
}
