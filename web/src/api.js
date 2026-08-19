// Thin API client. Everything goes through the Vite proxy in development, so
// paths are relative and there is no base URL to configure.

async function json(res) {
  if (!res.ok) {
    const body = await res.text();
    throw new Error(body || `${res.status} ${res.statusText}`);
  }
  return res.json();
}

export const api = {
  health: () => fetch("/api/health").then(json),

  listVideos: () => fetch("/api/videos").then(json),

  getVideo: (id) => fetch(`/api/videos/${id}`).then(json),

  getSegments: (id) => fetch(`/api/videos/${id}/segments`).then(json),

  deleteVideo: (id) => fetch(`/api/videos/${id}`, { method: "DELETE" }).then(json),

  uploadVideo: (file, language, model, onProgress, target) => {
    // XHR rather than fetch because fetch still cannot report upload progress,
    // and these files are large enough that a progress bar matters.
    return new Promise((resolve, reject) => {
      const form = new FormData();
      form.append("video", file);
      form.append("language", language);
      form.append("model", model);
      form.append("target", target || "en");

      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/videos");
      xhr.upload.addEventListener("progress", (e) => {
        if (e.lengthComputable && onProgress) {
          onProgress(Math.round((e.loaded / e.total) * 100));
        }
      });
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) resolve(JSON.parse(xhr.responseText));
        else reject(new Error(xhr.responseText || `upload failed (${xhr.status})`));
      };
      xhr.onerror = () => reject(new Error("network error during upload"));
      xhr.send(form);
    });
  },

  listWords: (videoId, language) => {
    const q = new URLSearchParams();
    if (videoId) q.set("videoId", videoId);
    if (language) q.set("language", language);
    const s = q.toString();
    return fetch(`/api/words${s ? `?${s}` : ""}`).then(json);
  },

  saveWord: (videoId, segmentId, tokenIndex) =>
    fetch("/api/words", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ videoId, segmentId, tokenIndex }),
    }).then(json),

  deleteWord: (id) => fetch(`/api/words/${id}`, { method: "DELETE" }).then(json),

  clipUrl: (wordId) => `/api/words/${wordId}/clip`,

  tokenise: (text, language) =>
    fetch("/api/tokenise", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, language }),
    }).then(json),

  // Saving a word that has no video behind it — the companion and the
  // extension both land here.
  saveExternal: (payload) =>
    fetch("/api/words/external", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).then(json),

  lookup: (lang, word, surface) =>
    fetch(
      `/api/dictionary?lang=${lang}&word=${encodeURIComponent(word)}` +
        `&surface=${encodeURIComponent(surface || "")}`,
    ).then(json),

  exportUrl: (videoId, language) => {
    const q = new URLSearchParams();
    if (videoId) q.set("videoId", videoId);
    if (language) q.set("language", language);
    const s = q.toString();
    return `/api/words/export${s ? `?${s}` : ""}`;
  },
};
