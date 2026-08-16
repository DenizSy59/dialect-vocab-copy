# Log

Running record of decisions and failures. Newest entry at the bottom.

---

## 2026-08-16 — day 1

### Fresh start

Moved out of `Downloads/netflix_clone` (an unrelated Flutter project) into a
clean repo at `~/Desktop/dialect-vocab`. Git initialised here from the start.

Created the skeleton: `ml/`, `api/`, `web/`, `extension/`, `docs/`. Only `ml/`
gets touched this week — the others are empty placeholders so the layout is
fixed and imports don't have to move later.

### Schedule revised

The week-by-week plan in the brief is superseded. Roughly 6 weeks available at
5–7 hours a day, so the plan is compressed to day numbers with core product
done around **12 September** and a week of buffer before the semester starts
on 29 September.

| Days | Focus |
|---|---|
| 1–3 | Spike: video in, timestamped lemmatised JSON out. Terminal only. |
| 4–7 | Node API, MongoDB schemas, Redis queue, upload endpoint. |
| 8–12 | React player, subtitles rendering and staying in sync. |
| 13–18 | Click a word, dictionary lookup, save with sentence + clip. |
| 19+ | Dialect classifier, idiom detection, difficulty scoring, timeline strip. |

Build order is unchanged: pipeline first, interface last.

### Blockers found before writing any code

Three things in the day-1 plan turned out not to exist or not to match reality.
Recording them because they change what day 1 can actually be.

**1. No README with Python setup existed.** The only `README.md` on the machine
was Flutter boilerplate inside `netflix_clone`. Wrote a real one covering the
WSL2 + CUDA path, but the specifics are unverified — nothing has been run.

**2. This machine is not the 4090 box.** The development machine here is a
MacBook Neo, Apple A18 Pro, 8 GB RAM, macOS 26.4.1, arm64. No `nvidia-smi`, no
`wsl`, no CUDA — and CUDA does not exist for Apple Silicon at all.
`torch.cuda.is_available()` cannot return `True` here under any configuration.
So the "confirm CUDA sees the RTX 4090" step is not a thing that can be done
from this machine; it has to happen on the Windows box. Left unresolved.

Related risk worth noting early: 8 GB of unified memory is not enough for
Whisper large-v3 even on CPU, so the Mac cannot be a fallback for real runs,
only for tiny smoke tests with a small model.

**3. No idiom-detection spec.** The brief was said to have gained an idiom
detection feature for the dialect phase. It hasn't — `CLAUDE.md` contains no
mention of idioms anywhere, and no other file on the machine does either. The
file was last modified today at 14:34 but the content is unchanged from what
was read at the start of the session. Either the edit went to a different copy
or it was never saved. Nothing to build against yet; the feature is not due
until the dialect phase regardless.

### State at end of entry

Repo structure and this log committed. Python environment **not** set up.
`transcribe.py` **not** written. Both are waiting on the hardware question.
