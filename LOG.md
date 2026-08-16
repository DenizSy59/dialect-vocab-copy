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

### Hardware, resolved

Both machines exist. The 4090 box is the development machine for the ML worker;
this Mac is what gets used for **presenting**. That split matches the
architecture in the brief and costs nothing, because at demo time the
transcripts are already in MongoDB and no GPU is involved.

Consequence for the spike: `transcribe.py` selects its device at runtime —
CUDA when present, CPU otherwise — so one script is developed here and measured
on the 4090 without edits. Worth knowing that faster-whisper's backend
(CTranslate2) has no Metal support, so on Apple Silicon this is CPU even though
`torch.backends.mps.is_available()` is `True`. Small models only on the Mac.

The CUDA check asked for on day 1 could not be run: `torch.cuda.is_available()`
returns `False` here and always will. It has to be re-run on the 4090 before any
timing number is treated as real.

### Environment (on the Mac)

Homebrew Python 3.11.16 and ffmpeg 9.0.1 installed. venv at `ml/.venv`, pinned
in `ml/requirements.txt`. Key versions: whisperx 3.8.6, faster-whisper 1.2.1,
ctranslate2 4.8.1, torch 2.8.0, kiwipiepy 0.23.2, jieba 0.42.1.

### Open question 1 — partly answered

WhisperX ships wav2vec2 alignment models for **both** target languages:

- Korean — `kresnik/wav2vec2-large-xlsr-korean`
- Chinese — `jonatasgrosman/wav2vec2-large-xlsr-53-chinese-zh-cn`

So force alignment is available and the clip feature is not dead on arrival.
What is still unknown is coverage on real speech — whether fast drama dialogue
actually gets word timings for >90% of tokens. `transcribe.py` measures this
and prints it on every run, for all tokens and separately for content words.
Content-word coverage is the number that matters, since those are what a learner
saves. Needs test clips to answer.

### Open question 2 — first look

kiwipiepy handles the case named in the brief and the harder irregulars:

| input | lemma | note |
|---|---|---|
| 먹었어요 | 먹다 | the example from the brief |
| 왔는데 | 오다 | contraction 오+았 split correctly |
| 예뻤어요 | 예쁘다 | ㅂ-irregular |

Not judged as correct — that needs a Korean speaker reading real output, per the
brief. Noted for review: jieba tags 一起 as a numeral (`m`), so it falls outside
the content-word filter. The filter is a guess and should be revisited once
there is real transcript output to look at.

### State at end of entry

Repo, environment and the spike script are committed. `transcribe.py` has not
been run end to end — it needs test clips, which are the next thing required.
