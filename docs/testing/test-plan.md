# Test Plan: Saved Words feature

## 1. System under test

**App:** Dialect-Aware Vocabulary Learning from Video (my capstone app). You watch a video with AI subtitles, click a word you don't know, and it's saved as a card with the sentence and a clip of that moment. Cards can be exported to Anki.

**Feature tested:** the **Saved Words** part of the Node.js API, plus the video upload that feeds it.

| Endpoint | What it does |
|---|---|
| `POST /api/words` | Save a word clicked in a transcript |
| `POST /api/words/external` | Save a word from Netflix/streaming (no video, only subtitle text) |
| `POST /api/words/unsave` | Remove one occurrence, or the whole card if it was the last |
| `GET /api/words` | List saved cards |
| `DELETE /api/words/:id` | Delete a card |
| `GET /api/words/export` | Export cards as an Anki TSV file |
| `POST /api/videos` | Upload a video and queue it for transcription |

**Out of scope:** the Whisper transcription itself (needs a GPU), the browser extension, and the visual design of the UI.

## 2. Risk analysis

Likelihood and impact are rated Low / Medium / High.

| # | Risk | Likelihood | Impact | Priority | Covered by |
|---|---|---|---|---|---|
| R1 | A saved card has the wrong sentence or timing, so the clip shows the wrong moment | Medium | High | **High** | TC01, M1 (manual) |
| R2 | The same word creates duplicate cards instead of one card with several clips | Medium | Medium | Medium | TC04, TC05 |
| R3 | Unsaving deletes the whole card instead of one occurrence, so the user loses clips | Medium | High | **High** | TC07, TC08, TC15 |
| R4 | Bad input (wrong index, missing fields, unknown IDs) creates broken data | Medium | Medium | Medium | TC02, TC03, TC06 |
| R5 | One bad request crashes the whole API, so the app goes blank | Medium | High | **High** | TC11, TC13, TC14 |
| R6 | Someone sends a database operator instead of a word and deletes cards (NoSQL injection) | Low | High | **High** | TC12 |
| R7 | Anki export breaks when a sentence contains tabs or line breaks | Medium | Medium | Medium | TC09 |
| R8 | Videos in unsupported languages get queued and waste GPU time | Low | Medium | Low | TC10 |
| R9 | The dictionary meaning on a card is wrong for the context | High | Medium | Medium | M2 (manual) |
| R10 | Refused uploads stay on disk and slowly fill it (up to 2 GB each) | Medium | Medium | Medium | TC16 |
| R11 | Any website the user visits can read or delete their words through localhost (open CORS, no login) | Medium | High | **High** | TC17 |
| R12 | Someone on the same Wi-Fi opens the API, watches the user's uploaded videos and deletes their words | Medium | High | **High** | TC18 |
| R13 | An uploaded file is used to read other files on the computer (path traversal) | Low | High | Medium | TC19 |
| R14 | An uploaded .html file runs as a web page on the app's own address and takes over the API (stored XSS) | Low | High | **High** | TC20 |
| R15 | The streaming login (cookies in `.chrome-profile`) gets committed or shared with the project | Medium | High | **High** | TC21, M4 |

## 3. Quality criteria

**Functional (does it do the job?)**

- F1. A word saved from a transcript stores the exact sentence, translation and timings from the transcript, not from the client.
- F2. One word = one card per language. A new sentence adds an occurrence; repeating the same click adds nothing.
- F3. Unsaving removes only the chosen occurrence. The card is deleted only when no occurrences are left.
- F4. Invalid input gets a clear 4xx error and creates no data.
- F5. Every Anki export row has exactly 7 columns.

**Non-functional (how well does it do it?)**

- N1. **Reliability:** a malformed request must never stop the server. Other requests keep working.
- N2. **Security:** user input is treated as data, never as a database query. Only the app's own pages may call the API from a browser.
- N5. **Resources:** a refused request leaves nothing behind on disk.
- N3. **Isolation:** tests use their own database (`dialect_vocab_test`) and never touch real saved words.
- N4. **Automation:** all automated tests run on every push through GitHub Actions.

## 4. Test design techniques used

- **Equivalence partitioning (EP):** split inputs into groups that should behave the same (e.g. supported language / unsupported language / no file).
- **Boundary value analysis (BVA):** test right at the edges (token index 2 = last valid, 3 = one past, -1 = below).
- **Decision table:** combinations of required fields (language and lemma, each present or missing).
- **State transition:** a card moves through states (none → 1 occurrence → 2 occurrences → 1 → deleted).
- **Error guessing:** inputs a developer often forgets (malformed IDs, injected operators, tabs in text).

## 5. Test cases

Segment used in tests: `저는 사람을 만났어요` (start 10s, end 14s) with 3 tokens: `저` (0), `사람` (1), `만나다` (2).

