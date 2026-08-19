import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import "./themes.css";
import App from "./App.jsx";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Registered after load so it never competes with the first render. Only in
// production: in dev the service worker would serve a stale shell and quietly
// hide the changes you just made.
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  // Reload once when a new worker takes control, so a fresh build is picked up
  // on the next visit instead of the visit after it. Guarded because
  // controllerchange can fire more than once.
  let reloading = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloading) return;
    reloading = true;
    window.location.reload();
  });

  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js")
      .then((reg) => reg.update())
      .catch((err) => {
        console.warn("service worker registration failed:", err);
      });
  });
}
