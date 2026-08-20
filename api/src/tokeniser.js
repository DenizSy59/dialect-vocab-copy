import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const ML = path.join(here, "..", "..", "ml");

/* One long-lived Python process for tokenising.
 *
 * The first version spawned a process per request, which cost the full import
 * and model load every time — 0.4 s for Chinese, 1.3 s for Korean, 2.5 s for
 * Turkish. Streaming subtitles change roughly every two seconds, so Turkish
 * results always arrived after the line had gone and were discarded. The
 * feature looked broken for precisely the languages with the heaviest
 * tokenisers.
 *
 * With the process kept alive, the tokenisers load once and each line costs a
 * few milliseconds.
 *
 * The process is restarted automatically if it dies, and requests made while
 * it is down are rejected rather than left hanging.
 */

let proc = null;
let buffer = "";
let nextId = 1;
const pending = new Map();

// Long enough to cover a first-use model load, short enough that a wedged
// process does not hold a subtitle line forever.
const TIMEOUT_MS = 20000;

function start() {
  proc = spawn(path.join(ML, ".venv", "bin", "python"), ["src/tokenise_server.py"], {
    cwd: ML,
    stdio: ["pipe", "pipe", "pipe"],
  });

  proc.stdout.on("data", (chunk) => {
    buffer += chunk.toString();
    // Responses are newline-delimited JSON; a chunk may hold several or part
    // of one, so keep the remainder for next time.
    let idx;
    while ((idx = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        continue; // a library printing to stdout, not a response
      }
      if (msg.ready) {
        console.log("tokeniser ready");
        continue;
      }
      const entry = pending.get(msg.id);
      if (!entry) continue;
      pending.delete(msg.id);
      clearTimeout(entry.timer);
      if (msg.error) entry.reject(new Error(msg.error));
      else entry.resolve(msg.tokens || []);
    }
  });

  // Python libraries write load messages to stderr; only surface real trouble.
  proc.stderr.on("data", (d) => {
    const text = d.toString().trim();
    if (/Traceback|Error/i.test(text)) console.error("tokeniser:", text.slice(0, 300));
  });

  proc.on("exit", (code) => {
    console.error(`tokeniser exited (${code}) — restarting on next request`);
    for (const [, entry] of pending) {
      clearTimeout(entry.timer);
      entry.reject(new Error("tokeniser process exited"));
    }
    pending.clear();
    proc = null;
  });
}

export function tokenise(text, language) {
  if (!proc) start();

  return new Promise((resolve, reject) => {
    const id = nextId++;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`tokeniser timed out after ${TIMEOUT_MS}ms`));
    }, TIMEOUT_MS);

    pending.set(id, { resolve, reject, timer });
    proc.stdin.write(JSON.stringify({ id, text, language }) + "\n");
  });
}

// Start eagerly so the first subtitle does not pay for the import.
start();
