// Central config so the worker and the API agree on names. The Python worker
// reads the same defaults from its own config, and the queue name in
// particular has to match exactly or jobs vanish into a queue nobody watches.

import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

dotenv.config();

const here = path.dirname(fileURLToPath(import.meta.url));

export const config = {
  port: Number(process.env.PORT || 4000),
  mongoUri: process.env.MONGO_URI || "mongodb://127.0.0.1:27017/dialect_vocab",
  redis: {
    host: process.env.REDIS_HOST || "127.0.0.1",
    port: Number(process.env.REDIS_PORT || 6379),
  },
  // Must match QUEUE_NAME in the Python worker.
  queueName: "transcription",
  uploadDir: process.env.UPLOAD_DIR || path.join(here, "..", "uploads"),
  // Whisper model the worker should use. small is the sensible default on the
  // Mac: about 40 s for a one minute clip against 2.5 min for large-v3, and it
  // already reproduces the error pattern we care about.
  defaultModel: process.env.WHISPER_MODEL || "small",
};
