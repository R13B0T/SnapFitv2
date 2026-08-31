# SnapFit v2 — Gym Buddy

A training coach that plans a real multi-week block toward one goal, teaches you how to
execute each lift and why it's programmed, adapts to how you're recovering, and tracks
the numbers underneath it all.

**v1 was a workout generator with a weight tracker attached.** It answered *what to do
today* and nothing else — no goal, no plan beyond an endless A/B/C rotation, no form
coaching, no way to ask a question. v2 keeps the tracking and builds the coaching on top.

---

## What it does

**One goal drives everything.** You set a target and a date. The app derives a training
block from it — phases, rep ranges, set counts, when the deload lands — and every session
comes out of that block. The Plan tab always shows where you are in it and what the current
phase is for.

**It teaches at the rack.** Every exercise card carries a *Why this?* line explaining its
job in today's session, and a *How to do it* panel with setup cues, how to execute the rep,
the mistakes people actually make on that exercise, and what it should feel like when it's
right. Opening *How to do it* makes one coaching call when AI is enabled. The same panel has
a direct YouTube Shorts search for the exercise; that link does not use the AI or spend credits.
The Why and How controls can each be hidden in Settings when you want a quieter workout screen.

**Swap the exercise without losing the reason.** Before logging the first set, *Swap exercise*
records whether equipment was busy, the movement caused discomfort, or the change was a preference,
then offers up to two available alternatives from the same movement pattern. Sets, reps, rest and
phase stay intact; the replacement load comes from its own logged history. The reason remains on the
active exercise, completed-session log and coach history. This is catalogue-driven and spends no AI credits.

**Discomfort becomes a temporary safety constraint.** Choosing discomfort records the affected body
area immediately. Future built-in and AI suggestions exclude exercises tagged for that area until the
user marks it resolved on Today or in Settings. An unknown/other area is carried to the coach without
guessing which movements are safe. The app clearly treats this as a workout adjustment, not a diagnosis.

**It briefs you before you start.** What today's session is for, what's required of you to
make it count, and how you'll know you got it right — at the top of the Today screen, before
the first exercise.

**Warm up and cool down for the session actually in front of you.** Today includes a compact,
matched warm-up: two minutes of easy movement, up to three dynamic pattern drills, and sensible
ramp weights for the first exercise. A matched cool-down selects up to four non-duplicated static
stretches from the movements trained that day and opens automatically in the debrief. Both are
built-in, work offline and use no AI credits; ramp sets are clearly kept out of the working log.

**It checks in and debriefs.** Before the session: sleep, energy, soreness, stress. Rough
night and the weights come down and a set comes off. After the session: what happened, what
it means, and what moves next time.

**The rest timer runs on the audio clock.** A short whistle at 20 seconds, the same whistle
every second from 10 through 1, and a long whistle when rest is up — so you can put the phone down. It
keeps counting when you switch tabs, and it survives a reload mid-workout. A watchdog detects
the iPhone/WebKit failure where an audio context says it is running while its clock is frozen,
restarts it, and re-anchors all remaining cues to the rest timer's real end time.

**Every exercise shows what the coach prescribed** alongside what you're actually lifting, so
overriding a weight never loses track of the target.

**Extra session when life unexpectedly cooperates.** The Plan page can add the next workout
from the current block without permanently changing the weekly target. It uses the same split,
phase, sets, rep range, effort and progression as the rest of the plan, and advances the block
normally when finished. The log and weekly review label it as an extra so attendance stays honest.

**One busy week does not rewrite the whole block.** Plan can set a two-to-five-session target for
the current block week only. The normal weekly frequency and later weeks stay unchanged. If history
lands in the wrong block week, Log can move that session's plan placement without changing its real
date, exercises, sets or loads. A separate current-week failsafe can move the plan cursor forward
when missed or imported logs make the app think the user is still in an earlier week; it changes no
session dates and fabricates no history. The selected week is applied only after pressing *Lock in
Week X*, persists across reloads, and still advances normally when that week's sessions are complete.

**Today is generated deliberately.** Opening Today shows a readiness check rather than silently
building a workout. Sleep, energy, soreness, stress, time available and an optional note shape the
session. A draft can be regenerated with a reason before training; rejecting it does not advance the
block.

