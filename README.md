# Dialect-Aware Vocabulary Learning from Video

Capstone project. Turns any video into language-learning material: transcribe
with speech recognition, align to word level, click a word to save it with its
sentence and a video clip of the moment it was spoken. Exports to Anki.

Full spec: see `CLAUDE.md` in the parent project brief.

## Layout

```
ml/          Python worker — ffmpeg, WhisperX, tokenise, lemmatise
api/         Node.js API — auth, words, job queue  (not started)
web/         React frontend — player, subtitles     (not started)
extension/   Browser extension for YouTube/Netflix  (not started)
docs/        Notes, measurements, report material
LOG.md       Running log of decisions and failures
```

## Python environment

The ML worker needs an NVIDIA GPU. Target machine is the RTX 4090 box running
Windows, worked on through WSL2 with CUDA passthrough.

### On WSL2 (Ubuntu) — the real setup

Install the NVIDIA driver **on Windows**, not inside WSL. WSL2 gets CUDA
through the Windows driver; installing a Linux driver inside WSL breaks it.

```bash
# check the GPU is visible from inside WSL first
nvidia-smi
```

That must print the RTX 4090 before going further.

```bash
sudo apt update && sudo apt install -y python3.11 python3.11-venv ffmpeg
cd ml
python3.11 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
```

Verify CUDA reaches torch:

```bash
python -c "import torch; print(torch.cuda.is_available(), torch.cuda.get_device_name(0))"
```

Expected: `True NVIDIA GeForce RTX 4090`. If it prints `False`, stop and fix
that before running anything else — WhisperX will silently fall back to CPU
and a 40-minute video will take hours.

### On the Mac

Not supported for the ML worker. Apple Silicon has no CUDA. Whisper can run on
CPU or MPS for small test clips, but large-v3 on 8 GB RAM is not realistic, and
any timing measurement taken here would not describe the real system. Use the
Mac for the Node API and React app only.

## Running the whole thing

```bash
./run.sh
```

Starts Redis, MongoDB, the API and the worker, **detached**, and prints the URL.
`./run.sh status` shows what is up, `./run.sh logs` tails both logs, `./run.sh
stop` stops the API and worker.

Detached matters: run as ordinary background jobs these die with the terminal
that launched them, and when they die the site serves nothing — which looks
exactly like a broken front end. If the page is blank, check `./run.sh status`
before anything else.

### Or by hand

Four processes. Services first:

```bash
brew services start redis
mongod --config /opt/homebrew/etc/mongod.conf --fork
```

Then the API and the worker, in separate terminals:

```bash
cd api && npm install && npm run dev
```

```bash
cd ml && .venv/bin/python src/worker.py
```

Frontend, either dev server or built and served by the API:

```bash
cd web && npm install && npm run dev        # http://localhost:5173
```

```bash
cd web && npm run build                     # then http://localhost:4000
```

The API serves `web/dist` when it exists, so for a demo the build plus the API
is one process instead of two.

### Local quirks on this Mac

- Homebrew's Redis 8 config loads modules the bottle does not ship. Those
  `loadmodule` lines are commented out in `/opt/homebrew/etc/redis.conf`.
- `brew services` will not start MongoDB from the untrusted `mongodb/brew` tap.
  Run `mongod` directly, as above.
- `torchcodec` prints a loud failure on every run because Homebrew ships ffmpeg
  9 and torchcodec supports 4–7. Harmless — audio goes through the ffmpeg binary.

## Running the pipeline on its own

```bash
cd ml
.venv/bin/python src/transcribe.py data/samples/clip.mp4 --language ko --model small
```

Roughly 30 s of compute per minute of audio with `small` on this Mac, 110 s with
`large-v3`. Keep test clips under two minutes.

## Dictionaries

Needed before word lookup works. Downloads about 190 MB, runs once:

```bash
cd ml
curl -sL -o data/dict/cedict.txt.gz https://www.mdbg.net/chinese/export/cedict/cedict_1_0_ts_utf-8_mdbg.txt.gz
curl -L -o data/dict/kaikki-ko.jsonl https://kaikki.org/dictionary/Korean/kaikki.org-dictionary-Korean.jsonl
.venv/bin/python src/build_dictionary.py
```

Sources are CC-CEDICT (CC BY-SA 4.0) and Wiktionary via kaikki.org (CC BY-SA
3.0). **Both require attribution in the report.**

## Tests

```bash
cd ml && .venv/bin/python -m pytest tests/ -q
```

54 tests over lemmatising, proper-noun merging, word-timing attachment, dialect
detection and the evaluation aligner.

## Measuring accuracy

```bash
cd ml
.venv/bin/python src/make_testset.py --language ko --count 20
.venv/bin/python src/evaluate.py --language ko --model small
```

Reports character and token error rates split by content versus function words,
plus the concentration ratio. See `LOG.md` for results and caveats.
