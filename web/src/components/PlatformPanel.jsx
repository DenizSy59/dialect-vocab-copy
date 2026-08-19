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

        <h4 className="mini-head">Install the extension</h4>
        <ol className="steps">
          <li>
            Open <code>chrome://extensions</code> and turn on{" "}
            <strong>Developer mode</strong> (top right).
          </li>
          <li>
            Click <strong>Load unpacked</strong> and choose the{" "}
            <code>extension/</code> folder in the project.
          </li>
          <li>
            Click the Lexicon icon in the toolbar and pick your{" "}
            <strong>subtitle language</strong>. It cannot be detected on this
            route — there is no readable audio, only text.
          </li>
        </ol>

        <h4 className="mini-head">Then use {platform.name} normally</h4>
        <ol className="steps">
          <li>
            <strong>Log in to {platform.name} yourself</strong>, in your own
            browser, exactly as you always do. The extension never sees your
            account, your password or your payment details — it only reads text
            already on the page.
          </li>
          <li>Play something with subtitles in your target language.</li>
          <li>
            A <code>LEXICON</code> bar appears under the player with the same
            line, content words underlined. Click one to save it.
          </li>
          <li>Saved words land in the same deck as everything else.</li>
        </ol>

        {/* Verifying against a real login is slow and risks looking broken for
            reasons that have nothing to do with the extension, so there is a
            local page that mimics the same DOM. */}
        <h4 className="mini-head">Check it works first</h4>
        <p className="source-detail">
          Before trying it on {platform.name}, open the test page below. It
          reproduces the same player structure locally and reports exactly what
          is and is not working, so a problem points at a cause instead of
          looking dead.
        </p>
        <a href="/extension-test.html" target="_blank" rel="noreferrer">
          <button className="primary" style={{ marginTop: 10 }}>
            Open the extension test page
          </button>
        </a>

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
