# LEARNING.md — a guided tour of the Clickster rebuild

This branch is the rebuild branch (`claude/modernize-clicky-game`) plus this
one file. It exists so you can learn the stack and the AI patterns from a
codebase you own, file by file. Nothing here is merged into the game branch.

---

## 1. The stack, layer by layer (and where each layer lives)

| Layer | What it does | Files |
| --- | --- | --- |
| **Game rules (pure)** | Every rule of the game as pure functions over an explicit state. No I/O, no clock, no randomness except a seeded RNG passed in. This is what makes everything else testable. | `src/lib/engine.ts`, `src/lib/rng.ts` |
| **Content** | Built-in decks, the daily pool, demo decks, and the original generated card art (deterministic SVG "critters" from a seed string). | `src/lib/decks.ts`, `src/lib/art.ts` |
| **Client state** | Profile in `localStorage`: best scores, run history, achievements — and pure stats computed over that history. | `src/lib/client/profile.ts`, `src/lib/client/stats.ts` |
| **UI** | Svelte 5 (runes) components + the page that orchestrates a run: modes, timer, host calls, settling finished runs into the profile. | `src/routes/+page.svelte`, `src/lib/components/*.svelte` |
| **HTTP API** | Three small endpoints: host comments, the curator stream (SSE), the leaderboard. | `src/routes/api/comment/+server.ts`, `.../curate/+server.ts`, `.../leaderboard/+server.ts` |
| **Server services** | The AI pieces and storage, framework-free and unit-testable. | `src/lib/server/curator.ts`, `jev.ts`, `host.ts`, `leaderboard.ts` |
| **Runtime plumbing** | Reading env vars the same way in Workers and Node; a `fetch` wrapper that survives the Workers runtime (see §6). | `src/lib/server/env.ts`, `src/lib/server/fetch.ts` |
| **Platform** | SvelteKit 3 + the Cloudflare adapter → one Worker. `wrangler.toml` names it; `worker-configuration.d.ts` is the generated type surface of the Workers runtime. | `vite.config.ts`, `wrangler.toml`, `src/app.d.ts` |
| **Quality gates** | Biome (lint/format), svelte-check (types), Vitest (unit), Playwright (e2e against the real Workers build), Knip (dead code), frozen `bun.lock`. | `biome.json`, `knip.json`, `vitest.config.ts`, `playwright.config.ts`, `.github/workflows/ci.yml` (owner adds this file — see the PR) |

One idea runs through the whole design: **determinism where it matters.**
The shuffle after click *n* is `shuffledOrder(order, runSeed, n)`
(`src/lib/engine.ts`) — a pure function of the run's seed and the click
count. The Daily Challenge is just `dailyDeck(pool, dateString)`: same
date string, same deck, for everyone. Tests exploit this everywhere: they
inject fixed dates and seeds, so no test can fail because of what day it
is. (A date-dependent test that only fails on some calendar days is a bug
in the test, not the code.)

---

## 2. The AI concepts, one by one

Each concept is given as: **the problem here → how it's wired in this
codebase → the underlying principle.**

### 2.1 The agent tool loop

- **Problem:** "build a deck about deep sea animals" is not one API call.
  You must search, check each result (right license? image loads? seen it
  already? actually on-theme?), and if too few survive, search *again,
  differently* — the next action depends on what the last one returned.
- **Wiring:** `src/lib/server/curator.ts`. Three tools with typed inputs
  and outputs — `ImageSource.search()` (the search tool),
  `Validator.validate()` (the validation tool), and deck assembly. The
  loop in `curateDeck()` decides: search → validate → if short, broaden
  the query (`broadenQuery()`: theme → theme + "animal" → strongest word)
  and loop, bounded at 3 searches. Every step is yielded as a
  `CurateEvent`, which the route streams and `CuratorPanel.svelte` renders
  as a step list.
- **Principle:** an agent is a *decide → act → observe* cycle around
  tools, with the loop's control flow driven by tool results — not a
  single prompt. The tools here are plain functions; the "intelligence"
  of the loop is mostly in its retry/broaden policy and its stopping
  conditions. Keep loops bounded and make every step observable.

### 2.2 Adapters and the honest demo fallback

- **Problem:** the game should use real services when they're configured
  (Openverse, Gemini, Upstash Redis, Jev) and still be a complete,
  playable demo with zero keys — without ever *pretending* the demo path
  is the real thing.
