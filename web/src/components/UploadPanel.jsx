import { useRef, useState } from "react";
import { api } from "../api.js";

// Model choices are labelled with what they actually cost on this machine,
// measured rather than guessed, because "large-v3" means nothing to someone
// deciding whether to wait.
const MODELS = [
  { value: "auto", label: "Automatic — best affordable" },
  { value: "tiny", label: "tiny — ~15s per minute" },
  { value: "base", label: "base — ~20s per minute" },
  { value: "small", label: "small — ~30s per minute" },
  { value: "medium", label: "medium — ~60s per minute" },
  { value: "large-v3", label: "large-v3 — ~110s per minute" },
];

// Both default to automatic. The language is detectable from the audio and the
// model can be chosen from the clip length, so asking is asking the user to
// answer a question the software already knows.
const LANGUAGES = [
  { value: "auto", label: "Detect automatically" },
  { value: "ko", label: "Korean" },
  { value: "zh", label: "Chinese" },
  { value: "tr", label: "Turkish" },
];

const TARGETS = [
  { value: "en", label: "English" },
  { value: "tr", label: "Türkçe" },
  { value: "zh", label: "中文" },
  { value: "ko", label: "한국어" },
];

export function UploadPanel({ onUploaded, t }) {
  const [language, setLanguage] = useState("auto");
  const [model, setModel] = useState("auto");
  const [target, setTarget] = useState("en");
  const [file, setFile] = useState(null);
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState("");
  const [over, setOver] = useState(false);
  const inputRef = useRef(null);

  async function submit() {
    if (!file) return;
    setError("");
    setProgress(0);
    try {
      const video = await api.uploadVideo(file, language, model, setProgress, target);
      setFile(null);
      setProgress(null);
      onUploaded(video);
    } catch (e) {
      setError(e.message);
      setProgress(null);
    }
  }

  function pick(files) {
    if (files && files[0]) {
      setFile(files[0]);
      setError("");
    }
  }

  return (
    <div className="panel">
      <div className="panel-head">
        <span>◈</span> New transcription
      </div>
      <div className="panel-body">
        <div
          className={`dropzone ${over ? "over" : ""}`}
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            pick(e.dataTransfer.files);
          }}
        >
          <strong>{file ? file.name : "Drop a video here"}</strong>
          {file
            ? `${(file.size / 1e6).toFixed(1)} MB — ready`
            : "or click to browse · mp4, webm, mkv, mp3, wav"}
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="video/*,audio/*"
          hidden
          onChange={(e) => pick(e.target.files)}
        />

        <div className="upload-row">
          <label className="field">
            Language
            <select value={language} onChange={(e) => setLanguage(e.target.value)}>
              {LANGUAGES.map((l) => (
                <option key={l.value} value={l.value}>
                  {l.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field" style={{ flex: 1, minWidth: 170 }}>
            {t ? t("translateTo") : "Translate to"}
            <select value={target} onChange={(e) => setTarget(e.target.value)}>
              {TARGETS.map((x) => (
                <option key={x.value} value={x.value}>
                  {x.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field" style={{ flex: 1, minWidth: 190 }}>
            Model
            <select value={model} onChange={(e) => setModel(e.target.value)}>
              {MODELS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
          <button className="primary" disabled={!file || progress !== null} onClick={submit}>
            {progress !== null ? `Uploading ${progress}%` : "Transcribe"}
          </button>
        </div>

        {progress !== null && (
          <div className="bar" style={{ marginTop: 12 }}>
            <i style={{ width: `${progress}%` }} />
          </div>
        )}
        {error && (
          <div className="error-box" style={{ marginTop: 12 }}>
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