| ID | Title | Technique | Steps / input | Expected result | Type |
|---|---|---|---|---|---|
| TC01 | Save word from transcript | Use case | POST `/api/words` with tokenIndex 1 | 201; lemma `사람`; sentence, translation, start=11, sentence 10–14, confidence 0.9 | Auto |
| TC02 | Unknown segment | EP (invalid) | POST `/api/words` with a random segmentId | 404, no card created | Auto |
| TC03 | Token index boundaries | BVA | tokenIndex 2, 3, -1 | 2 → 201; 3 → 400; -1 → 400 | Auto |
| TC04 | Same word, new sentence | State transition | Save lemma with sentence A, then sentence B | One card, 2 occurrences | Auto |
| TC05 | Double click | State / error guessing | Save same lemma + sentence B again | Still 2 occurrences | Auto |
| TC06 | Required fields | Decision table | external save: no lemma / no language / both | 400 / 400 / 201 | Auto |
| TC07 | Unsave one of two | State transition | Card with A and B, unsave B | removed=true, remaining=1 | Auto |
| TC08 | Unsave last one | State transition | Unsave A | deleted=true, card gone from list | Auto |
| TC09 | Anki export with tabs/newlines | EP (special chars) | Save sentence with `\t` and `\n`, export | 7 columns, sentence becomes one line | Auto |
| TC10 | Upload language | EP | Upload with no file / `de` / `ko` | 400 / 400 / 201 queued | Auto |
| TC11 | Malformed ID | Error guessing | DELETE `/api/words/abc`, GET `/api/videos/abc` | 400 or 404, server still running | Auto |
| TC12 | NoSQL injection | Security / error guessing | unsave with `lemma: {"$ne": null}` | No card deleted | Auto (security check) |
| TC13 | Dictionary with non-text word | Error guessing | GET `/api/dictionary?lang=ko&word[x]=1` | 400, server still running | Auto |
| TC14 | Word list with malformed videoId | Error guessing | GET `/api/words?videoId=abc` | 200 or 400, server still running | Auto |
| TC15 | Unsave without saying which one | Decision table | unsave with only language + lemma | 400, card keeps both occurrences | Auto |
| TC16 | Refused upload cleanup | Error guessing | Upload with language `de` | 400, file deleted from uploads folder | Auto |
| TC17 | Other websites blocked | Security | GET `/api/words` with `Origin: https://evil.example` | No `Access-Control-Allow-Origin` for that site | Auto (security check) |
| TC18 | Not reachable from other devices | Security | Call the API on the computer's network IP instead of localhost | Connection refused | Auto (security check) |
| TC19 | Path traversal on /media | Security | GET `/media/..%2f..%2fpackage.json` and `.env` | 400/403/404 | Auto (security check) |
| TC20 | Upload a web page | Security | Upload `evil.html` as a video | 400; never served as `text/html` | Auto (security check) |
| TC21 | Login cookies never in git | Security | Check `.chrome-profile` is ignored and absent from all commits | Ignored, no commits | Auto (security check) |
| M1 | Clip shows the right moment | Exploratory | Save a word from a real video, play the clip | Clip starts just before the sentence and contains the word | Manual |
| M2 | Meaning fits the context | Exploratory | Save a word with several meanings (e.g. `배`: boat / pear / belly) | First meaning shown matches the scene | Manual |
| M3 | Save from Netflix | Exploratory | Click a word in the Netflix overlay | Card appears with sentence, marked as having no clip | Manual |
| M4 | App never sees the streaming password | Code review | Read extension permissions and content script, and the desktop app's window settings; log in to Netflix and watch the API log | Login happens only on netflix.com; extension only reads subtitle text; nothing login-related reaches the API | Manual |

**21 automated, 4 manual.** The manual ones need a human to judge whether the result is *right*, not just whether it exists.

## 6. Security checks (TC12, TC17–TC21)

**TC12, NoSQL injection.** `POST /api/words/unsave` takes `lemma` from the request body and puts it straight into a MongoDB query. If an attacker sends `{"$ne": null}` instead of a word, MongoDB reads it as "any word that is not null" and the server deletes the first card it finds. TC12 sends exactly this and checks that the number of cards stays the same.

**TC17, open CORS.** The API has no login and runs on `localhost`. It uses `cors()` with no options, which tells browsers that *every* website may call it. So a random page the user visits could read or delete their saved words in the background. TC17 sends a request as if from `https://evil.example` and checks it is not allowed.

**TC18, open to the whole network.** `app.listen(port)` with no address listens on every network interface, not just `localhost`. On shared Wi-Fi (dorm, café, campus), anyone can open `http://<your-ip>:4000/api/videos` to see your uploads, watch them through `/media/<filename>`, and delete your words. TC18 calls the API on the computer's network IP and expects the connection to be refused.