- **Wiring:** every external capability sits behind an interface with
  multiple implementations, selected from env vars in one place:
  `ImageSource` (Openverse), `HostAdapter` (Gemini / OpenAI-compatible /
  scripted — `getHost()` in `src/lib/server/host.ts`), `LeaderboardStore`
  (Upstash / in-memory — `getLeaderboard()` in `leaderboard.ts`), and the
  Jev clients in `jev.ts`. Fallbacks are *labelled in the data itself*:
  decks carry `source: 'openverse' | 'demo'`, comment responses carry
  `adapter: 'demo'`, leaderboard responses name the store, judge summaries
  carry `kind: 'typesafe' | 'demo'`. The UI prints those labels
  ("demo host (scripted)", "Jev demo judge").
- **Principle:** the adapter pattern decouples *what the app needs* from
  *which provider supplies it*, and honest labelling is a data problem,
  not a copy problem — if the provenance travels with the value, no UI
  can accidentally oversell it. Corollary used throughout: **partial
  configuration degrades to demo, never to broken** (e.g. the leaderboard
  needs *both* Upstash vars or it uses memory).

### 2.3 Streaming (SSE) — where it fits, and where it doesn't

- **Problem:** curation takes seconds and has meaningful intermediate
  steps; a host comment is a single short sentence after a discrete
  event.
- **Wiring:** the curator endpoint (`src/routes/api/curate/+server.ts`)
  is a Server-Sent Events stream of `CurateEvent` JSON — progress is the
  product. The host endpoint is plain request/response
  (`src/routes/api/comment/+server.ts`) — holding a stream open for a
  one-liner buys nothing.
- **Principle:** choose the transport from the *shape of the work*:
  multi-step/long-running → stream progress; single small result →
  request/response. Streaming is a UX tool, not a default.

### 2.4 Prompt and guard design

- **Problem:** themes, player names, and model output are all untrusted
  text. A theme becomes a search query and page text; a model line
  becomes page text; a leaderboard name becomes other players' page text.
- **Wiring:** `sanitizeTheme()` (curator.ts) strips markup characters and
  caps length *before* anything else touches the theme;
  `parseScoreSubmission()` (leaderboard.ts) strips `<>&"'` from names,
  validates score/mode/date; `sanitizeLine()` (host.ts) strips tags and
  caps model output at 140 chars. Model *instructions* are constants in
  code (e.g. `SYSTEM_PROMPT` in host.ts); the only variable parts are
  structured game state, never raw user text concatenated into a prompt.
  Where a decision matters, the guard is a **number in code, not words in
  a prompt**: the Jev acceptance bar is `JEV_ACCEPT_THRESHOLD = 0.7`.
- **Principle:** treat every string that crosses a trust boundary as
  hostile until sanitized; put policy in code constants you can test,
  and keep prompts boring and structured.

### 2.5 Jev: judgment models (System 1) vs text models (System 2)

This is the newest pattern in the codebase, and the one most worth
internalizing.

- **The distinction.** A text LLM (System 2) *generates* — you coerce it
  into decisions by asking for prose and parsing it back. Jev by TypeSafe
  is a **System One judgment model**: it generates nothing. You send a
  `state` (string or object) plus **typed questions**, and you get back
  typed answers with **calibrated probabilities** your code can branch
  on directly. No parsing, no "the model said something like…".
- **The three primitives** (docs.typesafe.ai; client in
  `src/lib/server/jev.ts`, one POST to `/v1/systemone`, Bearer key):
  - **Noul** — "is this statement true?" → `{ noul: 0..1 }`, the
    probability of yes. (The name is a null/bool pun.)
  - **Choice** — "which of these options?" → `{ choice, probabilities,
    confidence }`, a distribution over *your* options only.
  - **Score** — "where on this rubric?" → `{ score, probabilities,
    confidence }`, a position along levels *you* define.
  Questions in one request share the state and evaluate in parallel, so
  asking three questions costs about the same as asking one.
