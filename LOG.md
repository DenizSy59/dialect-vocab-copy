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

### Accuracy measurement — the research component

Everything above measures coverage. Coverage is the easy question. Built the
evaluation harness for the real one: **do the errors land on the words learners
actually need?**

`evaluate.py` runs the pipeline over a test set with reference transcripts,
then aligns reference against hypothesis token by token and attributes every
substitution and deletion to whether the *reference* token was a content word
(noun, verb, adjective, adverb — flashcard material) or a function word
(particles, endings — not).

Headline metric is the **concentration ratio**: share of errors landing on
content words, divided by content words' share of all tokens. 1.0 means errors
are spread evenly. Above 1.0 means they cluster on exactly the words a learner
would save.

Supporting work this needed:

- `pipeline.py` — pulled the pipeline out of `transcribe.py` into an object that
  loads whisper and the aligner once and then handles many files. Reloading
  models per clip made a sweep take longer than the sweep. Also roughly the
  shape the queue worker wants later.
- Script normalisation with opencc, defaulting to simplified, applied per
  segment. Without it the Chinese numbers are meaningless, since half the
  output was traditional against simplified references.
- Test set grown from 3 to 20 clips per language.

### Results: 20 FLEURS clips per language, four model sizes

| lang | model | CER | content err | function err | ratio | **concentration** | xRT |
|---|---|---|---|---|---|---|---|
| ko | tiny | 0.185 | 0.267 | 0.111 | 2.4 | **1.45** | 0.24 |
| ko | base | 0.115 | 0.178 | 0.052 | 3.4 | **1.59** | 0.33 |
| ko | small | 0.100 | 0.101 | 0.019 | 5.2 | **1.74** | 0.53 |
| ko | medium | 0.079 | 0.074 | 0.008 | 8.9 | **1.88** | 1.02 |
| ko | large-v3 | 0.067 | 0.037 | 0.011 | 3.3 | **1.58** | 1.79 |
| zh | tiny | 0.224 | 0.335 | 0.196 | 1.7 | 1.18 | 0.15 |
| zh | base | 0.165 | 0.210 | 0.188 | 1.1 | 1.04 | 0.24 |
| zh | small | 0.093 | 0.103 | 0.105 | 1.0 | 0.99 | 0.37 |
| zh | medium | 0.035 | 0.027 | 0.023 | 1.2 | 1.06 | 1.03 |
| zh | large-v3 | 0.026 | 0.013 | 0.015 | 0.9 | 0.96 | 1.78 |

**Korean: concentration rises with model size up to medium, then falls back at
large-v3** — 1.45, 1.59, 1.74, 1.88, then 1.58. Between tiny and medium,
function-word errors nearly vanish (0.111 → 0.008, 14x) while content-word
errors improve only 3.6x (0.267 → 0.074), so at medium a content word is 8.9
times more likely to be wrong than a function word. large-v3 then improves
content words disproportionately (0.074 → 0.037) and the ratio drops back to 3.4.

Worth being clear that an earlier reading of this table, before large-v3 had
run, called the rise monotonic and drew the conclusion that better models
concentrate errors *more*. large-v3 does not support that. The trend reverses at
the top end. Running it was the difference between a wrong claim and a right one.

What does survive across every model size: **concentration never drops to 1.0 in
Korean.** Even at large-v3, errors are 1.58x more likely to land on content
words than an even spread would predict. The problem gets smaller with a better
model; it does not go away.

**Chinese shows no such effect** — concentration sits near 1.0 at every size.
Errors are spread evenly across word types.

Not concluding why. A plausible reading is that Korean function morphemes are
predictable from context so the language model repairs them, while content words
carry the information and cannot be guessed — and that Chinese errors are
homophone substitutions that hit any word type equally. That is a hypothesis,
not a finding, and it needs someone who speaks the languages to assess.

### Caveats on the numbers above, before anyone quotes them

- 20 clips per language of **read studio speech**. Small, and the easy condition.
- Chinese content/function classification comes from jieba POS tags, which are
  cruder than kiwi's. The earlier 一起-as-numeral case shows the filter is
  imperfect, so the Chinese null result may be partly a measurement artefact
  rather than a fact about the language. Worth checking before relying on it.
- Numbers are not normalised (이백만 vs 200만), so all error rates are
  pessimistic. Pessimistic is the safer direction, but it is not neutral.