**TC19, path traversal.** Checks that `/media/../..` cannot read files outside the uploads folder, such as `.env`. This one is expected to pass, because `express.static` already blocks it. It stays as a guard.

**TC20, uploading a web page.** Uploads keep their file extension, and the server accepts any file type. An uploaded `evil.html` would open as a real page on `localhost:4000`, the app's own address, so its script could read and delete everything. TC20 uploads one and expects it to be refused.

**TC21 + M4, the streaming login.** The app never asks for the Netflix password: the user logs in on netflix.com in real Chrome, the extension only has access to the streaming sites and localhost, and it only sends the word, sentence and page URL. But the login cookies are stored in `.chrome-profile` inside the project folder. TC21 checks it is git-ignored and was never committed. M4 is a manual code review, because "this code never touches the password" cannot be proven by a test that only tries a few inputs.

**What we did not test:** MongoDB and Redis themselves. On this Mac they come from Homebrew, which binds them to `127.0.0.1` by default, so they are not exposed to the network.

## 7. How to run

Locally (MongoDB and Redis must be running, e.g. via `./run.sh`):

```bash
cd api
node --test test/words.test.js
```

In CI: `.github/workflows/tests.yml` runs on every push. It starts MongoDB and Redis in containers, runs these tests, uploads a JUnit report (`api-test-report`), and also runs the existing frontend tests.

## 8. Results

The workflow went red, red, then green: 9 bugs were found and fixed, and the final run passes 28 of 28 checks.

| CI run | Result | What happened |
|---|---|---|
| #1 Adding Testing | Failed | The API crashed at startup on GitHub's clean machine: the Python tokeniser (`ml/.venv`) was missing and its spawn error had no handler. Found by CI itself. |
| #2 Handle missing Python tokeniser | 18 passed, 10 failed | The server started. The 10 failures were 8 more real bugs (TC11 has 2 checks). |
| #3 Fixing bugs found by tests | 28 passed, 0 failed | All bugs fixed. |

### Bugs found and fixed

| # | Bug | Found by | Fix |
|---|---|---|---|
| 0 | API crashed when Python was missing | CI run #1 | `error` handler on the tokeniser process (`api/src/tokeniser.js`) |
| 1 | Malformed ID crashed the server (Express 4 does not catch errors in async routes) | TC11, TC14 | `router.param` checks `isValidObjectId` and returns 400 |
| 2 | Opening `?word[x]=1` crashed the server | TC13 | Dictionary route accepts text only |
| 3 | NoSQL injection deleted cards | TC12 | `language` and `lemma` must be plain text |
| 4 | Unsave with no occurrence named deleted the whole card | TC15 | Requires `segmentId` or `sentence` |
| 5 | Refused uploads stayed on disk | TC16 | File deleted before the 400 response |
| 6 | Open CORS | TC17 | Origin allow-list (own app, extension, 5 streaming sites) |
| 7 | API reachable from the whole network | TC18 | Listens on `127.0.0.1` (override with `HOST`) |
| 8 | HTML accepted as a video and served as a web page | TC20 | Upload allow-list of video and audio extensions |

TC19 (path traversal) and TC21 (login cookies in git) passed from the first run and stay as regression guards.

### Manual test results

| ID | Result | Notes |
|---|---|---|
| M1 | Passed | In Chrome the clip starts just before the sentence and the word is clearly audible. In VS Code's built-in browser it played silently, because that browser cannot play AAC audio; the file itself has audio (mean volume -24.4 dB). |
| M2 | Failed (AI output) | In the 0:47 line, 발 (step) was translated as "shot" and 성적 (results) as "grades"; speech recognition probably heard 받게 instead of 밟게. |
| M3 | Not run | Needs a real Netflix account in real Chrome. |
| M4 | Passed (code review) | Login happens only on netflix.com; the extension only reads subtitle text and sends the word, sentence and page URL. |
| M5 | Failed (open bug) | Found during exploratory testing: choosing a new subtitle language in the player does not change the translations on screen. |

**Open bug (M5).** When a new subtitle language is picked, the player asks the API to translate the whole transcript. The old translations stay on screen until the new ones arrive, with only a small "translating…" label, and a first-time language can take up to 120 s. If the request fails or times out, the error is silently ignored (`.catch(() => {})` in `web/src/components/Player.jsx`), so the old language stays with no message. Likely cause, not yet confirmed. Proposed fix: clear the old translations when the language changes, and show an error when translation fails. Not fixed here, because it is outside the tested API feature.

### Evidence

- Test reports (JUnit XML): the `api-test-report` artifact of runs #2 (before) and #3 (after) in GitHub Actions.
- Full write-up and reflection: the technical report submitted with this repository.
