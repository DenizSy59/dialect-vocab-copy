import { useState } from "react";
import { PLATFORMS } from "./SourcePicker.jsx";
import { ExtensionSetup } from "./ExtensionSetup.jsx";
import { Companion } from "./Companion.jsx";

// Accepts the usual forms: watch links, share links, embed links, or a bare id.
function youtubeId(input) {
  const s = input.trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  const m = s.match(/(?:v=|youtu\.be\/|embed\/|shorts\/)([\w-]{11})/);
  return m ? m[1] : null;
}

function YouTubePanel({ language, onLanguage }) {
  const [input, setInput] = useState("");
  const [videoId, setVideoId] = useState(null);
  const [error, setError] = useState("");

  function load() {
    const id = youtubeId(input);
    if (!id) return setError("That does not look like a YouTube link or video id.");
    setError("");
    setVideoId(id);
  }

  return (
    <div className="panel">
      <div className="panel-head">
        <span>▶</span> YouTube
      </div>
      <div className="panel-body">
        <div className="url-row">
          <input
            className="url-input"
            placeholder="Paste a YouTube link or video id"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && load()}
          />
          <button className="primary" onClick={load}>
            Load
          </button>
        </div>
        {error && <div className="error-box" style={{ marginTop: 10 }}>{error}</div>}

        {videoId && (
          <div className="stage" style={{ marginTop: 14 }}>
            {/* Official embed. Downloading the video would break YouTube's
                terms, so the iframe is the only permitted route. */}
            <iframe
              className="yt"
              src={`https://www.youtube-nocookie.com/embed/${videoId}`}
              title="YouTube player"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; picture-in-picture"
              allowFullScreen
            />
          </div>
        )}

        <label className="field" style={{ marginTop: 14 }}>
          Subtitle language
          <select value={language} onChange={(e) => onLanguage(e.target.value)}>
            <option value="ko">Korean</option>
            <option value="zh">Chinese</option>
            <option value="tr">Turkish</option>
          </select>
        </label>

        {/* Stated up front rather than discovered after loading a video. */}
        <div className="notice">
          The player works here, but the clickable word layer needs the browser
          extension: YouTube's caption track belongs to the page it is served on,
          and this app cannot read it from an embed. Whisper cannot run on it
          either — that needs the audio file, which an embed does not expose.
          <strong> Upload the file instead if you want clips and word timings.</strong>
        </div>
      </div>
    </div>
  );
}

export function PlatformPanel({ platformId, language, onLanguage }) {
  const platform = PLATFORMS.find((p) => p.id === platformId);
  const [mode, setMode] = useState("companion");
  if (!platform) return null;
  if (platform.id === "youtube") {
    return <YouTubePanel language={language} onLanguage={onLanguage} />;
  }

  // Companion first, because it needs nothing installed and works everywhere.
  // The extension is better when it works — it reads the platform's own live
  // subtitle so sync is exact — but it is a Chrome install and it breaks when
  // a platform changes its markup, so it is the second option rather than the
  // first thing a new user is asked to do.
  return (
    <>
      <div className="mode-switch">
        <button
          className={`toggle ${mode === "companion" ? "on" : ""}`}
          onClick={() => setMode("companion")}
        >
          Subtitle companion · nothing to install
        </button>
        <button
          className={`toggle ${mode === "extension" ? "on" : ""}`}
          onClick={() => setMode("extension")}
        >
          Browser extension · overlays the real player
        </button>
      </div>
      {mode === "companion" ? (
        <Companion platform={platform} />
      ) : (
        <ExtensionSetup platform={platform} />
      )}
    </>
  );
}
