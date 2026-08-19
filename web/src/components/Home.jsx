import { PLATFORMS } from "./SourcePicker.jsx";

/* The landing screen: choose where the video comes from, before anything else.
 *
 * Previously the app opened straight into the upload form with the platform
 * choice buried in a sidebar dropdown, which meant the platforms were
 * effectively hidden. Choosing the source is the first real decision — it
 * determines which features are even possible — so it gets the whole screen.
 *
 * The cards state their limits up front. Netflix, Prime, Viki, iQIYI and
 * GagaOOLala cannot run in a web page at all (DRM plus x-frame-options), and
 * saying so here is better than letting someone pick one and hit a wall.
 */
export function Home({ onPick, t }) {
  const usable = PLATFORMS.filter((p) => p.works);
  const viaExtension = PLATFORMS.filter((p) => !p.works);

  return (
    <div className="home">
      <div className="home-hero">
        <h1 className="home-title">
          Turn any video into <span>vocabulary</span>
        </h1>
        <p className="home-sub">
          Speech recognition writes the subtitles, so this works on content no
          other tool can touch. Click a word to save it with its sentence and the
          clip it was spoken in.
        </p>
      </div>

      <h2 className="home-section">Works in this app</h2>
      <div className="home-grid">
        {usable.map((p) => (
          <button key={p.id} className="home-card primary-card" onClick={() => onPick(p.id)}>
            <span className="home-card-top">
              <span className="source-icon lg">{p.icon}</span>
              <span className="home-card-name">{p.name}</span>
            </span>
            <span className="home-card-detail">{p.detail}</span>
            <span className="source-features">
              {p.features.map((f) => (
                <span key={f} className="tag">
                  {f}
                </span>
              ))}
            </span>
          </button>
        ))}
      </div>

      <h2 className="home-section">
        Streaming platforms
        <span className="home-section-note">
          DRM means these cannot play inside a web page — they run through the
          browser extension on the platform's own site
        </span>
      </h2>
      <div className="home-grid small">
        {viaExtension.map((p) => (
          <button key={p.id} className="home-card" onClick={() => onPick(p.id)}>
            <span className="home-card-top">
              <span className="source-icon">{p.icon}</span>
              <span className="home-card-name sm">{p.name}</span>
              <span className="pill">extension</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
