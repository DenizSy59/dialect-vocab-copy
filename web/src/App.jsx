import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "./api.js";
import { UploadPanel } from "./components/UploadPanel.jsx";
import { Library } from "./components/Library.jsx";
import { Player } from "./components/Player.jsx";
import { SavedWords } from "./components/SavedWords.jsx";
import { SourcePicker } from "./components/SourcePicker.jsx";
import { PlatformPanel } from "./components/PlatformPanel.jsx";
import { DeckLibrary } from "./components/DeckLibrary.jsx";
import { Home } from "./components/Home.jsx";
import { StreamingPlayer } from "./components/StreamingPlayer.jsx";
import { Curriculum } from "./components/Curriculum.jsx";
import { PLATFORMS } from "./components/SourcePicker.jsx";
import { makeT, UI_LANGUAGES } from "./i18n.js";
import { THEMES } from "./themes.js";

export default function App() {
  const [online, setOnline] = useState(null);
  const [videos, setVideos] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [segments, setSegments] = useState([]);
  const [words, setWords] = useState([]);
  const [error, setError] = useState("");
  // Upload is the primary deliverable, so it is the default source. The others
  // are additions that can be removed without touching the core.
  // null = the landing screen. The source choice is the first real decision
  // in the app, so it is not made silently on the user's behalf.
  const [source, setSource] = useState(null);
  const [platformLanguage, setPlatformLanguage] = useState("ko");
  // Both persisted: a theme or interface language that resets on reload is
  // worse than not offering the choice.
  const [theme, setTheme] = useState(
    () => localStorage.getItem("lexicon.theme") || "dark",
  );
  const [uiLanguage, setUiLanguage] = useState(
    () => localStorage.getItem("lexicon.ui") || "en",
  );
  const [view, setView] = useState("home"); // home | player | deck
  // Romanisation is a scaffold, so it is off by default and remembered. Leaving
  // it permanently on is a known way to never learn the script.
  // One language at a time when you want it. Somebody studying Korean should
  // not have Chinese decks and courses in the way, and "all" stays available
  // for when they do want both.
  const [studying, setStudying] = useState(
    () => localStorage.getItem("lexicon.studying") || "all",
  );
  const [showReading, setShowReading] = useState(
    () => localStorage.getItem("lexicon.reading") === "1",
  );

  useEffect(() => {
    localStorage.setItem("lexicon.reading", showReading ? "1" : "0");
  }, [showReading]);

  useEffect(() => {
    localStorage.setItem("lexicon.studying", studying);
  }, [studying]);

  const t = useMemo(() => makeT(uiLanguage), [uiLanguage]);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("lexicon.theme", theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem("lexicon.ui", uiLanguage);
    document.documentElement.lang = uiLanguage;
  }, [uiLanguage]);

  const selected = videos.find((v) => v._id === selectedId) || null;

  const refreshVideos = useCallback(async () => {
    try {
      const list = await api.listVideos();
      setVideos(list);
      setOnline(true);
      return list;
    } catch (e) {
      setOnline(false);
      setError(e.message);
      return [];
    }
  }, []);

  useEffect(() => {
    refreshVideos();
  }, [refreshVideos]);

  // Poll only while something is actually working. Transcription takes minutes
  // and there is no websocket yet, so this is how progress arrives — but idling
  // at one request a second forever would be rude to the API.
  const anyWorking = videos.some((v) => v.status === "queued" || v.status === "processing");
  useEffect(() => {
    if (!anyWorking) return;
    const id = setInterval(refreshVideos, 2000);
    return () => clearInterval(id);
  }, [anyWorking, refreshVideos]);

  // Load the transcript once the selected video is finished.
  useEffect(() => {
    if (!selected || selected.status !== "done") {
      setSegments([]);
      return;
    }
    let cancelled = false;
    api
      .getSegments(selected._id)
      .then((s) => !cancelled && setSegments(s))
      .catch((e) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [selected?._id, selected?.status]);

  const refreshWords = useCallback(async () => {
    if (!selectedId) return setWords([]);
    setWords(await api.listWords(selectedId));
  }, [selectedId]);

  useEffect(() => {
    refreshWords();
  }, [refreshWords]);

  const savedLemmas = useMemo(() => new Set(words.map((w) => w.lemma)), [words]);

  /* Clicking an already-saved word takes this encounter back out.
   *
   * Only the occurrence goes, not the card — the same word saved from another
   * video keeps its clip. A misclick should be undoable without losing
   * everything collected elsewhere.
   */
  async function saveWord(segment, tokenIndex) {
    const token = segment.tokens[tokenIndex];
    try {
      if (token && savedLemmas.has(token.lemma)) {
        await api.unsaveWord(selected?.language, token.lemma, segment._id);
      } else {
        await api.saveWord(selectedId, segment._id, tokenIndex);
      }
      await refreshWords();
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">L</span>
          Lexicon
        </div>
        <div className="brand-sub">
          dialect-aware vocabulary from video · speech recognition
        </div>
        {view !== "home" && (
          <button className="toggle" onClick={() => setView("home")}>
            ← {t("source")}
          </button>
        )}

        <span className="spacer" />

        <select
          className="chrome-select"
          value={studying}
          onChange={(e) => setStudying(e.target.value)}
          title="Which language you are studying right now"
        >
          <option value="all">All languages</option>
          <option value="ko">한국어</option>
          <option value="zh">中文</option>
          <option value="tr">Türkçe</option>
          <option value="en">English</option>
        </select>

        <button
          className={`toggle ${showReading ? "on" : ""}`}
          onClick={() => setShowReading((v) => !v)}
          title="Show pronunciation above words (pinyin / romaja)"
        >
          あ
        </button>

        <button
          className={`toggle ${view === "course" ? "on" : ""}`}
          onClick={() => setView(view === "course" ? "home" : "course")}
        >
          ◈ Course
        </button>

        <button
          className={`toggle ${view === "deck" ? "on" : ""}`}
          onClick={() => setView(view === "deck" ? "home" : "deck")}
        >
          ★ {t("library")}
        </button>

        <select
          className="chrome-select"
          value={uiLanguage}
          onChange={(e) => setUiLanguage(e.target.value)}
          title={t("interfaceLanguage")}
        >
          {UI_LANGUAGES.map((l) => (
            <option key={l.code} value={l.code}>
              {l.label}
            </option>
          ))}
        </select>

        <select
          className="chrome-select"
          value={theme}
          onChange={(e) => setTheme(e.target.value)}
          title={t("theme")}
        >
          {THEMES.map((x) => (
            <option key={x.id} value={x.id}>
              {x.label}
            </option>
          ))}
        </select>

        <span className={`status-dot ${online === false ? "off" : ""}`}>
          {online === false ? t("apiOffline") : t("apiOnline")}
        </span>
      </header>

      <main className="main">
        {error && (
          <div className="error-box" style={{ marginBottom: 16 }}>
            {error}{" "}
            <button className="ghost" onClick={() => setError("")}>
              dismiss
            </button>
          </div>
        )}

        {view === "course" ? (
          <Curriculum
            uiLanguage={uiLanguage}
            studying={studying}
            onExit={() => setView("home")}
          />
        ) : view === "stream" ? (
          <StreamingPlayer
            platform={PLATFORMS.find((p) => p.id === source)}
            language={platformLanguage}
            onLanguage={setPlatformLanguage}
            onExit={() => setView("home")}
            showReading={showReading}
            t={t}
          />
        ) : view === "home" ? (
          <Home
            t={t}
            onPick={(id) => {
              setSource(id);
              // In the desktop shell the DRM platforms open a real player;
              // in a browser they fall through to the extension instructions.
              const p = PLATFORMS.find((x) => x.id === id);
              const streaming = window.lexicon?.isDesktop && p && !p.works;
              setView(streaming ? "stream" : "player");
            }}
          />
        ) : view === "deck" ? (
          <DeckLibrary
            t={t}
            uiLanguage={uiLanguage}
            studying={studying}
            onExit={() => setView("home")}
          />
        ) : (
        <div className="columns">
          <div>
            {source !== "upload" ? (
              <PlatformPanel
                platformId={source}
                language={platformLanguage}
                onLanguage={setPlatformLanguage}
              />
            ) : selected && selected.status === "done" && segments.length > 0 ? (
              <Player
                video={selected}
                segments={segments}
                savedLemmas={savedLemmas}
                onSaveWord={saveWord}
                showReading={showReading}
              />
            ) : (
              <div className="panel">
                <div className="panel-head">
                  <span>◈</span> Player
                </div>
                <div className="empty" style={{ padding: 56 }}>
                  {!selected
                    ? "Select or upload a video to begin."
                    : selected.status === "error"
                      ? `Transcription failed: ${selected.error}`
                      : `${selected.stage || selected.status}… ${selected.progress}%`}
                </div>
              </div>
            )}

            {selected?.status === "done" && selected.coverage && (
              <div className="panel">
                <div className="panel-head">
                  <span>◉</span> Quality
                </div>
                <div className="panel-body">
                  <div className="stats">
                    <div className="stat">
                      <div className="k">Content coverage</div>
                      <div className="v">{selected.coverage.contentPct}%</div>
                    </div>
                    <div className="stat">
                      <div className="k">All tokens</div>
                      <div className="v">{selected.coverage.tokensPct}%</div>
                    </div>
                    <div className="stat">
                      <div className="k">Words</div>
                      <div className="v">{selected.coverage.contentTotal}</div>
                    </div>
                    <div className="stat">
                      <div className="k">Compute</div>
                      <div className="v">{selected.timing?.computeSec}s</div>
                    </div>
                    <div className="stat">
                      <div className="k">Speed</div>
                      <div className="v">{selected.timing?.computeRealtimeFactor}x</div>
                    </div>
                    <div className="stat">
                      <div className="k">Language</div>
                      <div className="v" style={{ fontSize: 13 }}>
                        {selected.language}
                        {selected.languageConfidence != null && (
                          <span className="muted"> auto</span>
                        )}
                      </div>
                    </div>
                    <div className="stat">
                      <div className="k">Model</div>
                      <div className="v" style={{ fontSize: 13 }}>
                        {selected.model}
                      </div>
                    </div>
                  </div>
                  <div className="muted" style={{ marginTop: 12 }}>
                    Coverage is the share of words that received a timing from
                    forced alignment. It says nothing about whether the
                    transcription is correct.
                  </div>

                  {selected.dialect?.available && (
                    <div
                      className={`dialect ${selected.dialect.detected ? "flag" : "clear"}`}
                    >
                      <div className="dialect-head">
                        {selected.dialect.detected
                          ? `Regional speech detected — ${selected.dialect.label}`
                          : "No regional markers found"}
                      </div>
                      {selected.dialect.detected && (
                        <div className="dialect-evidence">
                          {selected.dialect.evidence.map((e) => (
                            <span key={e.marker} className="tag">
                              {e.marker} ×{e.count}
                            </span>
                          ))}
                        </div>
                      )}
                      {/* The basis is shown, not buried. A dialect claim a
                          learner cannot check is worse than none. */}
                      <div className="dialect-caveat">{selected.dialect.caveat}</div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          <div>
            <SourcePicker value={source} onChange={setSource} />
            {source === "upload" && (
              <UploadPanel
                t={t}
                onUploaded={(v) => {
                  setVideos((prev) => [v, ...prev]);
                  setSelectedId(v._id);
                }}
              />
            )}
            <Library
              videos={videos}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onDeleted={(id) => {
                setVideos((prev) => prev.filter((v) => v._id !== id));
                if (id === selectedId) setSelectedId(null);
              }}
            />
            <SavedWords words={words} onChanged={refreshWords} videoId={selectedId} />
          </div>
        </div>
        )}
      </main>
    </div>
  );
}
