# Balance — student wellness + credit economy (working prototype)

A runnable prototype of the system you spec'd: domain-based student/teacher
roles, a step-tracking quest with server-verified anti-cheat, a focus timer,
a homework hub, and a teacher
wellness insights dashboard — all backed by a real (if small) credit wallet
with a daily earning cap and monthly reset.

## Stack, and why

**Node.js (built-in `http` + `node:sqlite`) — zero npm dependencies.**
Everything runs with just `node server.js`. No `npm install`, no native
build step, no version-mismatch risk between your machine and a judge's.
`node:sqlite` needs **Node 22.5+** (check with `node -v`); if you're on an
older Node, upgrade or swap in `better-sqlite3` — the query calls are
already in that shape (`db.prepare(...).run/get/all(...)`), so it's a
near drop-in swap.

The frontend is your original HTML/CSS/JS, restructured onto a shared dark
sporty-minimal theme (`public/theme.css`) inspired by the padel/tennis club
references you sent — bold color energy kept in check by a lot of
whitespace and a restrained palette (lime accent, electric blue as a
secondary/teacher-role color, near-black surfaces).

## Run it

```bash
cd balance-app
node server.js
```

Open **http://localhost:3000**. That's the whole setup.

## AI coaches and camera features

Balance now includes two optional student-only AI coaches:

- **Homework AI Coach** in Homework Hub is a private, strict study coach.
  Students can ask for a first hint, submit an attempt for feedback, or learn
  a general method. It does not provide a final answer or submission-ready
  work for the student’s exact question.
- **Health Coach** is available from the student dashboard and provides
  general food, exercise, recovery, and habit guidance based on the form the
  student completes. American and Vietnamese are presented as food-style
  preferences, not assumptions about anyone's nationality.

After a successful Health Coach response, Balance stores one optional
movement plan for that student in the database. It stores only the selected
goal, conservative squat/push-up suggestions, a safety note, and timestamps;
it does **not** store height, weight, age range, dietary needs, the full AI
response, or Health Coach chat history. The plan is student-only and appears
again after a browser refresh on both Health and Multi-Exercise. It is
guidance only, and cannot change the fixed credit missions (40 squats for 5
credits; 20 push-ups for 5 credits).

Both coaches require an OpenAI API key on the **server**. Never put this key
in browser JavaScript, HTML, or a Git repository. Copy `.env.example` for a
reference, then set the environment variable before starting locally:

```powershell
$env:OPENAI_API_KEY="your-key-goes-here"
node server.js
```

`OPENAI_MODEL` is optional and defaults to `gpt-5.6-luna`. On Render or
another host, add `OPENAI_API_KEY` in that host's private environment-variable
settings instead. Without a key, the coaches show a clear setup message and
the rest of Balance continues to work.

The Focus Timer and Multi-Exercise pages load MediaPipe in the browser when a
student explicitly enables their camera. Video frames are processed locally;
they are not sent to Balance or saved. HTTPS is required for camera access in
production (localhost works while developing). The focus reminder audio is a
local file at `public/assets/locked-in-bro.mp3`; replace that file with another
MP3 if you want a different reminder voice.

## Two-account disposable judge demo (Render free plan)

For a competition demo, set the following private environment variables in
Render. This disables registration, permits only the two listed email
addresses, and recreates both accounts with blank homework, credit, and
activity data whenever the server process starts:

```text
DEMO_MODE=true
DEMO_RESET_ON_START=true
DEMO_TEACHER_EMAIL=your-teacher-email
DEMO_TEACHER_PASSWORD=a-password-of-at-least-8-characters
DEMO_STUDENT_EMAIL=your-student-email
DEMO_STUDENT_PASSWORD=a-different-password-of-at-least-8-characters
```

The teacher email must end in `@nguyensieuschool.com`; the student email
must end in `@nguyensieuschool.edu.com`. Both passwords must contain at
least 8 characters, 1 uppercase letter, and 1 special character.

`DEMO_RESET_ON_START=true` deliberately erases every demo database record,
including the saved Health movement plan, whenever Render restarts or
redeploys. The plan is permanent only while the database itself persists.
For a real permanent record, use a persistent database and disable the demo
reset behavior.

