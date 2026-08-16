import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Proxy the API and the media files so the browser sees one origin. Without
// this the video element would be doing cross-origin range requests, which is
// a fight not worth having in development.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": { target: "http://localhost:4000", changeOrigin: true },
      "/media": { target: "http://localhost:4000", changeOrigin: true },
    },
  },
});
