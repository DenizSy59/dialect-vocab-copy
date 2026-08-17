import { useState } from "react";
import { PLATFORMS } from "./SourcePicker.jsx";

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

function ExtensionPanel({ platform }) {
  return (
    <div className="panel">
      <div className="panel-head">
        <span>{platform.icon}</span> {platform.name}
      </div>
      <div className="panel-body">
        <div className="notice strong">
          {platform.name} cannot be played inside this app, and no amount of work
          here would change that.
        </div>
        <p className="source-detail">{platform.detail}</p>

        <h4 className="mini-head">How it works instead</h4>
        <ol className="steps">
          <li>Install the browser extension from <code>extension/</code>.</li>
          <li>
            Open {platform.name} normally and start playing something with
            subtitles in your target language.
          </li>
          <li>
            The extension reads the subtitle track the page already loaded,
            sends the text here to be tokenised and looked up, and overlays
            clickable words on top of the player.
          </li>
          <li>Saved words land in the same deck as everything else.</li>
        </ol>

        <div className="notice">
          Because the audio is encrypted, there are no word-level timings on this
          route — so no video clips, and dialect detection is text-only. That is
          a DRM limitation, not an implementation gap.
        </div>
      </div>
    </div>
  );
}

export function PlatformPanel({ platformId, language, onLanguage }) {
  const platform = PLATFORMS.find((p) => p.id === platformId);
  if (!platform) return null;
  if (platform.id === "youtube") {
    return <YouTubePanel language={language} onLanguage={onLanguage} />;
  }
  return <ExtensionPanel platform={platform} />;
}
