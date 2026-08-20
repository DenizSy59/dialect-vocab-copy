import { useEffect, useState } from "react";
import { api } from "../api.js";

/* What a clicked word means, before deciding whether to keep it.
 *
 * Clicking used to save immediately and the meaning was only visible on hover,
 * which is the wrong way round: you have to know what a word means to know
 * whether it is worth saving. Now the click opens this, and saving is a
 * deliberate second action.
 *
 * It also shows the sentence and its translation, because a definition without
 * the context it was used in is how you end up learning the wrong sense of a
 * word.
 */
export function WordPanel({ selection, language, savedLemmas, onSave, onRemove, t }) {
  const [gloss, setGloss] = useState(null);
  const [translation, setTranslation] = useState("");

  const token = selection?.token;
  const segment = selection?.segment;
  const saved = token ? savedLemmas.has(token.lemma) : false;

  useEffect(() => {
    if (!token) return;
    setGloss(null);
    api
      .lookup(language, token.lemma, token.surface)
      .then(setGloss)
      .catch(() => setGloss({ found: false }));
  }, [token, language]);

  // The sentence translation the segment already carries, if there is one.
  // Anything else is fetched by the player, not here — this panel should not
  // start its own translation jobs.
  useEffect(() => {
    setTranslation(segment?.translation || segment?.english || "");
  }, [segment]);

  if (!token) {
    return (
      <div className="panel">
        <div className="panel-head">
          <span>◆</span> Word
        </div>
        <div className="empty">
          Click any underlined word to see what it means.
        </div>
      </div>
    );
  }

  return (
    <div className="panel">
      <div className="panel-head">
        <span>◆</span> Word
        <span className="spacer" />
        <span className="tag">{token.pos}</span>
      </div>
      <div className="panel-body">
        <div className="wp-head">
          <span className="wp-lemma">{token.lemma}</span>
          {token.reading && <span className="wp-reading">{token.reading}</span>}
        </div>

        {token.surface !== token.lemma && (
          <div className="wp-surface">
            as it appeared: <strong>{token.surface}</strong>
          </div>
        )}

        <div className="wp-senses">
          {!gloss ? (
            <span className="muted">…</span>
          ) : gloss.found ? (
            <ol className="wp-sense-list">
              {gloss.senses.slice(0, 4).map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ol>
          ) : (
            <span className="word-sense none">{t("noDictionary")}</span>
          )}
          {gloss?.pinyin && <div className="wp-reading">{gloss.pinyin}</div>}
        </div>

        {segment && (
          <div className="wp-context">
            <div className="wp-sentence">{segment.text}</div>
            {translation && <div className="wp-sentence-en">{translation}</div>}
          </div>
        )}

        <button
          className={saved ? "" : "primary"}
          style={{ width: "100%", marginTop: 12 }}
          onClick={() => (saved ? onRemove(token, segment) : onSave(token, segment))}
        >
          {saved ? "Remove from deck" : "Save to deck"}
        </button>
      </div>
    </div>
  );
}
