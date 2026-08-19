import { useEffect, useState } from "react";

/* Guided setup for the streaming route, with live status.
 *
 * The previous version was a list of instructions with no feedback, so the only
 * way to know whether any step had worked was to open Netflix and see if
 * anything happened. Each step here reports its own state, so a failure points
 * at the step that failed instead of at the whole idea.
 *
 * The extension marks the document when it loads, which is the only way a web
 * page can answer "am I installed?" at all.
 */
function useExtensionInstalled() {
  const [installed, setInstalled] = useState(
    () => !!document.documentElement.dataset.lexiconExtension,
  );
  useEffect(() => {
    const id = setInterval(() => {
      setInstalled(!!document.documentElement.dataset.lexiconExtension);
    }, 1000);
    return () => clearInterval(id);
  }, []);
  return installed;
}

function Step({ n, done, title, children }) {
  return (
    <div className={`step-row ${done ? "done" : ""}`}>
      <span className="step-num">{done ? "✓" : n}</span>
      <div className="step-body">
        <div className="step-title">{title}</div>
        <div className="step-detail">{children}</div>
      </div>
    </div>
  );
}

export function ExtensionSetup({ platform }) {
  const installed = useExtensionInstalled();
  const [apiUp, setApiUp] = useState(null);

  useEffect(() => {
    const check = () =>
      fetch("/api/health")
        .then((r) => setApiUp(r.ok))
        .catch(() => setApiUp(false));
    check();
    const id = setInterval(check, 4000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="panel">
      <div className="panel-head">
        <span>{platform.icon}</span> {platform.name}
        <span className="spacer" />
        <span className={`tag ${installed ? "done" : "queued"}`}>
          {installed ? "extension installed" : "extension not installed"}
        </span>
      </div>

      <div className="panel-body">
        <div className="explain">
          <p>
            <strong>{platform.name} cannot play inside this website.</strong>{" "}
            That is not a missing feature — it is enforced by the browser and by
            {" "}{platform.name} itself, and no amount of work here changes it.
          </p>
          <ul className="why">
            <li>
              {platform.name} sends <code>x-frame-options: DENY</code>. Your
              browser refuses to display it inside another site. Tested: the
              frame comes back completely empty.
            </li>
            <li>
              The video is encrypted with Widevine DRM. Playback needs a licence
              issued to {platform.name}'s own player, which no other site can
              obtain.
            </li>
            <li>
              There is no "Sign in with {platform.name}" for third parties, and
              a login box on this site asking for your {platform.name} password
              would be a phishing pattern — not something worth building even if
              it worked.
            </li>
          </ul>
          <p className="ok-note">
            So instead: <strong>you watch on {platform.name} as normal</strong>,
            logged into your own account in your own browser, and a small
            extension draws the clickable words on top. Your login stays between
            you and {platform.name} — the extension only reads subtitle text
            that is already on screen.
          </p>
        </div>

        <h4 className="mini-head">Three steps, once</h4>

        <Step n="1" done={apiUp === true} title="Lexicon running">
          {apiUp
            ? "Running on port 4000."
            : "Not running. Open a terminal and run ./run.sh in the project folder."}
        </Step>

        <Step n="2" done={installed} title="Install the extension">
          {installed ? (
            "Installed and talking to this page."
          ) : (
            <>
              Open <code>chrome://extensions</code>, turn on{" "}
              <strong>Developer mode</strong> (top-right switch), click{" "}
              <strong>Load unpacked</strong>, and select the{" "}
              <code>extension</code> folder inside{" "}
              <code>~/Desktop/dialect-vocab</code>. Then reload this page.
            </>
          )}
        </Step>

        <Step n="3" done={false} title={`Watch ${platform.name}`}>
          Click the Lexicon icon in Chrome's toolbar and choose your subtitle
          language — it cannot be detected here, because there is no audio to
          detect it from. Then open {platform.name}, log in as usual, and play
          something with subtitles.
        </Step>

        <div className="setup-actions">
          <a href="/extension-test.html" target="_blank" rel="noreferrer">
            <button className="primary">Test it without {platform.name}</button>
          </a>
          <span className="muted">
            Opens a fake player that behaves like {platform.name}, so you can
            confirm it works before using your account.
          </span>
        </div>

        <div className="notice">
          On this route there are no word-level timings, so no video clips, and
          dialect detection is text-only. That is the DRM, not the
          implementation. <strong>Uploading a file gives you everything.</strong>
        </div>
      </div>
    </div>
  );
}
