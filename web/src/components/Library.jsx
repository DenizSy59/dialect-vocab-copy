import { api } from "../api.js";

function shortName(name) {
  return name.replace(/\.[^.]+$/, "");
}

export function Library({ videos, selectedId, onSelect, onDeleted }) {
  return (
    <div className="panel">
      <div className="panel-head">
        <span>▤</span> Library
        <span className="spacer" />
        <span className="muted">{videos.length}</span>
      </div>
      <div className="panel-body" style={{ padding: 8 }}>
        {videos.length === 0 && <div className="empty">Nothing transcribed yet.</div>}
        {videos.map((v) => (
          <div
            key={v._id}
            className={`video-item ${v._id === selectedId ? "active" : ""}`}
            onClick={() => onSelect(v._id)}
          >
            <span className="name" title={v.originalName}>
              {shortName(v.originalName)}
            </span>
            <span className="tag">{v.language}</span>
            <span className={`tag ${v.status}`}>
              {/* Progress is more useful than the word "processing" when a
                  large model is grinding through a long file. */}
              {v.status === "processing" ? `${v.progress}%` : v.status}
            </span>
            <button
              className="ghost"
              title="Delete"
              onClick={async (e) => {
                e.stopPropagation();
                await api.deleteVideo(v._id);
                onDeleted(v._id);
              }}
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
