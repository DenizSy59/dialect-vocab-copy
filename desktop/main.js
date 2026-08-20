/* Lexicon desktop shell.
 *
 * Why this exists: Netflix and the other DRM platforms cannot be embedded in a
 * web page. netflix.com sends x-frame-options: DENY, so an iframe comes back
 * empty — tested, not assumed. A desktop window loads a site as a top-level
 * page, so that rule never applies.
 *
 * What remains is DRM, which needs two things:
 *   1. castlabs' Electron build, which ships the Widevine module stock
 *      Electron lacks.
 *   2. A real VMP signature. Without it Netflix returns E100 and GagaOOLala
 *      returns "license request failed". Run ./sign.sh once.
 *
 * Also: never set a custom user agent. An earlier version did, reasoning that
 * announcing Electron would get us rejected, and it caused E100 by itself.
 *
 * Layout: the app fills the window and reserves a rectangle for the player.
 * The streaming site lives in a WebContentsView positioned over exactly that
 * rectangle, so the app's own chrome sits above, below and beside it. The view
 * is a separate top-level page as far as the site is concerned — it just
 * happens to be drawn inside our window.
 *
 * Subtitles come back over IPC as plain text. The app tokenises and renders
 * them itself rather than having anything drawn onto the site, which keeps the
 * words in our fonts, our theme and our click handling.
 */

const { app, BrowserWindow, WebContentsView, ipcMain, shell } = require("electron");
const { components } = require("electron");
const path = require("node:path");

const APP_URL = process.env.LEXICON_APP_URL || "http://localhost:4000";

const PLATFORM_URLS = {
  netflix: "https://www.netflix.com/browse",
  prime: "https://www.primevideo.com",
  viki: "https://www.viki.com",
  iqiyi: "https://www.iq.com",
  gagaoolala: "https://www.gagaoolala.com",
  youtube: "https://www.youtube.com",
};

let mainWindow = null;
let playerView = null;
// Remembered so the view can be repositioned on window resize without the app
// having to report its bounds again.
let lastBounds = null;

function attachPlayer(id) {
  const url = PLATFORM_URLS[id];
  if (!url || !mainWindow) return { ok: false, error: `unknown platform ${id}` };

  detachPlayer();

  playerView = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, "platform-preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  mainWindow.contentView.addChildView(playerView);
  // Start hidden. The app reports the real rectangle once it has laid out, and
  // a view sized 0x0 until then avoids a flash of full-window Netflix.
  playerView.setBounds(lastBounds || { x: 0, y: 0, width: 0, height: 0 });

  playerView.webContents.setWindowOpenHandler(({ url: target }) => {
    shell.openExternal(target);
    return { action: "deny" };
  });

  playerView.webContents.loadURL(url);
  return { ok: true };
}

function detachPlayer() {
  if (!playerView) return;
  try {
    mainWindow.contentView.removeChildView(playerView);
    playerView.webContents.close();
  } catch {
    // Already gone; nothing to clean up.
  }
  playerView = null;
}

async function main() {
  // Widevine must be ready before any window opens, or the first page loads
  // without DRM and the failure looks like the site's fault.
  console.log("waiting for Widevine…");
  await components.whenReady();
  console.log("widevine:", JSON.stringify(components.status()));

  mainWindow = new BrowserWindow({
    width: 1500,
    height: 940,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: "#05070f",
    title: "Lexicon",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  mainWindow.webContents.on("did-fail-load", (_e, code, desc) => {
    console.log(`app failed to load [${code}] ${desc} — is the API running? ./run.sh`);
  });

  // Keep the player glued to its rectangle when the window changes size. The
  // app also re-reports on resize, but doing it here means no visible lag.
  mainWindow.on("resize", () => {
    if (playerView && lastBounds) playerView.setBounds(lastBounds);
  });

  mainWindow.on("closed", () => {
    playerView = null;
    mainWindow = null;
  });

  await mainWindow.loadURL(APP_URL);
}

ipcMain.handle("open-platform", (_e, { id }) => attachPlayer(id));

ipcMain.handle("close-platform", () => {
  detachPlayer();
  return { ok: true };
});

// The app measures its own placeholder element and sends the rectangle, so the
// layout stays in CSS where it belongs rather than being duplicated here.
ipcMain.handle("set-player-bounds", (_e, bounds) => {
  lastBounds = {
    x: Math.round(bounds.x),
    y: Math.round(bounds.y),
    width: Math.round(bounds.width),
    height: Math.round(bounds.height),
  };
  if (playerView) playerView.setBounds(lastBounds);
  return { ok: true };
});

// Subtitle text from the streaming view, relayed to the app to render.
ipcMain.on("reader-status", (_e, msg) => console.log("reader:", msg));

ipcMain.on("subtitle", (_e, text) => {
  console.log("subtitle:", text ? text.slice(0, 60) : "(cleared)");
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("subtitle", text);
  }
});

app.whenReady().then(main);
app.on("window-all-closed", () => app.quit());
