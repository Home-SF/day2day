# CLAUDE.md

Guidance for Claude (or any future contributor) working in this repo.

## What this is

**Field Log** — a static, single-page site for logging day-to-day personal
stuff: text notes, GPS check-ins, and photos. Content is organized as
Year → Month → Day, all client-side routed off the URL hash (`#/2026`,
`#/2026/7`, `#/2026/7/13`). No build step, no framework — plain HTML/CSS/JS
with ES module imports, backed by Firebase (Firestore + Storage + Auth).

This is a **personal, single-user** app: Google sign-in gates the whole
UI, and Firestore/Storage security rules restrict read/write to one
specific email address (see README.md). It intentionally shares no data
with the author's other trip-log sites, which run on separate Firebase
projects.

## File map

| File | Purpose |
|---|---|
| `index.html` | Shell markup: sign-in screen + app shell (breadcrumb, `#main`, toast). Loads `app.js` as a module. |
| `app.js` | The entire app: Firebase init, routing, all four views (years/months/days/day-page), data helpers, weather/geocoding, auth gate. No other JS files or bundler — everything lives here. |
| `firebase-config.js` | Firebase SDK config object + two naming constants (`COLLECTION_PREFIX`, `STORAGE_PREFIX`). The API key here is a **public web client key** (normal for Firebase — security is enforced by Firestore/Storage rules, not by hiding this key). |
| `styles.css` | Mobile-first CSS (base styles target ~360-390px phones; one `@media (min-width: 600px)` block adds breathing room for larger screens). Design tokens as CSS custom properties at the top (`--paper`, `--accent`, etc.) — an "aged ledger / field record" aesthetic. |
| `firebase.json` | Firebase CLI config — currently only declares the `functions` codebase (no hosting config checked in; deployment target is GitHub Pages per README, not Firebase Hosting). |
| `functions/index.js` | One scheduled Cloud Function, `createTomorrowsDayPage`, that pre-creates tomorrow's Firestore day-doc at midnight (`America/Los_Angeles` by default — see `TIME_ZONE` const). Requires Blaze plan. |
| `functions/package.json` | Deps for the functions codebase: `firebase-admin`, `firebase-functions`. Node 20. |
| `README.md` | Full setup instructions (create Firebase project, security rules, enable Google auth, deploy functions, run locally). Read this before making setup-related changes — it's kept accurate and detailed. |

There is no `package.json` at the repo root, no bundler, and no test
suite. `functions/` is the only place with its own `package.json` /
`node_modules`.

## Data model (Firestore)

- Collection: `activityLog_days` (docs keyed by `YYYY-MM-DD`)
  - Fields: `createdAt`, optional `city` (string), optional `weather`
    (`{ tempF, condition, icon, capturedAt }`), optional `createdBy`
    (set to `"scheduled-function"` when pre-created by the Cloud Function).
  - Subcollection `entries`, one doc per logged item, each with a
    `timestamp` (ISO string) and a `type` of `text`, `checkin`, or `photo`:
    - `text`: `{ type: 'text', text }`
    - `checkin`: `{ type: 'checkin', location: { lat, lng, label } }`
    - `photo`: `{ type: 'photo', photoURL }`
- Storage: photos live under `activityLogPhotos/{dayId}/{timestamp}_{filename}`.

City and weather are captured **once**, lazily, on first visit to a day
page (via browser geolocation) and then frozen — they never get
overwritten by later visits or later check-ins on the same day.

## Conventions to follow when editing

- **No frameworks, no bundler.** Keep `app.js` as vanilla ES modules
  importing directly from the `gstatic.com/firebasejs` CDN (currently
  pinned to `10.12.2` — bump the version in the same place across all
  three `firebase-*.js` imports if you upgrade).
- **Mobile-first CSS.** Unqueried rules in `styles.css` are the phone
  baseline; only *add* rules inside `@media (min-width: 600px)` for
  larger screens — don't hide/rework things at the small end. Keep tap
  targets ≥44px and form inputs at ≥16px font (iOS Safari zoom issue).
- **Design tokens live in `:root`** in `styles.css` — reuse the existing
  `--paper`/`--ink`/`--accent`/`--stamp`/`--muted` palette and the
  Playfair Display / Libre Caslon Text / IBM Plex Mono font trio rather
  than introducing new colors/fonts.
- **Lazy-creation fallback stays in `app.js`.** `ensureDayDoc()` is a
  safety net for days the scheduled function didn't pre-create (e.g.
  the very first day, or before the function is deployed) — don't
  remove it even though the Cloud Function is the primary path.
- **Don't overwrite `city`/`weather` once set** — both `tagCityIfMissing`
  and `captureWeatherIfMissing` explicitly check `existingDoc` first and
  no-op if already present. Preserve that "capture once, freeze forever"
  behavior unless a change is explicitly about the open question in the
  README (whether the city badge should ever update).
- **Weather/geocoding providers are deliberate choices**: Open-Meteo
  (no API key) for weather, BigDataCloud's free reverse-geocoding
  endpoint for city names. Don't swap these without checking with the
  user first — README notes this was an assumption, not a firm
  requirement.
- **`functions/` deploys separately** via `firebase deploy --only
  functions` and needs the Blaze plan — mention this if a change
  touches scheduled functions.
- **No secrets to protect beyond what's already public.** The Firebase
  web config in `firebase-config.js` is meant to be public (security is
  rules-based). There are no `.env` files or server-side secrets in
  this repo. Do not add real credentials, service-account JSON, or
  private keys to any file here.

## Open items noted in the README (check before assuming they're resolved)

- Whether a day with check-ins in multiple cities should update the
  tagged city badge, or always stay fixed to the first reading.
- No editing/deleting of entries after they're saved yet.
- CSS mobile-first pass was done by audit (44px targets, 16px inputs,
  no horizontal scroll at 320-390px) — not verified with an actual
  rendered/screenshot test, since this environment has no headless
  browser. Worth a manual check (DevTools device toolbar or a real
  phone) after any layout change.

## Working in this repo via GitHub MCP

Claude has read/write access to `Home-SF/day2day` through the GitHub
MCP tools (`get_file_contents`, `create_or_update_file`, `push_files`,
etc.) and can commit directly. Per standing guardrails, this covers
ordinary file reads/edits/commits; anything destructive (force-pushes,
deleting branches, changing repo/security settings) or any action
outside the repo (e.g. touching Firebase project settings) should still
be confirmed with the user first.
