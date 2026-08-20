"""Queue worker: takes transcription jobs from Redis, writes results to MongoDB.

This is the consumer side of the split the architecture calls for. The Node API
drops a job and returns immediately, because transcribing forty minutes of video
takes minutes and an HTTP request cannot wait for it.

Whisper models are cached per (language, model) for the life of the process.
Loading them takes longer than transcribing a short clip, so a worker that
reloaded per job would spend most of its time loading.

Usage:
    python src/worker.py
    WHISPER_MODEL=large-v3 python src/worker.py
"""

import asyncio
import os
import signal
import sys
import traceback
from pathlib import Path

from bson import ObjectId
from bullmq import Worker
from pymongo import MongoClient

sys.path.insert(0, str(Path(__file__).parent))
from pipeline import Pipeline, detect_language, media_duration, pick_device, SUPPORTED

# Must match queueName in the Node API config, or jobs go into a queue nobody
# is watching and simply sit there.
QUEUE_NAME = "transcription"

REDIS_URL = os.environ.get("REDIS_URL", "redis://127.0.0.1:6379")
MONGO_URI = os.environ.get("MONGO_URI", "mongodb://127.0.0.1:27017/dialect_vocab")
SCRIPT = os.environ.get("CHINESE_SCRIPT", "simplified")
DEFAULT_TARGET = os.environ.get("TRANSLATE_TO", "en")

mongo = MongoClient(MONGO_URI)
db = mongo.get_default_database()

# Keyed by (language, model). Whisper and the aligner are big; keeping them
# resident is the difference between a few seconds per job and a minute.
_pipelines: dict[tuple[str, str, str], Pipeline] = {}


def get_pipeline(language: str, model: str, target: str = "en") -> Pipeline:
    key = (language, model, target)
    if key not in _pipelines:
        print(f"loading pipeline for {language}/{model}->{target} (first of its kind)")
        _pipelines[key] = Pipeline(language, model, device="auto", script=SCRIPT,
                                   target=target)
    return _pipelines[key]


def set_status(video_id, **fields):
    db.videos.update_one({"_id": ObjectId(video_id)}, {"$set": fields})


def store_result(video_id, result: dict) -> None:
    """Write segments and roll the summary up onto the video document.

    Field names are camelCased here because the Mongoose schemas on the API side
    expect that. Keeping the pipeline output snake_case and translating at the
    boundary is less annoying than making the pipeline care about the database.
    """
    oid = ObjectId(video_id)
    db.segments.delete_many({"videoId": oid})  # re-runs should replace, not add

    docs = []
    for seg in result["segments"]:
        docs.append({
            "videoId": oid,
            "index": seg["id"],
            "start": seg["start"],
            "end": seg["end"],
            "text": seg["text"],
            "english": seg.get("english", ""),
            "translation": seg.get("translation", "") or seg.get("english", ""),
            "words": seg["words"],
            "tokens": [
                {
                    "surface": t["surface"],
                    "lemma": t["lemma"],
                    "pos": t["pos"],
                    "charStart": t["char_start"],
                    "charEnd": t["char_end"],
                    "content": t["content"],
                    "reading": t.get("reading", ""),
                    "start": t["start"],
                    "end": t["end"],
                }
                for t in seg["tokens"]
            ],
            "difficulty": seg.get("difficulty"),
            "dialectMarkers": seg.get("dialectMarkers", []),
        })
    if docs:
        db.segments.insert_many(docs)

    cov, tim = result["coverage"], result["timing"]
    dia = result.get("dialect") or {}
    set_status(
        video_id,
        dialect={
            "available": dia.get("available", False),
            "detected": dia.get("detected", False),
            "dialect": dia.get("dialect", ""),
            "label": dia.get("label", ""),
            "score": dia.get("score"),
            "standardScore": dia.get("standard_score"),
            "method": dia.get("method", ""),
            "caveat": dia.get("caveat", ""),
            "evidence": dia.get("evidence", []),
        },
        status="done",
        progress=100,
        stage="done",
        error="",
        durationSec=result["audio_duration_sec"],
        coverage={
            "tokensTotal": cov["tokens_total"],
            "tokensWithTiming": cov["tokens_with_timing"],
            "tokensPct": cov["tokens_pct"],
            "contentTotal": cov["content_total"],
            "contentWithTiming": cov["content_with_timing"],
            "contentPct": cov["content_pct"],
        },
        timing={
            "transcribeSec": tim["transcribe_sec"],
            "alignSec": tim["align_sec"],
            "computeSec": tim["compute_sec"],
            "totalSec": tim["total_sec"],
            "computeRealtimeFactor": tim["compute_realtime_factor"],
        },
    )