- **Where each is wired here:**
  - *Curator gate* (`createCandidateJudge` + `jevGate` in curator.ts):
    per candidate, one request asks Noul relevance ("is `title` actually
    about `theme`?"), Noul appropriateness ("appropriate for a
    family-friendly game?"), and a fit Choice
    (`perfect-fit` / `usable` / `off-theme`). Acceptance is arithmetic in
    code: both Nouls ≥ 0.70 and fit ≠ off-theme. When the judgments feel
    wrong, you tune the constant or the question — there's no prompt to
    plead with.
  - *Host judgment* (`judgeHostMoment` in host.ts): Jev never writes the
    host's line. It makes a tone **Choice** (teasing / encouraging /
    dramatic) and a drama **Score** over a 3-level rubric; the *voice*
    (scripted bank or text model) then speaks in that tone. Judgment and
    generation are separate layers with separate fallbacks: Jev down →
    demo judge (voice unaffected); voice down → scripted voice (judgment
    unaffected).
  - *Demo judge* (`DemoJev` in jev.ts): with no `TYPESAFE_API_KEY`, a
    deterministic keyword heuristic implements the same client interface
    so the whole pipeline still runs — labelled `demo` in every response.
    `judgeWithFallback()` is the single choke point: real model first,
    demo on any failure, and the result always names which judge answered.
- **Principle:** when code needs a *decision*, ask for a decision-shaped
  answer (a probability, a choice, a rubric position) instead of
  generating text and reverse-engineering one. Calibrated probabilities
  turn "the AI thinks this is fine" into an explicit, testable threshold.

---

## 3. The Redis leaderboard

**Why sorted sets.** A leaderboard *is* a sorted set: members are
submissions, scores are points, "top 10" is one range read. No table to
sort, no index to maintain — rank order is the data structure.
(`src/lib/server/leaderboard.ts` — read the header comment, then the two
store implementations side by side.)

**The exact operations** (via the Upstash REST API, one JSON command
array per call):

```
ZADD      clicky:lb:classic        9  {"n":"Ada","s":9,"t":1730000000000}
ZREVRANGE clicky:lb:classic        0  49  WITHSCORES
ZADD      clicky:lb:daily:2026-10-29  12  {"n":"Bo","s":12,"t":…}
ZREVRANGE clicky:lb:daily:2026-10-29  0  49  WITHSCORES
```

Design points to notice:

- The member is a JSON string of `{name, score, timestamp}`. The
  timestamp makes every submission a *distinct member*, so the same
  player can hold several rows (one per run) — and re-adding the
  identical member replaces its score, which is exactly `ZADD` semantics.
- Daily boards are just a different key per date. "Today's board resets
  tomorrow" costs nothing: tomorrow reads a different key.
- `ZREVRANGE … WITHSCORES` returns a flat `[member, score, member,
  score, …]` array — `UpstashLeaderboard.top()` walks it in steps of 2.
- Ties: Redis orders equal scores reverse-lexicographically by member.
  `InMemoryLeaderboard` reproduces that *exactly* (there's a test named
  for it), so the fallback never diverges from the real store.

**The fallback as a mirror.** `InMemoryLeaderboard` keeps
`Map<key, Map<member, score>>` — the same shape Redis keeps — and
implements `add`/`top` with sorted-set semantics. Same interface
(`LeaderboardStore`), same behavior, zero infrastructure: that's what
makes the demo mode honest instead of approximate.

---

## 4. If curation ever needs a queue: Cloudflare Queues ↔ Celery