Use the teacher account to create an assignment, then the student account to
submit it and demonstrate credit rewards. A normal browser refresh keeps the
temporary session data while the server is running; a Render restart or
redeploy deliberately resets the demo. Never enable this configuration for a
real class.

### Try the roles
- Register with an email ending `@nguyensieuschool.edu.com` → **student**
  account (wallet, step tracker, timer, homework submission).
- Register with an email ending `@nguyensieuschool.com` (not `.edu.com`)
  → **teacher** account (create assignments, grade, wellness dashboard).
- Any other domain is rejected at registration — the role-matching logic
  lives in `lib/auth.js::roleForEmail`.

### Try the credit economy
- On the step tracker, use the **"+100 steps (desktop demo)"** button —
  real `devicemotion` events only fire on an actual phone, so this lets
  you test on a laptop. It goes through the exact same server endpoint
  and anti-cheat check as a real phone would.
- Try to break the anti-cheat: open the browser console and hit
  `fetch('/api/steps', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({delta: 5000, elapsedMs: 1000})})`
  — the server rejects it (5000 steps/sec is not a human), even if you
  bypass the client entirely. That's the important part: the check lives
  server-side in `lib/anticheat.js`, not just in `steptracker.js`.
- Try the offline queue: on the step tracker, open devtools → Network →
  set throttling to "Offline", click the demo button a few times (each
  click gets queued — watch the "N batches waiting to sync" indicator
  appear), then switch back to "Online" and watch them flush and credit
  automatically within a few seconds.
- Run the focus timer for 15+ minutes (or edit `MIN_FOCUS_MINUTES` in
  `routes/timer.js` down to 1 for a quick demo) to see the streak bonus.
- As a teacher, create an assignment with a due date, then submit it as
  a student before/after the due date to see on-time vs. late crediting.
- Push steps or timer sessions past 100 credits in one day and watch the
  daily cap clamp the award (`lib/credits.js`).
- On the dashboard, the "Your progress" tiles show all-time totals —
  complete a few focus sessions and submit a couple of homeworks, then
  reload the dashboard and watch the "Focus sessions" and "Homework done"
  numbers climb. They're pulled from `/api/stats/progress`, which sums
  real historical rows rather than re-deriving anything from today only.

## Redesign — sporty-minimal theme

`public/theme.css` is the single source of truth for the look: colors,
spacing, radii, and reusable components (`.btn`, `.card`, `.pill`,
`.input-field`, `.stat-tile`, the floating `.balance-nav`) all live there
as CSS custom properties and classes. Every page now links it before its
own page-specific CSS, so changing the palette or type scale is a one-file
edit rather than hunting through six stylesheets.

Palette, deliberately narrow:
- **Lime** (`--lime`, `#d6ff3f`) — the primary sporty accent: earning
  actions, primary buttons, the step-progress ring.
- **Electric blue** (`--blue`, `#4c8dff`) — secondary accent, used for
  teacher-role elements and "informational" stats, so students and
  teachers read as visually distinct at a glance without a second theme.
- **Red** (`--red`) — reserved for late/error states only.
- Everything else is near-black surfaces (`--bg`, `--surface`,
  `--surface-2`) and off-white/gray text — the "minimalism" half of the
  brief: one accent doing the work per element, lots of unused space,
  no competing colors.

The step tracker's progress ring and dark background were already close
to this palette, so that page needed the least rework. The focus timer
needed the most — it was cream/navy/Cinzel before, which is why it now
looks the most different.

## Progress tracking (done)

New `daily_wellness.sessions_completed` column (added via a safe
migration in `db.js` — `ensureColumn()` checks `PRAGMA table_info`
before altering, so it won't touch an existing database's data) counts
every valid focus session, even ones past the daily 3-bonus cap that
previously went unrecorded entirely.

`GET /api/stats/progress` (new, `routes/stats.js`) aggregates:
- `homeworkCompleted` / `homeworkOnTime` — `COUNT`/`SUM` over `submissions`
- `focusSessionsCompleted` — `SUM(sessions_completed)` over `daily_wellness`
- `stepsAllTime`, `daysLogged` — same pattern

The dashboard calls this alongside `/api/steps/today` on load and renders
it in the "Your progress" stat tiles. Nothing here is per-day — it's a
running total since the account was created, which is what "track their
studying progress" means for a dashboard rather than a daily snapshot.

