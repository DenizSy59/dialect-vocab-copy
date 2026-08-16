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

## Running the spike

Not yet implemented — see `LOG.md`.
