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
right.

**It briefs you before you start.** What today's session is for, what's required of you to
make it count, and how you'll know you got it right — at the top of the Today screen, before
the first exercise.

**It checks in and debriefs.** Before the session: sleep, energy, soreness, stress. Rough
night and the weights come down and a set comes off. After the session: what happened, what
it means, and what moves next time.

**The rest timer runs on the audio clock.** Beep at 20 seconds, double beep at 10, a tick
every second after that, and a whistle when rest is up — so you can put the phone down. It
keeps counting when you switch tabs, and it survives a reload mid-workout.

**Every exercise shows what the coach prescribed** alongside what you're actually lifting, so
overriding a weight never loses track of the target.

**A Learn hub for the concepts.** Progressive overload, RPE and reps-in-reserve, the muscle
map, rep ranges, why deloads exist, warming up, recovery, what to do when a lift stalls.
Ten topics with a comprehension check each, and it tracks what you've covered.

**Ask it anything.** With an API key, the Coach tab is a conversation with something that
can see your goal, your block and every set you've logged.

---

## Running it

It's three static files. No build step, no bundler, no server.

```bash
git clone <this repo> && cd SnapFitv2
python3 -m http.server 8000     # or: npm start
```

Open `http://localhost:8000`. On a phone, use *Add to Home Screen* — it installs as a PWA
and runs offline.

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

**Text size.** Five steps, defaulting to Comfortable. It scales body text and deliberately
leaves the big display headings alone. Implemented as a CSS custom property, so the change is
instant — no re-render.

**Rest timer sounds.** On by default, with a *Test the cues* button so you can check your
volume before you're mid-session. The whole cue sequence is scheduled against the audio clock
the moment rest starts rather than fired from a JavaScript timer, because timers get throttled
to once a minute in a backgrounded tab and the audio clock doesn't.

**Keep the screen awake during a session.** On by default. Uses the Screen Wake Lock API
(Chrome/Android, Safari 16.4+), and the toggle says so where it isn't supported.

> **On lock-screen audio, honestly:** scheduling on the audio clock gets the cues through the
> app being backgrounded. A *locked* screen is different — iOS Safari suspends the audio
> context outright, and the silent-keepalive workaround this app uses works on some iOS
> versions and not others. It's reliable on Android. Keeping the screen awake is the way to be
> sure, which is why that setting exists and defaults to on.

## Coming from v1

v2 lives at a different URL, so browser storage doesn't carry across. Export a CSV from v1
(**Weights → Export**) and import it under **Log → Data**. The CSV format is unchanged, so
your exercise history and working weights come straight over and the coach picks up from
your real numbers instead of starting you at zero.

**Moving between devices, or restoring after a reset:** use **Log → Data → Export JSON**, then
**Restore JSON** on the other device. A restore replaces everything, so it shows you what's in
the file — goal, block, session count, date range — and asks you to confirm first. A file that
isn't a valid backup is rejected with the actual reason, and nothing on the device is touched.
The API key is never in an export and is never altered by an import.

---

## Equipment

Seeded with the full Snap Fitness Watagan Park station list, so it works out of the box
exactly like v1. Settings has an editor — untick what your gym doesn't have, add your own.
Only ticked equipment ever gets programmed, so it still produces sensible sessions if all
you have is a bench and some dumbbells.

Injury flags work the same way: tick *knees* and nothing knee-loading gets programmed at all.

---

## How it's built

| File | What it is |
|---|---|
| `index.html` | The entire app — data, both coach engines, all seven views |
| `sw.js` | Service worker. Cache-first shell, network-only for the API |
| `manifest.json` | PWA manifest |
| `test/` | Browser test harnesses (see below) |

React 18 + Babel standalone from unpkg, compiled in the browser. State lives in
`localStorage` under `snapfit_v2`; the API key sits in its own key so exports never
include it.

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

Notes on the API usage, since it moved on since v1:

- **Structured outputs** (`output_config.format`) on every non-chat call, so malformed
  responses are impossible rather than merely unlikely. v1 asked for JSON in the prompt and
  stripped code fences off the reply.
- **Prompt caching** on the system block (goal, block, equipment, catalogue, history
  digest). Deliberately byte-stable — no timestamps or per-request ids in it, or the cache
  would be invalidated on every call.
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

- **`test/app.test.js`** — the no-key path end to end: onboarding, check-in, session
  generation, logging a set, form coaching, finishing, the debrief, every tab, persistence
  across reload, no horizontal scroll at 320px, zero console errors.
- **`test/coach.test.js`** — progression maths, readiness banding, v1 CSV migration, and
  the AI path against a mocked API: prompt caching, structured output, and the fallthrough
  under 500s, 401s and dead connections.
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
