const { contextBridge, ipcRenderer } = require("electron");

/* The bridge between the Lexicon web app and the desktop shell.
 *
 * The web app is the same build that runs in a browser. When it happens to be
 * running inside this shell, `window.lexicon` exists, so the platform cards can
 * open Netflix for real instead of explaining why they cannot. In a plain
 * browser the object is absent and the app falls back to the extension route —
 * one build, two behaviours, decided at runtime.
 *
 * contextBridge rather than nodeIntegration: this window loads our own page,
 * but the player view loads third-party sites, and keeping the same hardened
 * settings everywhere is cheaper than remembering which is which.
 */
contextBridge.exposeInMainWorld("lexicon", {
  isDesktop: true,

  openPlatform: (id) => ipcRenderer.invoke("open-platform", { id }),
  closePlatform: () => ipcRenderer.invoke("close-platform"),

  // The app measures the rectangle it has reserved for the player and reports
  // it, so the layout lives in CSS rather than being hard-coded in the shell.
  setPlayerBounds: (bounds) => ipcRenderer.invoke("set-player-bounds", bounds),

  // Current subtitle line, straight from the streaming page.
  onSubtitle: (callback) => {
    const handler = (_e, text) => callback(text);
    ipcRenderer.on("subtitle", handler);
    return () => ipcRenderer.removeListener("subtitle", handler);
  },
});
