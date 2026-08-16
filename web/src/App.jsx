import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "./api.js";
import { UploadPanel } from "./components/UploadPanel.jsx";
import { Library } from "./components/Library.jsx";
import { Player } from "./components/Player.jsx";
import { SavedWords } from "./components/SavedWords.jsx";

export default function App() {
  const [online, setOnline] = useState(null);
  const [videos, setVideos] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [segments, setSegments] = useState([]);
  const [words, setWords] = useState([]);
  const [error, setError] = useState("");

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

  async function saveWord(segment, tokenIndex) {
    try {
      await api.saveWord(selectedId, segment._id, tokenIndex);
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
        <span className="spacer" />
        <span className={`status-dot ${online === false ? "off" : ""}`}>
          {online === false ? "api offline" : "api online"}
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

        <div className="columns">
          <div>
            {selected && selected.status === "done" && segments.length > 0 ? (
              <Player
                video={selected}
                segments={segments}
                savedLemmas={savedLemmas}
                onSaveWord={saveWord}
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
                </div>
              </div>
            )}
          </div>

          <div>
            <UploadPanel
              onUploaded={(v) => {
                setVideos((prev) => [v, ...prev]);
                setSelectedId(v._id);
              }}
            />
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
      </main>
    </div>
  );
}
