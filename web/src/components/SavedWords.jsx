import { useState } from "react";
import { api } from "../api.js";

// Below this, the aligner was much less sure about the word. In the Korean
// test clips the mis-transcribed words scored 0.30 to 0.56 while correct ones
// sat at 0.74 and above, so a warning here is worth more than it costs.
const LOW_CONFIDENCE = 0.65;

// The clip is the thing that makes this different from a screenshot-and-audio
// tool, so it is loaded on demand rather than never: the first click cuts it
// server side, which takes a moment on a long source.
function ClipPlayer({ wordId }) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button style={{ marginTop: 8, width: "100%" }} onClick={() => setOpen(true)}>
        ▶ Play clip
      </button>
    );
  }
  return (
    <video
      className="clip"
      src={api.clipUrl(wordId)}
      controls
      autoPlay
      playsInline
      onError={() => setOpen(false)}
    />
  );
}

export function SavedWords({ words, onChanged, videoId }) {
  return (
    <div className="panel">
      <div className="panel-head">
        <span>★</span> Deck
        <span className="spacer" />
        <span className="muted">{words.length}</span>
      </div>
      <div className="panel-body">
        {words.length === 0 && (
          <div className="empty">
            Click any underlined word in the transcript to add it here.
          </div>
        )}

        {words.map((w) => (
          <div key={w._id} className="word-card">
            <div className="word-head">
              <span className="word-lemma">{w.lemma}</span>
              {w.surface !== w.lemma && <span className="word-surface">{w.surface}</span>}
              <span className="spacer" />
              <span className="tag">{w.pos}</span>
              <button
                className="ghost"
                onClick={async () => {
                  await api.deleteWord(w._id);
                  onChanged();
                }}
              >
                ✕
              </button>
            </div>
            {w.pinyin && <div className="word-reading">{w.pinyin}</div>}
            {w.senses?.length > 0 ? (
              <div className="word-sense">{w.senses.join("; ")}</div>
            ) : (
              <div className="word-sense none">
                no dictionary entry — often a name or a mis-transcription
              </div>
            )}
            <div className="word-sentence">{w.sentence}</div>
            {w.sentenceEnglish && (
              <div className="word-sentence-en">{w.sentenceEnglish}</div>
            )}
            {w.confidence != null && w.confidence < LOW_CONFIDENCE && (
              <div className="warn">
                ⚠ low alignment confidence ({w.confidence.toFixed(2)}) — may be
                mis-transcribed
              </div>
            )}
            <ClipPlayer wordId={w._id} />
          </div>
        ))}

        {words.length > 0 && (
          <a href={api.exportUrl(videoId)} download>
            <button style={{ width: "100%", marginTop: 4 }}>Export to Anki (TSV)</button>
          </a>
        )}
      </div>
    </div>
  );
}