def choose_model(duration: float, device: str) -> str:
    """Pick a Whisper size when the user did not.

    Quality when it is affordable, speed when it is not. On a real GPU large-v3
    is fast enough that there is no reason to use anything else; on CPU it runs
    at about 1.8x realtime, so it is only sensible for short clips.

    This matters more than it sounds: small produces visibly wrong Korean
    content words, and a learner cannot tell a mis-transcription from a word
    they do not know yet.
    """
    if device == "cuda":
        return "large-v3"
    if duration <= 60:
        return "large-v3"
    if duration <= 180:
        return "medium"
    return "small"


def run_job_blocking(video_id: str, path: str, language: str, model: str,
                     target: str = "en") -> dict:
    """The CPU-bound part. Called in a thread so the worker keeps its heartbeat."""
    if language == "auto":
        set_status(video_id, status="processing", progress=5, stage="detecting language")
        detected, probability = detect_language(Path(path))
        if detected not in SUPPORTED:
            raise RuntimeError(
                f"detected language {detected!r} is not supported "
                f"(this build handles {', '.join(SUPPORTED)}). "
                "Pick a language manually if the detection is wrong."
            )
        language = detected
        set_status(video_id, language=language, languageConfidence=round(probability, 3))
        print(f"  detected language: {language} ({probability:.2f})")

    if model == "auto":
        duration = media_duration(Path(path))
        device, _ = pick_device("auto")
        model = choose_model(duration, device)
        set_status(video_id, model=model)
        print(f"  chose model {model} for {duration:.0f}s on {device}")

    set_status(video_id, status="processing", progress=10, stage="loading model")
    pipe = get_pipeline(language, model, target)

    set_status(video_id, progress=25, stage="transcribing")
    result = pipe.run(Path(path))

    set_status(video_id, progress=90, stage="saving")
    store_result(video_id, result)
    return result


async def process(job, job_token):
    data = job.data
    video_id = data["videoId"]
    print(f"job {job.id}: {data['language']}/{data['model']} {Path(data['path']).name}")

    try:
        # Whisper holds the GIL for long stretches; without a thread the worker
        # would look dead to BullMQ and the job would be marked stalled.
        result = await asyncio.to_thread(
            run_job_blocking, video_id, data["path"], data["language"], data["model"],
            data.get("target") or DEFAULT_TARGET,
        )
        cov = result["coverage"]
        print(
            f"job {job.id}: done, {len(result['segments'])} segments, "
            f"{cov['content_pct']}% content-word coverage, "
            f"{result['timing']['compute_sec']}s compute"
        )
        return {"segments": len(result["segments"]), "coverage": cov["content_pct"]}
    except Exception as e:
        traceback.print_exc()
        set_status(video_id, status="error", stage="failed", error=str(e)[:500])
        raise


async def main():
    print(f"worker starting: queue={QUEUE_NAME} redis={REDIS_URL}")
    print(f"mongo={MONGO_URI}")
    worker = Worker(QUEUE_NAME, process, {"connection": REDIS_URL})

    stop = asyncio.Future()

    def shutdown():
        if not stop.done():
            print("\nshutting down")
            stop.set_result(True)

    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, shutdown)

    print("waiting for jobs")
    await stop
    await worker.close()


if __name__ == "__main__":
    asyncio.run(main())
