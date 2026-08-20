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

### Dialect detection — the text fallback, and why it is limited

Built the fallback the brief specifies for when AI-Hub access fails: markers in
`data/dialect_markers.json` (kept as data so a speaker can correct the lists
without touching code), weighted by how exclusive each is, normalised per 1000
tokens. Covers Gyeongsang, Jeolla and Jeju for Korean; Taiwan, Cantonese-
influenced and Northern for Chinese.

**The first version was useless and validating it is what showed that.** It
counted raw substrings, so the character 노 — a Gyeongsang ending — matched
inside 노력 ("effort"), and every standard Korean interview came back as
Gyeongsang with a score of 14. Rewritten to match over POS-tagged tokens:
endings only count when the tagger labelled them as endings.

That was too strict on its own, because kiwi splits 억수로 into 억수 + 로 so the
marker never appears as one token. Added an eojeol fallback for vocabulary
markers, with prefix matching allowed only from three syllables up — at two,
고마 would swallow 고마워요 ("thank you"), which is ordinary standard Korean.

Validation, both directions:

| input | expected | result |
|---|---|---|
| 3 real Korean interviews | no fire | 0.0, no fire |
| Real Chinese news clip | no fire | 0.0, no fire |
| Constructed Gyeongsang | fire | detected, correct dialect |
| Constructed Jeolla | fire | detected, correct dialect |
| Constructed Jeju | fire | detected, correct dialect |
| 노력 / 고마워요 controls | no fire | 0.0 |

