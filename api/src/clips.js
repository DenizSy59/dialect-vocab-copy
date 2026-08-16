import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";

fs.mkdirSync(config.clipDir, { recursive: true });

/* Cut the sentence a saved word came from out of the source video.
 *
 * This is the feature that separates this from Language Reactor and Migaku,
 * which save a screenshot and audio. Cutting on demand rather than upfront
 * keeps a long video cheap: most saved words never have their clip played.
 *
 * Re-encoded rather than stream-copied. Stream copy snaps the cut to the
 * nearest keyframe, which on a typical video can be seconds away — for a
 * two second clip that is the difference between the right sentence and the
 * wrong one.
 */
export function cutClip({ sourcePath, start, end, outName }) {
  return new Promise((resolve, reject) => {
    const out = path.join(config.clipDir, outName);
    if (fs.existsSync(out)) return resolve(out);

    const from = Math.max(0, (start ?? 0) - config.clipPaddingSec);
    const duration = Math.max(0.4, (end ?? 0) - (start ?? 0) + config.clipPaddingSec * 2);

    const args = [
      "-nostdin",
      "-loglevel", "error",
      "-y",
      // -ss before -i seeks fast; the re-encode after it keeps the cut exact.
      "-ss", from.toFixed(3),
      "-i", sourcePath,
      "-t", duration.toFixed(3),
      "-c:v", "libx264",
      "-preset", "veryfast",
      "-crf", "23",
      "-c:a", "aac",
      "-b:a", "128k",
      // Lets the browser start playing before the whole file arrives.
      "-movflags", "+faststart",
      out,
    ];

    const proc = spawn("ffmpeg", args);
    let stderr = "";
    proc.stderr.on("data", (d) => (stderr += d.toString()));
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0 && fs.existsSync(out)) resolve(out);
      else reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(0, 400)}`));
    });
  });
}
