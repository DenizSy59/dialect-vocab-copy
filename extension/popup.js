const API = "http://localhost:4000";

const select = document.getElementById("lang");
const status = document.getElementById("status");

chrome.storage.local.get(["language"]).then(({ language }) => {
  select.value = language || "ko";
});

select.addEventListener("change", () => {
  chrome.storage.local.set({ language: select.value });
});

// The extension is useless without the API running, and that is the single most
// likely reason for it appearing to do nothing, so it is checked up front
// rather than left for the user to work out.
fetch(`${API}/api/health`)
  .then((r) => (r.ok ? r.json() : Promise.reject()))
  .then(() => {
    status.textContent = "Lexicon is running";
    status.className = "status ok";
  })
  .catch(() => {
    status.textContent = "Lexicon is not running — start the API on :4000";
    status.className = "status bad";
  });
