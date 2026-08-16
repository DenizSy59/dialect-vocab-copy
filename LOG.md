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

### Test data

No clips to hand, so pulled the **FLEURS** dev sets for `ko_kr` and
`cmn_hans_cn` (Google, CC-BY-4.0 — attribution goes in the report). 344 MB.
`make_testset.py` extracts clips and writes a manifest pairing each wav with
its reference transcript.

Reference text was the reason for choosing this over just grabbing audio. The
research question is accuracy, and accuracy needs ground truth.

What FLEURS is **not**: it is studio-read Wikipedia sentences, standard Seoul
Korean and Putonghua, audio only. So it is the clean baseline and nothing else
— not the fast dialogue open question 1 asks about, no dialect content for the
day 19+ work, and no video to test clip cutting on. Real drama clips still
needed.

### First end-to-end runs

Six clips, three per language, whisper **small** on CPU. Not large-v3 — every
number here is provisional until it is re-run on the 4090.

Environment snag worth recording: Homebrew installs ffmpeg 9, but `torchcodec`
only supports ffmpeg 4–7, so it fails to load and prints an alarming traceback
on every run. It turns out to be harmless here — audio goes through the ffmpeg
binary and whisperx's own loader, not torchcodec. Left alone rather than
downgrading ffmpeg, but if torchaudio decoding is ever needed directly this has
to be fixed.

**Word timing coverage: 100% of tokens and 100% of content words on all six
clips, both languages.** Comfortably past the 90% threshold. WhisperX force
alignment works for Korean and Chinese.

Speed on the Mac was the surprise — compute is *faster* than realtime even on
CPU: 0.30–0.92x realtime, so ~5–8 s of compute per clip. Wall time is dominated
by model loading. `transcribe.py` now reports `compute_sec` separately from
`total_sec`, because the cold-cache first run showed 18.83x realtime, which was
almost entirely the 1.2 GB alignment model downloading and said nothing at all
about the pipeline.

### What the errors look like — this is the interesting part

Coverage being 100% does not mean the transcript is right. Coverage measures
alignment; correctness is a separate question, and the two came apart
immediately.

Korean, clip 2 — reference vs whisper small:

| reference | output | |
|---|---|---|
| 숲이 | 습이 | wrong, not a word |
| 무척 | 부착 | wrong |
| 나무가 | 나뭇가 | wrong |
| 큰 / 없었기 때문에 / 비쌌다 | same | correct |

The errors are on content words. The grammar came through clean. Same pattern
in the other two Korean clips: 인류→인유, 이집트인들→일트인들, 족히 넘은→좋기남은,
and one outright hallucination, 몰아냈음을→"보란 S&M".

This is the hypothesis in the brief reproducing itself on the first clip a
learner would ever see. Reporting it, not concluding it — a Korean speaker has
to listen to the audio and confirm these are genuinely wrong rather than
acceptable variants, and it has to be re-run on large-v3 before it means
anything.

**Alignment score may be a usable error signal, in Korean.** The wrong words
scored 0.30, 0.33 and 0.56 while correct ones sat at 0.74–0.81. If that holds
up, the app could warn the learner that a word looks unreliable instead of
silently teaching them a non-word. Worth testing properly.

It does **not** obviously hold in Chinese: 鋪 and 客棟 are wrong but scored 0.89,
in the same band as everything else. Different failure mode, since Chinese
errors are homophone substitutions that the acoustic model is happy with.

### Chinese: traditional vs simplified

Two of the three Chinese clips came back in **traditional** characters
(因為遠離大陸…, 亞馬遜河…) against simplified references. This is a real product
problem, not a scoring artefact — a learner studying simplified gets output
their dictionary lookup will miss, and saved vocabulary would be inconsistent.
Needs a normalisation step (opencc) once the target script is decided.

Chinese also drops punctuation entirely, and Korean normalises numbers
differently from the reference (이백만→200만, 1000년→천 년). Neither is really an
error, but both will inflate word error rate unless the comparison normalises
text first. Anything that computes WER later has to handle this or the numbers
will be wrong in our favour and then wrong against us.

### Second test set: spontaneous speech and video

FLEURS is read speech, which cannot answer open question 1. Pulled five freely
licensed videos from Wikimedia Commons to get the opposite condition —
spontaneous speech, background noise, and actual video files so the clip
feature has something to cut. `fetch_commons.py` downloads them and writes a
manifest with author and licence, because these are CC BY / CC BY-SA and
**attribution is required in the report**.

| file | condition | length |
|---|---|---|
| 손호준 인터뷰 | studio, two speakers | 61 s |
| 정성규 선수 인터뷰 | post-match | 85 s |
| 정희웅 그라운드 인터뷰 | pitchside, crowd noise | 53 s |
| C919 뉴스 | news plus street interviews | 169 s |
| Solomon speaking 湖口话 | Chinese dialect | 418 s |

No reference transcripts, so these give coverage and clips but not error rates.
FLEURS stays the source for accuracy.

### Open question 1 — answered, provisionally

Word timing coverage on spontaneous speech, whisper small:

| clip | all tokens | content words |
|---|---|---|
| 손호준 | 100% | 100% (106) |
| 정성규 | 100% | 100% (179) |
| 정희웅 (crowd noise) | 100% | 100% (74) |
| C919 | 99.1% | 100% (289) |
| 湖口话 | 96.4% | 100% (457) |

Everything clears the 90% threshold, and content-word coverage is 100% on all
five. Noise and spontaneity did not break alignment. **Clips will not cut
mid-word for lack of timings**, so the feature stands as designed.

Speed on the Mac holds up at 0.35–0.50x realtime, so a 40-minute video would be
roughly 15 minutes of CPU here. Comfortably usable for development.

### The catch, restated

Coverage is now answered and it is not the interesting number. Every one of
those clips is 100% covered and several are substantially wrong.

Korean, 정희웅 (pitchside): grammar is clean, content words are not —
수비수→수위수, 태클→탁크, 침착하게→첨착하게, 헌신→형신, plus what looks like an
invented "포천 스튜디오". Same shape as the FLEURS errors.

Chinese, 湖口话: much worse. 方言 (dialect) comes out as 谎言 (lie) repeatedly,
語言學的本科 becomes 医院学的奔课, 大学 becomes 大火, and the name of the dialect
itself appears as 武后娃, 五侯瓦 and 武後 in three different places. Coverage 96.4%,
usability close to zero.

That clip is the whole argument in one file: alignment succeeded completely
while transcription failed, so a coverage number on its own tells a learner
nothing about whether the subtitle is safe to learn from.

**Traditional/simplified is worse than first thought.** The dialect clip
switches script *mid-transcript* — segments 1 and 5 simplified, 2 to 4
traditional. So normalisation is not a per-video setting, it has to run per
segment or per token.

All of this is whisper small. large-v3 should do better, especially on the
dialect clip, and none of these observations should be reported before it is
re-run on the 4090.

### Still open

- Everything above re-run on large-v3 on the 4090. Nothing here is reportable
  until then.
- Drama dialogue specifically. Interviews are spontaneous but one speaker at a
  time; overlapping drama dialogue is still untested.
- Whether the Korean lemmas and the error judgements above are correct. Needs
  a human who speaks the language.
- Target Chinese script (simplified or traditional) before writing normalisation.

### State at end of entry

Repo, environment, spike and test-set tooling committed. Pipeline runs end to
end in both languages and writes timestamped lemmatised JSON. No Node, no React.