### large-v3 runs on the Mac after all

It fits. 8 GB is enough for large-v3 int8 plus the wav2vec2 aligner, though the
machine swaps hard and free memory dropped to about 70 MB during the run. Speed
is 1.79x realtime, so a 40-minute video would take roughly 72 minutes here.

That is slow but not blocking, and it means **the accuracy study did not need
the 4090**. The 4090 is now about turnaround time rather than feasibility —
worth re-running there to confirm the numbers match and to get realistic
timings, but the finding does not depend on it.

Best results, large-v3: Korean CER 0.067, Chinese CER 0.026.

### Backend and frontend — days 4 to 12, compressed

Node API with Express and Mongoose: `Video`, `Segment`, `SavedWord`. Uploads go
to BullMQ over Redis and the request returns immediately; the frontend polls for
progress. `worker.py` consumes the same queue from Python — bullmq has an
official Python port, so the split the architecture wanted works without a
custom protocol.

Two things had to be worked around locally:

- Redis 8 from Homebrew ships a config that loads modules the bottle does not
  include, so the service would not start. Commented those lines out.
- `brew services` refuses to start MongoDB from an untrusted tap. Ran the
  existing `mongod` 8.2.9 install directly instead of granting the trust.

Also fixed: multer decodes `originalname` as latin1, which turned every Korean
and Chinese filename into mojibake. Since those are the only filenames this
project will ever see, that was not cosmetic.

React frontend, plain JavaScript and CSS, no TypeScript or Tailwind, matching
the MERN stack in the brief. Dark instrument-panel styling with the subtitles
deliberately kept large and high contrast — the atmosphere is at the edges, the
learner's reading area is plain and legible.

Working end to end: upload → queue → transcribe → player with time-synced
subtitles → click a word → saved with its sentence, timings and alignment
confidence → export as Anki TSV. Content words are underlined and clickable,
function words dimmed, so what is worth saving is visible without instructions.

Two implementation notes worth keeping:

- Subtitle highlighting runs off requestAnimationFrame, not `timeupdate`. The
  latter fires about four times a second, which is visibly late.
- Kiwi's tokens can overlap: 왔 comes back as 오/VV and 았/EP pointing at the
  same character. Rendering token by token printed 오었 where the transcript
  said 왔. Fixed by assigning each character a single owning token, content
  tokens winning ties, so the text renders once and clicking still works.

### Open question 2 — names, seen in the product

Clicking the name 손호준 in a real transcript saved **손호**, not 손호준. Kiwi split
the given name off the surname. So the answer to "does kiwipiepy handle names
sensibly" is: not reliably, and it is visible to the user, not just in the JSON.

Not fixed. Options are a proper-noun merge pass over adjacent NNP tokens, or
letting the user extend a selection. Needs a decision, and a Korean speaker
should look at how often it actually misfires before either is built.

### Both distinguishing features now exist

The brief names two things that separate this from Language Reactor and Migaku.
Both are now built and working.

**Video clips on saved words.** `clips.js` cuts the sentence a word came from
with ffmpeg, on demand at first play rather than upfront — most saved words
never get played, and pre-cutting every sentence of a long video would be waste.
Re-encoded rather than stream-copied: stream copy snaps the cut to the nearest
keyframe, which can be seconds away, and for a one second clip that is the
difference between the right sentence and the wrong one.

Measured: 0.25 s to cut and serve, 168 KB, h264 1080p with aac, 1.2 s for a
0.7 s sentence plus padding. Fast enough that on-demand feels instant.

