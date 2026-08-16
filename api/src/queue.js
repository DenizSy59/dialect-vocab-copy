import { Queue } from "bullmq";
import { config } from "./config.js";

// The API only ever produces jobs. The consumer is the Python worker, because
// Whisper is Python and this is not. BullMQ's job payload is plain JSON, which
// is the whole reason a Python worker can read a queue a Node process wrote.
export const transcriptionQueue = new Queue(config.queueName, {
  connection: config.redis,
  defaultJobOptions: {
    // Transcription failures are usually deterministic (bad file, missing
    // model) so retrying twice is enough; more just wastes GPU minutes.
    attempts: 2,
    backoff: { type: "fixed", delay: 5000 },
    removeOnComplete: 100,
    removeOnFail: 100,
  },
});

export async function enqueueTranscription({ videoId, path, language, model }) {
  return transcriptionQueue.add("transcribe", {
    videoId,
    path,
    language,
    model,
  });
}
