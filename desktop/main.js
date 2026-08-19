/* Desktop shell — an experiment, not yet a product.
 *
 * The question this exists to answer: will Netflix play inside an app we
 * control? A website cannot do it (netflix.com refuses to be framed — tested,
 * the iframe comes back empty), but a desktop app loads the site as a
 * top-level page, so the framing rules never apply. What is left is DRM.
 *
 * This uses castlabs' Electron build, which ships the Widevine module stock
 * Electron lacks and self-signs for VMP. If Netflix plays here, the streaming
 * side of the project becomes possible in a way it is not on the web. If it
 * returns one of the M7xxx errors, that is Netflix declining to serve a client
 * it does not recognise, and no amount of our code changes it.
 *
 * You log in yourself, in this window. Nothing here handles credentials.
 *
 * Run:  npm start
 */

const { app, BrowserWindow, components, shell } = require("electron");

const START_URL = process.env.LEXICON_URL || "https://www.netflix.com/browse";

// Netflix inspects the client. Electron's default user agent announces both
// Electron and the app name, which is an immediate tell; presenting as plain
// Chrome at least gets past the trivial check so the result reflects the DRM
// decision rather than a string comparison.
const CHROME_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36";

async function main() {
  // Widevine has to be downloaded and verified before any window opens, or the
  // page loads without DRM and the failure looks like a Netflix problem when it
  // is really a startup ordering problem.
  console.log("waiting for Widevine components…");
  await components.whenReady();
  console.log("component status:", JSON.stringify(components.status(), null, 2));

  const win = new BrowserWindow({
    width: 1360,
    height: 860,
    backgroundColor: "#05070f",
    title: "Lexicon",
    webPreferences: {
      // No node integration in a window that loads a third-party site.
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  win.webContents.setUserAgent(CHROME_UA);

  // Report what actually happens, since the entire point is the diagnosis.
  win.webContents.on("did-fail-load", (_e, code, desc, url) => {
    console.log(`load failed [${code}] ${desc} — ${url}`);
  });
  win.webContents.on("did-finish-load", () => {
    console.log("loaded:", win.webContents.getURL());
  });
  win.webContents.on("console-message", (_e, _level, message) => {
    if (/widevine|drm|error|M7\d{3}|licen/i.test(message)) {
      console.log("page:", message.slice(0, 300));
    }
  });

  // External links open in the real browser rather than escaping this window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  await win.loadURL(START_URL);
}

app.whenReady().then(main);

app.on("window-all-closed", () => app.quit());