**The limitation that matters, and it is not fixable here.** The 湖口话 clip —
genuinely a dialect recording — is *not* detected, and cannot be. Whisper
transcribed that dialect audio into standard-looking Mandarin characters (方言
became 谎言, the dialect's own name came out as 武后娃 and 五侯瓦). The ASR
normalises regional speech into standard forms, so by the time text reaches this
detector the dialect signal has already been destroyed.

That is worth stating plainly in the report: **text-based dialect detection can
only see dialect that survives transcription.** It works on written-in dialect
and on ASR that preserves regional forms. It cannot recover what the recogniser
has already standardised away. This is an argument *for* the audio-based
approach the brief originally wanted, not merely a shortfall of the fallback.

The UI shows the detection, the markers that triggered it, and the caveat
together — a dialect claim a learner cannot check is worse than none.

### Tests

52 tests with pytest, covering lemmatising, proper-noun merging, word-timing
attachment, dialect detection and the evaluation aligner. There were none before
this, which for a capstone is a gap regardless of whether the code works.

They are written around cases that were actually wrong at some point, so a
failure means a real regression: the 손호 name split, the 노력 false positive,
Chinese words arriving per character, overlapping tokens on one character,
aligner indices needed for error attribution.

**One caught a live bug immediately.** `annotate_segments` had not received the
eojeol fix that `scan` did, so a video could report "Gyeongsang detected" at the
top while no individual line was marked. Fixed.

### PWA

Manifest, service worker and icons added — the brief lists "installable as a
PWA" as a deliverable. The worker is deliberately conservative: cache-first for
the app shell, network-only for everything else. Caching API responses would
mean a "processing" status frozen forever, and caching video would fill the
user's quota with files watched once. Offline transcription is impossible
anyway; the work happens on a server.

**Not verified installable.** All the assets serve correctly over HTTP (manifest
200 with the right content type, sw.js 200, three icons 200), but service worker
registration fails inside the embedded browser used for testing with "unknown
error occurred when fetching the script". That looks like a restriction of that
browser rather than a fault in the code, but it is unproven either way — check
it in real Chrome or Safari before claiming the deliverable.

### Dual English subtitles

The last week-6 deliverable. Two ways to get English, and the choice mattered
more than it looked:

1. **Whisper's own translate task.** Better English, but it re-segments the audio
   independently, so its lines do not correspond to the native lines. For a dual
   track that is the wrong shape — you would be matching two segmentations by
   time overlap and putting partial sentences under each other. It also roughly
   doubles transcription time.
2. **A translation model over the segments that already exist.** Exactly one
   English line per native line, which is what a dual track needs.

Went with 2, using Marian (opus-mt), about 300 MB per language pair, a second or
two on CPU for a short clip.

The trade-off is real and worth stating: Marian's English is rougher than
Whisper's, especially from Korean. It is a reading aid for someone who has the
original in front of them, not a translation to quote. Comparing the two
properly would be a reasonable thing to measure later.

Sample output on the interview clip, showing both the quality and its limits:

| Korean | English |
|---|---|
| 안녕하세요. | Hello. |
| 손호준입니다. | It's Sonho Joon. |
| 저는 왼쪽 공격수를 맡고 있고… | I'm on the left-hand side of the attack, and I've got the advantage of… |

Note the second line: the name is transliterated rather than kept, and the
fourth segment translates 짠할, which is itself a mis-transcription. **Translation
inherits every ASR error upstream of it** and presents it in confident English,
which is arguably more misleading than the original Korean was.

Implementation notes: translation failure is caught and the transcript continues
without it, because English is an addition and the transcript is the product.
Empty segments are held out of the batch — Marian emits garbage for empty input
rather than nothing. In the UI the English is deliberately smaller and dimmer
than the target language, with a toggle: if the crutch reads as loudly as the
original, the eye goes there first and no learning happens. The sentence
translation also lands on saved cards and in the Anki export.

### Turkish, actually finished

Turkish had been *plumbed in* — tokeniser, dictionary, interface strings, code
paths accepting `tr` — but no Turkish audio had ever been through the pipeline,
there was no test set, the alignment model had never been loaded, and
`dialect_markers.json` contained only `ko` and `zh`. Claiming it was done would
have been wrong. Now measured:

| lang | model | CER | content err | function err | concentration |
|---|---|---|---|---|---|
| tr | small | 0.034 | 0.119 | 0.154 | 0.95 |
| tr | large-v3 | **0.014** | 0.046 | 0.091 | 0.83 |

**Turkish is the most accurately transcribed of the three languages** — CER
0.014 at large-v3 against 0.026 for Chinese and 0.067 for Korean. Coverage is
100% and the wav2vec2 Turkish aligner works, so clips cut correctly.

Dialect markers added for Kıbrıs, Karadeniz, Ege and Doğu. Validated in both
directions: all four fire on constructed samples, standard Turkish stays at 0.0.
The Kıbrıs list is the one worth checking first — it is the variety spoken where
this project is being written and the author can judge it directly.

### Two real bugs Turkish exposed

**The evaluation harness could not handle a space-delimited language.**
`normalise()` stripped all whitespace, which is right for Korean and Chinese —
Whisper's spacing differs from the reference constantly and neither tokeniser
depends on it — but for Turkish the space *is* the word boundary. The whole
transcript collapsed into one token, and the first Turkish run reported a token
error rate of 0.79 against a character error rate of 0.035, which is impossible
and was the clue. Normalisation is language-aware now.

Worth noting for the report: this bug could only ever appear when a third
language was added. Two languages that both ignore spaces hid it completely.

**Turkish lemmas were being picked by parse order.** zeyrek returns every
reading it can construct, and çözümü parses both as çöz + üm ("my çöz") and
çözüm + ü ("the solution"). Taking the first gave çöz, which is not a word
anyone would put on a card. Now the most frequent lemma wins, using the wordfreq
table already loaded for difficulty scoring. çözümü → çözüm.

Also silenced zeyrek's parse logging, which it emits at WARNING level, so the
worker output was unreadable.

### The concentration finding, with three languages

| language | concentration at large-v3 |
|---|---|
| Korean | **1.58** |
| Chinese | 0.96 |
| Turkish | 0.83 |

Korean is the outlier, not the rule. That sharpens the result but it also
introduces a caveat that has to go in the report:

**The content/function split is not comparable across these languages, because
the tokenisers cut at different granularity.** Korean has 326 content against
362 function tokens because kiwi splits particles and endings into separate
tokens. Turkish has 281 content against 77 function, because zeyrek fuses
suffixes into the word they attach to. So Turkish "function words" are a much
smaller and different category than Korean ones, and a ratio computed over them
is not measuring the same thing.

The Korean result stands on its own — within Korean, errors do favour content
words at every model size. What cannot be claimed from this table is that Korean
is *more* prone to it than Turkish, because the denominators differ. Fixing that
properly needs a tokenisation-independent unit, which is its own piece of work.

### Related work — what other projects actually do

Went looking for prior art rather than continuing to argue from first
principles about the streaming problem. The most relevant find by a distance:

**asbplayer** (github.com/asbplayer/asbplayer, ~1,400 stars, actively
developed) — "browser-based media player and Chrome extension for subtitle
sentence mining". That is the same use case as this project's streaming half:
watch something, mine words with their sentence, export to Anki.

What matters is its architecture, because it answers a question that had been
going in circles here. Its repository contains `client/` and `extension/` and
**no desktop or Electron directory at all**. A project that has been solving
exactly this problem for years, with a real user base, chose a web client plus
a browser extension.

It also does *both* of the routes built here, which is a useful independent
confirmation that neither was a wrong turn:

| asbplayer | here |
|---|---|
| auto-detects subtitles on Netflix and YouTube | extension reads the platform's subtitle track |
| drag a subtitle file onto a streaming video | subtitle companion |
| subtitle timing adjustment | sync offset control |
| mine to Anki via AnkiConnect | Anki TSV export |

Others in the space: **dual-captions** (240 stars, archived 2022),
**MouseTooltipTranslator** (1,300 stars), and several small Netflix dual-subtitle
extensions. All browser extensions. **Metastream** (2,600 stars) is the one
Electron project nearby — watch-together rather than language learning — and its
Widevine issue is closed without Netflix working.

Nobody ships a desktop app that plays Netflix. That is worth stating in the
report's related-work section, because "why is this a browser extension" is an
obvious question from an examiner and the answer is now evidenced rather than
asserted.

One technique worth stealing: asbplayer *auto-detects* subtitles on Netflix
rather than scraping the rendered DOM. Intercepting the subtitle payload the
player fetches would be far more robust than the CSS selectors used here, which
break whenever a platform changes its markup. Not built yet; noted as the next
improvement to the extension.

### Netflix in a desktop shell — tested, not concluded

Built a minimal castlabs Electron shell (`desktop/`) to test the claim directly,
after asserting four times from a single StackOverflow answer that it could not
work. That was not good enough, and the test contradicted part of it:

- Widevine CDM loads fine — version 4.10.3050.0, status `updated`
- netflix.com loads and redirects to its login page exactly as in Chrome
- no M7xxx error at any point

The remaining unknown is playback after login, which is where Netflix asks for a
licence and where the reported errors appear. That needs a real account, so it
is for the author to run, not for me.

Correction worth recording: the earlier claim that castlabs requires a paid
signing certificate is out of date — it is free now, with self-signing through
their portal. The claim that Rave holds a Netflix partnership rests on one
StackOverflow answer citing a LinkedIn profile, and should be treated as
unverified rather than fact.

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

---

## 2026-08-21 — quality pass

Went looking for what was actually wrong rather than adding features. Six
things, of which two were teaching the learner incorrect material.

### Words that could not be clicked

Reported as "some words are not clickable", and it was a real gap in the
part-of-speech filter rather than anything subtle. Pronouns, determiners,
numerals and classifiers were all excluded, which meant these were unclickable:

| language | words |
|---|---|
| Korean | 저 (I), 이것 (this), 그 (that) |
| Chinese | 我们 (we), 他 (he), 一起 (together), 五个 |

Among the first words anyone learns. The filter now includes NP and MM for
Korean, and r, m and q for Chinese, on the test of whether a learner would put
it on a flashcard. Erring wide is the right direction: an extra clickable word
costs a glance, a missing one leaves the learner unable to save something with
no way to tell why.

SL stays excluded — Latin tokens like "FC" and "AI" are not Korean vocabulary.

### Dictionary sense ordering, and an approach that did not work

The app takes `senses[0]` in the deck, the quiz, the word panel and the Anki
export, which makes sense ordering a correctness problem:

    시장  ->  hunger, market, mayor     (it means market)
    行    ->  row; line, trade, firm    (it means to walk / OK)

Wiktionary orders by etymology, CC-CEDICT by whatever was written first.
Neither is ordered by what a learner is likely to meet.

**The first attempt was wrong and is worth recording.** It scored glosses on
length and specialist labels to guess the everyday meaning. The dry run showed
it never fixed 시장 — nothing in the text distinguishes "hunger" from "market" —
while it *did* break 会 by promoting "meeting" over "can, to know how to", and
turned UP主 into "pronounced [a4 pu5 zhu3]". A reranker that makes things worse
than leaving them alone is not worth running.

Ranking real meanings needs per-sense frequency data, which does not exist
openly for these languages. So the version that shipped only demotes glosses
that are provably not meanings at all — pronunciation notes, cross-references,
form-of entries. That reordered 1,879 of 290,081 entries and changed nothing it
could not justify.

For the rest, the fix is presentational: the deck, the level list and quiz
answers now show the **first two** senses rather than one, so a wrong first
sense is no longer the only thing the learner sees. 시장 still leads with
"hunger" and that is still wrong; it is now followed immediately by "market".

### A worker that died silently

The transcription worker was stopping seconds after start. Uploads would have
queued forever with nothing shown — the API stayed up and the UI looked normal.

`nohup` and `disown` were not enough. Adding the signal name to the shutdown
log gave the answer immediately: **shutting down on SIGTERM**. Both leave the
process in the launching shell's process group, and when that shell goes the
whole group is signalled. The worker now calls `os.setsid()` at startup so it
owns its session and cannot be killed by the terminal that started it.

**The health check for it was also wrong, in the worse direction.** Asking
BullMQ `getWorkers()` returned zero while the worker was happily processing
jobs, because the Python client does not register the way the Node one does. A
confident false negative would have put a "worker is down" banner in front of
someone whose system was fine. Replaced with a heartbeat the worker writes
itself, with a TTL, which is unambiguous. The UI now warns only when it is
genuinely down, and says how many jobs are waiting.

### Tests where the bugs actually were

There were 62 Python tests and **zero** for the API or the frontend — while
every bug found by hand this project has lived in the API layer: multer
decoding Korean filenames as latin1, a tokeniser spawning a process per
request, a subtitle cache keyed without its language, the liveness check above.

Added 22 API tests covering tokenising, script detection, readings, the
dictionary, translation and its cache, saved-word occurrences, and quiz
construction. They run against a live API and database on purpose: the bugs
were in the seams between Node, Python and Mongo, and mocking those away would
have hidden every one of them.

`./test.sh` runs both suites. 84 tests, all passing.

### Still open after this pass

- **Korean readings fragment on verbs.** 도왔던 renders as 돕 · 었 · 던 with a
  reading only on the stem, because tokenising is per morpheme. Accurate per
  token, odd to read. Fixing it means grouping a stem with its endings for
  display, which is a rendering change rather than a data one.
- **시장 still leads with "hunger".** Only fixable with sense-frequency data.
- **Viki and iQIYI selectors are still guesses** and have never run against
  those sites.
- **No frontend tests.** The React layer has had its share of bugs too — the
  ruby overlap, a prop name colliding with a state variable.

### Korean irregular verbs were invisible

Chasing the fragmented readings turned up something worse underneath. Kiwi tags
irregular predicates **`VV-I`** and **`VA-I`**, not `VV` and `VA`. Every tag
check in the project matched the plain forms, so the whole ㅂ/ㄷ/ㅅ-irregular
class — 돕다, 듣다, 짓다, 곱다 and many more — was:

- not clickable, so it could not be saved
- never given its 다 dictionary form
- never merged with its endings

Regular verbs worked throughout, which is exactly why it stayed hidden: 예뻤어요
behaved and 도왔던 did not, and nothing connected the two. Tags are now
normalised by stripping the suffix before any comparison.

| written | before | after |
|---|---|---|
| 도왔던 | 돕 · 었 · 던, no lemma | 도왔던 → 돕다 |
| 들었어요 | 듣 · 었 · 어요, no lemma | 들었어요 → 듣다 |
| 지었다 | 짓 · 었 · 다, no lemma | 지었다 → 짓다 |

### Verbs are one word again

Kiwi returns morphemes, so a predicate arrived split and the romanisation read
as fragments — "meok" hovering over 먹 with 었어요 beside it unannotated. A verb
and its endings now merge into a single token.

The merged surface comes from the **original text span**, never from joining the
morphemes: 도왔던 is a contraction of 돕 + 았 + 던, and concatenating would produce
돕았던, which is not what is on screen and would break the character offsets word
timings depend on. A test asserts exactly that.

Particles are deliberately left alone. An ending belongs to the verb; 을 in 밥을
is a separate word, and merging it would bury 밥 inside a token that is not a
vocabulary item.

Verified in stored data after re-transcribing: 큰 → 크다 (keun), 없었기 → 없다
(eopsseotkki), 비쌌다 → 비싸다 (bissattta).

### A process lesson

The first re-transcription after the fix still produced the old output. The
worker caches loaded modules for the life of the process, so source changes do
nothing until it restarts — and the tests passed the whole time, because they
import the module directly. Worth remembering before concluding a fix did not
work.