**Difficulty scoring and the colour strip.** `difficulty.py` scores each segment
0–1 from speech rate (characters per second), rarity of its content words
(wordfreq's zipf scale), and content density. Rarity is weighted highest at 0.50
because it is the factor specific to vocabulary learning. Rarity uses the mean of
the hardest third rather than the mean of everything — one unknown word in an
otherwise easy sentence still sends a learner to a dictionary, and averaging
hides that.

wordfreq wants MeCab to tokenise Korean, which we do not need since kiwi already
did it; pulling the raw frequency table skips the tokeniser entirely.

Output on the interview clip looks right: greetings 0.38–0.41, dense football
sentences 0.72–0.87. The timeline strip interpolates green→red by hue rather
than bucketing, so a long video reads as a gradient. Unscored segments stay
neutral — "not measured" must not look like "easy".

Caveats, because this is a heuristic and not a measurement:

- Nobody has checked that a 0.7 segment is actually harder for a real learner
  than a 0.5 one. That needs learners, not code.
- Names score as maximally hard because they are missing from the frequency
  table. 손호준입니다 scores 0.80, which is arguably wrong — an unknown name is
  not the same problem as unknown vocabulary.
- Dialect divergence is the fourth factor the brief asks for and it is not in
  here, because there is no classifier yet. The weights will need revisiting.

### Open question 2 — name merging, partly fixed

`merge_proper_nouns` joins an NNP to a directly following noun, which fixes the
case found earlier: 손호준 now saves as 손호준 rather than 손호. Contiguity is the
safety net — 한국 사람 has a space so it is left alone, and a particle after a
name is not a noun so it is left alone too. Verified that 박지성 and 김연아, which
kiwi already handled, are unaffected.

Still broken: 이한범 comes back as 이/MM + 한/MM + 범/NNG. There is no proper noun
to anchor to, so no merge rule can save it — that needs real named-entity
recognition. Left open rather than papered over.

### Dictionary lookup

Until now a saved card carried the word, its sentence and a timestamp, and the
learner still had to go find out what it meant — which is most of the work the
app was supposed to remove. Fixed.

Two freely licensed sources, both needing **attribution in the report**:

| language | source | licence | entries |
|---|---|---|---|
| Chinese | CC-CEDICT via MDBG | CC BY-SA 4.0 | 197,765 |
| Korean | Wiktionary via kaikki.org | CC BY-SA 3.0 | 50,474 |

`build_dictionary.py` parses both into a MongoDB `dictionary` collection with a
compound index on (lang, word) — without it every hover is a collection scan
over a quarter of a million rows. The Korean extract is 189 MB so it is streamed
line by line rather than loaded whole; 8 GB does not leave room for carelessness.

Details that mattered:

- Chinese entries are keyed on **both** simplified and traditional. The pipeline
  normalises to simplified, but keeping traditional as an alias means a lookup
  still resolves if normalisation is ever turned off.
- Wiktionary carries "past tense of X" style entries. Those are filtered out:
  the pipeline already lemmatised, so hitting a form-of entry means the lookup
  landed on the wrong key and showing it would hide that.
- Senses are capped at four. Common words carry dozens and a card listing all of
  them teaches nothing.
- Lookup tries the lemma first, then the surface form. The lemma is what a
  dictionary is keyed on, but lemmatising can go wrong, so the surface form is
  worth a second attempt before giving up.

Definitions are copied onto the saved word at save time rather than looked up on
read, so a card keeps the meaning it had when it was made and the Anki export is
self-contained once it leaves the app. The export now has seven columns: lemma,
reading, meaning, sentence, surface form, part of speech, timestamp.

In the UI, hovering a word shows its definition before committing to it —
without that the deck fills with words the learner already knew, and each one
costs a clip. Results cached per lemma for the session, with a 120 ms delay so
sweeping across a sentence does not fire a request per word.

Verified: 공격수 → "attacker, forward", 朋友 → "friend" with pinyin peng2 you5,
경기 → three senses including the province. 손호준 correctly returns nothing,
which is the honest answer for a person's name and is shown as "no dictionary
entry — often a name or a mis-transcription" rather than an empty box.

Loanwords tagged SL still come through as content words, so "FC" is offered as
vocabulary. Harmless but untidy; worth revisiting with the POS filter.

### Still open

- Re-run on the 4090 to confirm the numbers match and get realistic timings.
  No longer a blocker — large-v3 runs here.
- Drama dialogue specifically. Interviews are spontaneous but one speaker at a
  time; overlapping drama dialogue is still untested.
- Accuracy on spontaneous speech. The Commons clips have no reference
  transcripts, so the whole accuracy study is read speech only. Getting even a
  few minutes of hand-corrected transcript for the interview clips would let the
  concentration measurement run on the condition that actually matters.
- Whether the Chinese null result is real or an artefact of jieba's POS tags.
- Whether the Korean lemmas and the error judgements above are correct. Needs
  a human who speaks the language.
- Target Chinese script (simplified or traditional) before writing normalisation.

### State at end of entry

Repo, environment, spike and test-set tooling committed. Pipeline runs end to
end in both languages and writes timestamped lemmatised JSON. No Node, no React.