**AI and fallback are never blurred together.** The header reflects the most recent real API result,
not merely whether a key is saved. If an AI request fails, the built-in result remains permanently
marked as not AI-generated and offers a one-tap retry. AI prompts include an aggregate of the whole
logged journey, long-range exercise progression and eight recent sessions in set-by-set detail. A
failed AI block retry keeps the existing block and current week; only a successful AI response can
replace it. A saved key now verifies itself automatically through Anthropic's models endpoint: every
12 hours while healthy and every two minutes after a failure. That health check generates no content
and consumes no message tokens, so reopening the app does not require a manual reconnect.

**Changing weekly frequency keeps the block intact.** Moving from three sessions to four (or
back again) applies the new split from the next generated session while preserving the current
block, week, phase, history and weights. It does not silently send the plan back to week one.

**Exercise cards stay out of your way.** They start compact with the lift and target visible;
tap one to reveal *Coach Says*, set logging, and the Why/How coaching. Finishing its last set
folds the card closed again and gives it a light-green background, so what's done is obvious.

**The exercise catalogue reflects the whole functional area.** The dumbbell coverage already
spans every major movement pattern. The Life Fitness Multi-Jungle is modelled as a multi-purpose
cable system rather than a fixed machine: high, middle and low positions; single- and two-arm
methods; standing, seated, kneeling and bench-supported setups; presses, rows, pulldowns, squats,
hinges, lunges, glute work, arm work, rotation and anti-rotation. Each cable method records its
station, height, attachment, body position, laterality, difficulty, extra equipment and complete
coaching cues. Bench methods only enter the pool when a nearby bench is enabled.

Exercises are stored separately from their equipment methods. That lets a seated row, chest press,
curl or other movement have dedicated-machine, cable and free-weight implementations while keeping
one training intent. Swaps prefer the same canonical movement on different available equipment,
then rank same-pattern alternatives by target-muscle overlap. Functional sandbags/Core Bags add
progressive front squats, reverse lunges, deadlifts, clean-and-presses and Russian twists using the
gym's 5–25kg set.

**Photograph a strange gym and it adapts.** In a hotel, at a friend's place, anywhere that
isn't your gym: take up to three photos and the coach reads what's there. You confirm the list
— it flags what it's sure about and what it's guessing — and the day's session is built from
that instead. Tell it the heaviest dumbbell and nothing gets prescribed above it. Your real
gym, block, history and working weights are untouched, and it switches itself off overnight so
you never walk into your own gym holding a hotel session.

**A Learn hub for the concepts.** Progressive overload, RPE and reps-in-reserve, the muscle
map, rep ranges, why deloads exist, warming up, stretching, recovery, what to do when a lift stalls.
Every topic has a comprehension check and the hub tracks what you've covered. An optional
Advanced layer adds autoregulation, recoverable volume, exercise selection and reading trends;
it is off by default and can be enabled in Settings. *Hide all learning* removes the entire Learn
tab when you do not want it in the app; Settings restores it later without deleting reading progress.

**Ask it anything.** With an API key, the Coach tab is a conversation with something that
can see your goal, your block and every set you've logged. Only the last eight chat messages
are sent on each turn, and *New chat* starts clean when the topic changes. During a session,
each exercise also has a focused set chat that sends only that exercise, its logged sets and
the last six mini-chat messages.

**Goal pace is visible, without pretending it is certain.** After at least two dated body
measurements and some progress toward a numeric target, the Goal page estimates days remaining
and a forecast date from the logged rate. It is clearly labelled as a current-pace estimate.

---

## Running it

It's three static files. No build step, no bundler, no server.

```bash
git clone <this repo> && cd SnapFitv2
python3 -m http.server 8000     # or: npm start
```

Open `http://localhost:8000`. On a phone, use *Add to Home Screen* — it installs as a PWA
and runs offline.

When a newer PWA version finishes downloading, a visible **Update available** banner waits for the
user. **Update & Reload** activates the waiting service worker and reloads the installed app; it never
silently refreshes during a set. The active session is already persisted and resumes after the reload.

On a fresh install, *Load from JSON backup* sits directly below *Let's go*. Selecting a validated
SnapFit backup restores the goal, block, history, settings and included API key and skips the setup
questions. Normal setup remains unchanged for new users.