Curation here is synchronous + SSE on purpose (it fits the latency
budget: p95 ≤ 20 s to a finished deck, and it's measured post-deploy).
But the *shape* of the async version is worth learning, because it's the
edge-native version of the Celery architecture you use at work:

| Celery (your day job) | Cloudflare equivalent | In a Queues-based curator |
| --- | --- | --- |
| Producer (`.delay()` / `.apply_async()`) | `env.QUEUE.send(job)` from a Worker | `POST /api/curate` creates a job record, enqueues `{jobId, theme}`, returns the jobId immediately |
| Broker (RabbitMQ / CloudAMQP) | The Queue itself (managed) | Holds curation jobs until a consumer is ready |
| Worker (Celery process) | Consumer Worker (`queue()` handler) | Runs the same `curateDeck()` loop from `curator.ts` |
| Task | Message + handler | `{jobId, theme}` → build deck |
| Retry / backoff | Queue retry settings per message | Failed curation retries with backoff |
| Dead-letter queue | DLQ configured on the queue | Poison themes (always crashing the builder) land here for inspection instead of retrying forever |
| Result backend | KV (or Redis) | Deck + status stored under `job:<id>` |
| Task id | Job id (UUID you mint) | Returned to the client; the client's only handle on the work |

**Job-status tracking is what prevents "ghost jobs."** A ghost is a unit
of work whose outcome is *unknown* — submitted, then silence: did it
run? fail? get lost? The pattern that prevents it, in both worlds:

1. **Write the status record first.** The producer creates
   `job:<id> = {status: "queued", theme, createdAt}` in the result store
   *before* (or atomically with) enqueueing. The job exists in a known
   state from the very first moment — it can never be "nowhere".
2. **Every transition is recorded by whoever causes it.** The consumer
   sets `running` when it picks the job up, then exactly one terminal
   state: `done` (with the deck) or `failed` (with the reason). Retries
   re-enter `running`; exhausting retries lands in the DLQ *and* sets
   `failed` — the DLQ is a place, not a disappearance.
3. **Clients poll a state machine, not a void.** The client polls
   `GET /api/curate/:jobId` and always gets one of the known states.
   "Still queued after N minutes" is itself a *diagnosable* state
   (timestamps show where it stalled: never picked up → broker/consumer
   problem; stuck in `running` → consumer died mid-job), instead of an
   unmeasurable suspicion.

The transferable lesson for your Celery work: ghosts aren't primarily a
broker problem or a worker problem — they're a *bookkeeping* problem.
If every task's lifecycle transitions are written down somewhere the
submitter can read, the unknown-outcome category shrinks to "the last
recorded state, plus how long it's been sitting there" — which is
measurable, alertable, and debuggable.

---

## 5. Hands-on exercises (small, in order)

1. **Move the bar.** In `src/lib/server/curator.ts`, change
   `JEV_ACCEPT_THRESHOLD` to `0.9`, run `bun run test` (which tests
   still pass?), then curate a deck locally and compare the judge
   summary's accepted count against 0.7. Put it back.
2. **Give the host a fourth tone.** Add `deadpan` lines to one bank in
   `src/lib/server/host.ts` (`LINES`), add the tone to the `judgeHostMoment`
   criteria and to `DemoJev`'s tone weights in `jev.ts`, and watch the
   badge pick it. Notice how many small places a "tone" touches — that's
   the real shape of a cross-cutting concept.
3. **Add an achievement.** `ACHIEVEMENTS` in `src/lib/client/profile.ts`
   is data + a predicate over history. Add "Night Owl: finish a run
   after 23:00" (or your own), plus a test in `profile.test.ts`.
4. **Retune Timed mode.** `TIMED_DURATION_MS` in `src/lib/engine.ts` —
   make it 30 s, then find every test that assumed 60 s and decide which
   ones were *specifying behavior* vs *transcribing the constant*.
5. **Hand-run the Redis.** With any local Redis (or Upstash console),
   replay §3's commands by hand for two players and a tie, and predict
   `ZREVRANGE`'s order *before* running it. Then read
   `InMemoryLeaderboard.top()` and find where that order is reproduced.
6. **Fool the demo judge.** In `jev.ts`, trace `relevance()` for theme
   `"ocean animals"` and title `"Blue whale"`. Explain the score, then
   write the smallest heuristic change that fixes this case without
   breaking the `jev.test.ts` expectations. (Then ask: would the real
   Jev need this patch? Why not?)
7. **Stream one more step.** Add a per-batch progress field to the
   curator's `validate` event (curator.ts → `api/curate` → 
   `CuratorPanel.svelte`'s `describeEvent`) so the step list shows
   cumulative judged counts from the Jev gate.
8. **Design the queue migration on paper.** Using §4's table, sketch the
   Queues version of `/api/curate`: what the job record contains, which
   states exist, what the client polls, and where the DLQ plugs in. No
   code — the deliverable is the state diagram. Compare it with how a
   Celery task's states are tracked in your work codebase.

## 6. One war story worth keeping

`src/lib/server/fetch.ts` exists because of a bug only the real runtime
could see: in Cloudflare Workers, the global `fetch` throws
"Illegal invocation" if you pass it around and call it unbound. Unit
tests in Node passed; the deployed runtime failed. The fix is one arrow
function (`globalFetch`) used as every default — and now there are
regression tests whose stub fetch *reproduces* the Workers contract
(throws unless `this === globalThis`). Lesson: when a platform has a
quirk, encode the quirk in a test double; don't rely on remembering it.
