import { useState } from "react";

/* Where the video comes from.
 *
 * The capability differences here are not design choices, they are imposed by
 * DRM. Netflix sends x-frame-options: DENY and Prime Video and GagaOOLala are
 * equally unembeddable, so no web page of ours can ever play them — those need
 * the browser extension running on the platform's own site. YouTube publishes an
 * embed endpoint, so it genuinely works here.
 *
 * Rather than hide that, each option states what it can and cannot do. A picker
 * that offered Netflix and then failed would be worse than one that explains
 * why it opens the extension instead.
 */
export const PLATFORMS = [
  {
    id: "upload",
    name: "Upload a file",
    icon: "⬆",
    tagline: "Full features",
    works: true,
    detail:
      "Any video or audio file. Whisper generates the subtitles, so this works on content no other tool can touch — lectures, recordings, files a friend sent.",
    features: ["Own subtitles", "Word clips", "Dialect detection", "Difficulty strip"],
  },
  {
    id: "youtube",
    name: "YouTube",
    icon: "▶",
    tagline: "Embedded player",
    works: true,
    detail:
      "Plays through YouTube's official embed, which is the only permitted way — downloading the video would break their terms. Subtitles come from the captions the platform already provides.",
    features: ["Platform captions", "No clips", "Text-only dialect"],
  },
  {
    id: "netflix",
    name: "Netflix",
    icon: "N",
    tagline: "Needs the extension",
    works: false,
    detail:
      "Netflix sends x-frame-options: DENY, so it cannot be embedded in any page. Widevine DRM also means the decrypted audio is unreadable, so Whisper cannot run on it. The browser extension overlays Netflix's own subtitle track on netflix.com instead.",
    features: ["Netflix's own track", "No clips", "Text-only dialect"],
  },
  {
    id: "prime",
    name: "Prime Video",
    icon: "P",
    tagline: "Needs the extension",
    works: false,
    detail:
      "Same DRM constraint as Netflix — the player is not embeddable and the audio is not readable. The extension is the only route.",
    features: ["Platform captions", "No clips", "Text-only dialect"],
  },
  {
    id: "viki",
    name: "Rakuten Viki",
    icon: "V",
    tagline: "Needs the extension",
    works: false,
    detail:
      "Same DRM route as the others. Viki's subtitles are community-made and often better than a platform's own, which makes it a good target once the extension selectors are written for it.",
    features: ["Platform captions", "No clips", "Text-only dialect"],
    planned: true,
  },
  {
    id: "iqiyi",
    name: "iQIYI",
    icon: "iQ",
    tagline: "Needs the extension",
    works: false,
    detail:
      "Chinese platform, DRM-protected. Worth supporting because it carries a large amount of Mandarin drama with official subtitles.",
    features: ["Platform captions", "No clips", "Text-only dialect"],
    planned: true,
  },
  {
    id: "gagaoolala",
    name: "GagaOOLala",
    icon: "G",
    tagline: "Needs the extension",
    works: false,
    detail:
      "Sends x-frame-options: SAMEORIGIN, so it cannot be framed by this app. The extension approach applies here too.",
    features: ["Platform captions", "No clips", "Text-only dialect"],
  },
];

export function SourcePicker({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const current = PLATFORMS.find((p) => p.id === value) || PLATFORMS[0];

  return (
    <div className="panel">
      <div className="panel-head">
        <span>◆</span> Source
        <span className="spacer" />
        <span className="muted">{current.tagline}</span>
      </div>
      <div className="panel-body">
        <button className="source-current" onClick={() => setOpen((v) => !v)}>
          <span className="source-icon">{current.icon}</span>
          <span className="source-name">{current.name}</span>
          <span className="spacer" />
          <span className={`chev ${open ? "up" : ""}`}>▾</span>
        </button>

        {open && (
          <div className="source-list">
            {PLATFORMS.map((p) => (
              <button
                key={p.id}
                className={`source-option ${p.id === value ? "active" : ""}`}
                onClick={() => {
                  onChange(p.id);
                  setOpen(false);
                }}
              >
                <span className="source-icon">{p.icon}</span>
                <span className="source-option-body">
                  <span className="source-name">
                    {p.name}
                    {!p.works && <span className="pill">extension</span>}
                  </span>
                  <span className="source-tag">{p.tagline}</span>
                </span>
              </button>
            ))}
          </div>
        )}

        <p className="source-detail">{current.detail}</p>
        <div className="source-features">
          {current.features.map((f) => (
            <span key={f} className="tag">
              {f}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