To deploy: push to a branch and turn on GitHub Pages. That's the whole deployment story.

---

## The API key

**The app is fully usable without one.** A rule-based coach handles the block, every
session, all progression, and the entire Learn library. It works in a gym dead-spot,
offline, forever.

A key upgrades it: a plan written for you rather than picked from a template, sessions that
adapt to your check-in and recent performance, coaching written around your actual numbers,
session debriefs, weekly reviews, and the chat tab.

Get one at [console.anthropic.com](https://console.anthropic.com) → API Keys, then paste it
into Settings. Model is switchable — Opus 5 by default, with Sonnet 5 and Haiku 4.5 as
cheaper options.

> **The key is stored unencrypted in your browser's localStorage.** Any script running on
> that device can read it. That's inherent to an app with no server, not a bug we forgot to
> fix. Use a key with a spend limit set, and don't do this on a shared machine. Requests go
> directly from your browser to Anthropic — nothing passes through a server of ours, because
> there isn't one.

Every AI call falls through to the rule-based coach on any failure — no key, no signal,
rate limit, bad key, timeout. You get a small "using the built-in coach" note and the
session still happens.

---

## Settings worth knowing about

**Theme.** System, Light or Dark, defaulting to System. *System* means system continuously — it
follows your phone switching at sunset, not just whatever the phone said when the app started.
Light is a soft off-white rather than a stark white.

Every accent darkens considerably in light mode, because it has to: the dark theme's mint green
measures **1.34:1** on off-white and its yellow **1.31:1** — invisible, not merely weak. The
light values all land at 5:1 or better. Dark mode is byte-for-byte unchanged.

**Text size.** Five steps, defaulting to Comfortable. It scales body text and deliberately
leaves the big display headings alone. Implemented as a CSS custom property, so the change is
instant — no re-render.

**Coach personality.** Two five-step controls tune every AI-written plan, session brief,
debrief, weekly review and chat reply. *Sass* runs from straight coaching to a full playful
roast; *Hard truth* runs from gentle delivery to no sugar-coating. The defaults are Cheeky
(3/5) and Blunt (4/5). Both scales keep fixed guardrails: no fake praise, personal insults,
body-shaming, invented failures or unsafe training advice.

**Training week start.** Choose Sunday through Saturday. Weekly reviews and exact week references
sent to the coach use that window; changing it does not reset the block or move its phase.

**Voice summaries.** Session debriefs and weekly reviews include a Listen button when the
browser supports speech synthesis. The AI returns a separate short script written to be heard
aloud, while the phone reads it with its best available English voice. That keeps the feature
free of a second API key and sends no audio to another service; voice quality depends on the
voices installed on the device.

**Rest timer sounds.** On by default, with a saved 0–100% volume control and a *Test countdown +
long whistle* button. A short whistle sounds at 20 seconds and every second from 10 through 1;
a long whistle announces the next set. Both Mixkit samples are bundled for
offline use ([whistle collection](https://mixkit.co/free-sound-effects/whistle/),
[free sound-effects licence](https://mixkit.co/free-sound-effects/)). The sequence is scheduled
against the audio clock rather than a JavaScript timer, which can be throttled in a backgrounded
tab. The timer does not play a silent keepalive track, so it does not take over the phone's media
session or stop music from another app. On supported iPhones it requests the ambient, mixable audio
category, primes Web Audio on the user's tap, and recovers a context that iOS reports as interrupted
while another music app is active. A cue may briefly mix with or duck the music when it sounds.

**Keep the screen awake during a session.** On by default. Uses the Screen Wake Lock API
(Chrome/Android, Safari 16.4+), and the toggle says so where it isn't supported.

> **On lock-screen audio, honestly:** scheduling on the audio clock gets the cues through the
> app being backgrounded. A *locked* screen is different — phones may suspend the audio
> context. SnapFit deliberately does not fight that with a silent audio track because doing so
> interrupts your music. Keeping the screen awake is the way to make cues reliable.

## Coming from v1

v2 lives at a different URL, so browser storage doesn't carry across. Export a CSV from v1
(**Weights → Export**) and import it under **Log → Data**. The CSV format is unchanged, so
your exercise history and working weights come straight over and the coach picks up from
your real numbers instead of starting you at zero.

**Moving between devices, or restoring after a reset:** use **Log → Data → Export JSON**, then
**Restore JSON** on the other device. A restore replaces everything, so it shows you what's in
the file — goal, block, session count, date range and whether it has an API key — and asks you
to confirm first. A file that isn't a valid backup is rejected with the actual reason, and
nothing on the device is touched. The API key is included in plain text, so treat the backup
like a password and do not leave it on a shared computer.

---

## Equipment

Seeded with the full Snap Fitness Watagan Park station list, so it works out of the box
exactly like v1. Settings has an editor — untick what your gym doesn't have, add your own.
Only ticked equipment ever gets programmed, so it still produces sensible sessions if all
you have is a bench and some dumbbells.

The full 50-station Watagan Park floor plan is seeded by number. **Log → Loads** holds the
plate-loaded Hammer Strength starting resistance, whether it applies per arm or to the whole
machine, and the available plate sizes. Manufacturer values are editable because a placard on the
physical machine is the final authority. Snap's seeded plate set is 2.5, 5, 10 and 20kg; prescriptions
are rounded to equal, physically loadable plates on both sides and include machine resistance in the
displayed total. The Glute Drive uses the gym-confirmed 20.4kg base resistance and stays marked *verify on machine* because its official product page
does not publish a starting resistance.

Injury flags work the same way: tick *knees* and nothing knee-loading gets programmed at all.

### Training somewhere else

The Today screen has a venue row. Tap it and you can either photograph the gym you're standing
in — the coach reads the equipment and you confirm the list before it applies — or pick from a
list by hand, starting from a preset for the usual hotel setups.

The photo path needs an API key, because there is no way to read a picture offline. **The
by-hand path needs nothing**, which matters: hotel gyms are in basements and basements have no
signal. Presets get you to a working list in one tap.

Both paths tell you what the place can actually build before you commit — how many exercises,
which movement patterns are covered, and which are missing. Dumbbells and a bench covers all
of them. A row of fixed machines doesn't, and it says so rather than quietly dropping your leg
work.

Two things it deliberately does:

- **Nothing above the dumbbell ceiling.** Give it the heaviest pair on the rack and it caps
  every dumbbell prescription there, then tells the coach to add reps instead. Being handed
  30kg in a room where the heaviest is 15 is the fastest way to stop trusting an app.
- **Expires overnight.** An away gym is set for a date. Tomorrow it's off, and the record stays
  on file so a four-night stay is one tap a day rather than a rescan a day.

Your real gym is never edited by any of this. Coming home is one tap, and it drops the session
that was built for the other place rather than leaving you holding it.

---

## How it's built

| File | What it is |
|---|---|
| `index.html` | The entire app — data, both coach engines, all seven views |
| `sw.js` | Service worker. Cache-first shell, network-only for the API |
| `manifest.json` | PWA manifest |
| `test/` | Browser test harnesses (see below) |

React 18 + Babel standalone from unpkg, compiled in the browser. State lives in
`localStorage` under `snapfit_v2`; the API key sits in its own runtime key and is copied into
JSON backups only when the user explicitly exports one.

**Colour is CSS custom properties.** The `C` object holds `var(--c-*)` references rather than
hex, so the ~620 inline styles that use it need no knowledge of the theme and switching one is a
single attribute on `<html>` with **no React re-render** — the same mechanism as the text-size
setting's `--ts`. It also means module-level constants that capture a colour hold a live
reference instead of freezing on whichever theme loaded first.

Two consequences worth knowing:

- Hex alpha can't be concatenated onto a `var()`, so `` `${C.red}55` `` became
  `tint(C.red, 0x55)`, which does the same job through `color-mix`. It takes the same byte, so
  the conversion was exact rather than approximate. **Needs Safari 16.2 / Chrome 111 / Firefox
  113** — the wake lock already required Safari 16.4, so this doesn't move the floor. A test
  guards against reintroducing the concatenation, because on a `var()` it fails silently: no
  border, no error.
- The palette and a six-line resolver live in the static `<head>`, not in the app's stylesheet.
  Babel takes a beat to compile ~5,000 lines, and leaving the theme to the app means a black
  flash on a light phone. There's a test that loads the page with React blocked entirely and
  asserts the theme still resolves.

The PWA install splash stays dark in both themes — `manifest.json` is static JSON and can't
respond to a preference. It's a one-off screen, and two manifests isn't a worthwhile trade.

**Two coach engines behind one interface.** Every coaching call goes through
`coach.<method>()`. Each method has an AI path and a rules path returning the same shape,
so no view ever branches on whether a key exists.

| Method | Rules path | AI path |
|---|---|---|
| `buildBlock` | Template per goal type | Bespoke block, structured output |
| `todaysSession` | Block targets + progression | Adapts to check-in and recent performance |
| `explain` | Static cue library | Personalised to your history |
| `debrief` | Templated from progression outcomes | Written narrative |
| `weeklyReview` | Adherence + e1RM deltas | Coaching read on the week |
| `chat` | *(needs a key)* | Streamed, grounded in your data |
| `scanGym` | *(impossible offline)* | Vision, matched to the station list |

`scanGym` is the exception to the two-engines rule, because you cannot read a photograph
without a model. It throws rather than falling through, and the UI answers that by offering
the by-hand picker instead — which is why the feature still works with no key.

One choke point makes the away gym work: `activeStations(state)`. The exercise pool, the
equipment digest sent to the model and every count in the UI all read it, so overriding the
venue needed no special-casing downstream and no edit to the stored gym.

Notes on the API usage, since it moved on since v1:

- **Structured outputs** (`output_config.format`) on every non-chat call, so malformed
  responses are impossible rather than merely unlikely. v1 asked for JSON in the prompt and
  stripped code fences off the reply.
- **Prompt caching** on the system block (goal, block, equipment, catalogue, history
  digest). Deliberately byte-stable — no timestamps or per-request ids in it, or the cache
  would be invalidated on every call.
- **Vision** for the gym scan. Photos are downscaled to 1400px on the long edge in a canvas
  before sending — a phone hands you 10MB and 4000px, base64 adds a third on top, and the API
  caps an image at 5MB. The station list goes in the user turn, not the cached system block,
  so it neither breaks the cache nor gets matched against an already-overridden gym.
- **Streaming** for chat only.
- Adaptive thinking left on with a low/medium effort setting. Disabling thinking on Opus 5
  can leak `<thinking>` tags into visible output.

---

## Tests

Three Playwright harnesses that drive the real UI in a real browser.

```bash
npm install
npm test
```

Three browser-driven test suites cover the app journey, coaching paths and full-block simulation.

- **`test/app.test.js`** — the no-key path end to end: onboarding, check-in, session
  generation, logging a set, form coaching, finishing, the debrief, every tab, persistence
  across reload, no horizontal scroll at 320px, zero console errors. Plus the away gym on the
  path that needs no key: presets, what gets programmed, the dumbbell ceiling, reusing a
  remembered venue and forgetting one. Plus both themes, with **WCAG contrast computed from the
  rendered page** — every accent against the surface it sits on, and an assertion that light is
  never the weaker theme at its weakest point. That's what stops a future palette tweak shipping
  an unreadable screen.
- **`test/coach.test.js`** — progression maths, readiness banding, v1 CSV migration, and
  the AI path against a mocked API: prompt caching, structured output, and the fallthrough
  under 500s, 401s and dead connections. The gym scan is driven through the real review UI
  against a mock that returns a station number that doesn't exist, a duplicate and a guess,
  so the confirmation step is tested as a safety net rather than assumed to be one.
- **`test/block.test.js`** — simulates a complete 8-week block through the rules engine and
  asserts weeks advance, phases progress in order, load climbs, the deload drops it, and
  equipment and injury constraints actually hold.

The harnesses intercept the unpkg requests and serve the same UMD builds from
`node_modules`, so the suite needs no network access and `index.html` needs no test-only
changes.

---

## Not in scope

No food logging. It tracks body weight and recovery signals because those change how you
should train, but meal plans and macro counting are a different app.

It gives general training guidance, not medical advice. Sharp pain, joint pain, one-sided
pain or anything that doesn't settle needs a physio or a doctor — the coach will work
around it in the meantime but it can't diagnose anything.