## Sidebar, Profile, Shop, and classes (done)

**Sidebar.** A slide-out drawer (`.sidebar` / `.sidebar-backdrop` in
`theme.css`) with three links — Home, Profile, Shop — opened via the ☰
button that's now in every page's top nav (it's built once in
`app.js::renderSidebar()`, so every page that already includes `app.js`
gets it for free, no per-page wiring). The "pop" animation is a small
staggered CSS keyframe (`@keyframes sidebarPop`) — each link fades and
scales in slightly after the drawer slides open, each one a little later
than the last, rather than everything just appearing at once.

**Classes.** New `classes` table, seeded with five starter classes
(`10A`/`10B`/`11A`/`11B`/`12A`) on first run — add more directly in the
database if your school uses different names. Registration now includes
a class dropdown (populated live from `GET /api/classes`, so it never
goes stale relative to what's actually in the database); the chosen
`class_id` is stored on the account and shown everywhere via `/api/me`
and `/api/profile`. Login itself doesn't ask for a class — that's set once
at registration, not something you'd re-pick every time you log in.

**Profile.** `GET /api/profile` — for a student, the headline number is
`lifetime_earned`: a wallet column that only ever goes up, tracked
separately from `balance` (spendable, wiped by purchases) and
`daily_earned_credits` (resets daily). For a teacher, it shows the class
they manage and how many students are in it. One honest limitation: for
any wallet that existed before this feature shipped, `lifetime_earned`
starts at 0 — there's no way to retroactively reconstruct history that
was never tracked, so on an upgraded (not fresh) install, "total since
the beginning" really means "total since this feature was added."

**Shop.** Fixed catalog lives server-side in `lib/shop.js`
(Pencil–20, Pencil Case–50, Pen–25) so `/api/shop/buy` always charges
the real price regardless of what a client sends. Purchases only ever
deduct `balance`, never `lifetime_earned` — spending doesn't erase
credit for having earned it. Teachers can view the shop (catalog +
class progress) but the buy button is hidden for them, and the buy
endpoint itself rejects non-students regardless of what the UI shows.

**The pizza-party bar.** Every time `awardCredits()` actually grants
credits (steps, focus sessions, homework, exercise rewards), it also adds
that amount to `class_monthly_credits` for the student's class and the
current month — a running class-wide total, capped for display at the
500-credit goal, that resets naturally each new month since it's keyed
by `(class_id, year_month)`. This only tracks *earning*, not spending —
buying a pencil doesn't shrink the class's pizza-party progress.

## What's real vs. simplified

This is a working prototype, not the full competition build — a few
things are intentionally simplified so you have a runnable base to
demo and extend from:

| Feature | Prototype approach | Real version would need |
|---|---|---|
| Auth | Password + scrypt hash, in-memory sessions | WebAuthn biometric (client-side key, as you specced), or at least DB-backed/Redis sessions so restarting the server doesn't log everyone out |
| Offline / spotty connectivity | Yes — IndexedDB-backed; see below | A service worker to cache the app shell itself, so a full page reload also works while fully offline (see caveat below) |
| Geolocation park quests | Not built | Add a `lib/geofence.js`, an endpoint, and check-in UI in `steptracker.html` |

## Offline support (done)

`public/offline-queue.js` wraps an IndexedDB store (`balance-offline` /
`pending-steps`). When `/api/steps` fails to reach the server —
`syncToServer`'s `catch` block — the batch is written to disk instead of
just sitting in a JS variable, so it survives a closed tab or a crash, not
just a slow network. On load, on the browser's `online` event, and on a
regular interval, `flushQueue()` replays anything still queued, in order,
stopping cleanly if the network drops again mid-replay. A small indicator
under the step counter shows "N batches waiting to sync" whenever the
queue isn't empty.

One related gap this surfaced and also fixed: `requireAuth()` in
`app.js` used to redirect to the login page on *any* fetch failure,
including a pure network outage — which would've booted someone off the
tracker mid-walk despite their session being perfectly valid. It now
only redirects on an actual "not logged in" response from the server;
a network failure instead falls back to the last confirmed session
(cached in `localStorage`) and shows a small "offline — showing cached
session" note in the nav bar instead.

**Known caveat:** this covers the *data* (steps queue safely and survive
a refresh) but not the *app shell* — if a phone goes fully offline
*before* the page has ever loaded, or a hard-refresh happens with zero
cache, there's nothing to serve the HTML/JS from. Fixing that needs a
service worker caching the static files, which is extension #1 below.

## What I'd extend next

Roughly in order of "most value for least effort":

1. **Service worker for the app shell.** Complements the offline queue
   above — caches `index.html`, `steptracker.html`, and the JS/CSS so a
   fully-offline reload still loads *something* to queue steps into,
   rather than failing outright.
2. **Persistent sessions.** Swap the in-memory `Map` in `lib/auth.js` for
   a `sessions` table in the same SQLite DB (or a cookie-signed JWT).
   Right now restarting the server logs everyone out — fine for a demo,
   not for judges poking around over a few hours.
3. **WebAuthn.** The password flow is a placeholder for exactly this.
   `lib/auth.js` already isolates "verify credential → create session",
   so WebAuthn slots in as an alternate `verify` path without touching
   the rest of the app.
4. **Geolocation park quests + Co-op Class Quests scaling.** Both are
   genuinely new features (not upgrades to something built), so budget
   real time for them — a `quests` table, a geofence check endpoint, and
   a class-size-aware reward formula.
5. **Grading UI polish** — right now teacher grading is a bare `<select>`
   per submission. A real "needs revision" flow would notify the student
   and let them resubmit.

## Deploying (getting a public URL)

This app needs a host that keeps a process running continuously — not a
static-site host like Netlify or Vercel's default mode, since login
sessions live in memory and the database is a file on disk (see "What's
real vs. simplified" above). Render is used below since it needs zero
code changes, but Railway and Fly.io work the same way. **Check each
platform's current pricing before committing — free-tier terms change
often.**

### Steps

1. **Push this project to a GitHub repo** (Render deploys from Git, it
   doesn't take a raw zip upload):
   ```bash
   cd balance-app
   git init
   git add .
   git commit -m "Initial commit"
   ```
   Then create an empty repo on github.com and follow the "push an
   existing repository" instructions it shows you.

2. **Create a Render account** at render.com (or Railway, at
   railway.app) — this is the one part that has to be you, since it's
   tied to your email/billing.

3. **New → Web Service → connect your GitHub repo.** Render should
   detect `render.yaml` in this project and pre-fill the settings
   (start command `node server.js`, no build step). If it doesn't
   pick up the blueprint automatically, set those two fields by hand.

4. **Deploy.** You'll get a URL like `https://balance-app-xxxx.onrender.com`
   — that's the real, public, shareable link. Give it a minute on first
   deploy.

5. **Test it exactly like you did locally** — register a student and a
   teacher account, submit homework, check the wallet updates.

### The persistence caveat, concretely

On Render's free plan, `data/balance.db` gets reset whenever the service
redeploys or restarts (free services also spin down after ~15 min idle,
adding a cold-start delay on the next visit — separate from data loss,
just slower). Two real ways to fix this:

- **Pay for a persistent disk** — switch `plan: free` to `plan: starter`
  in `render.yaml` and uncomment the `disk` block. Check Render's current
  per-GB disk pricing before doing this.
- **Move off a file-based database entirely** — swap `node:sqlite` for a
  hosted Postgres (Render, Railway, and Supabase all offer one). This is
  a real code change, not a config flag — `db.js` and every
  `db.prepare(...).run/get/all(...)` call would need to move to an async
  Postgres client. I can do this migration if you want genuinely durable
  data rather than a demo that resets periodically — just say so.

## Project layout

```
balance-app/
  server.js              # entry point — router + session middleware
  db.js                  # SQLite schema (matches the table design you specced)
  lib/
    auth.js               # password hashing, sessions, domain→role logic
    credits.js             # wallet: daily cap, monthly reset
    anticheat.js            # server-side step-rate validation
      http-helpers.js          # tiny JSON/multipart/cookie/static-file helpers (no Express)
  routes/                 # one file per resource (auth, steps, timer, assignments, wallet, teacher)
  public/                 # frontend — your original pages, wired to the API
```
