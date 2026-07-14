# Field Log

A static site for logging the mundane, day-to-day stuff — text notes, GPS
check-ins, and photos — organized as Year → Month → Day pages. Built to
reuse the same Firebase project as your Paris/London trip site (its own
Firestore collections + Storage folder, so nothing collides).

## Before it works: 3 setup steps

**1. Create a new, dedicated Firebase project**
This site now runs on its own Firebase project — fully separate from
the Paris/London and Tokyo/KL/Singapore trip sites, since those are
shared with family and this one is personal. At
[console.firebase.google.com](https://console.firebase.google.com),
create a new project (e.g. "field-log"), then go to Project Settings →
General → "Your apps" → add a Web app → copy the config object into
`firebase-config.js`, replacing the `REPLACE_ME` values.

**2. Turn on Firestore + Storage for this project**
Build → Firestore Database → Create database; Build → Storage → Get
started. This app writes to `activityLog_days` (and its `entries`
subcollections) and the `activityLogPhotos/` storage folder — the
prefixes aren't strictly needed anymore now that the project is
dedicated, but they're kept as-is so the code didn't need reworking.

**3. Security rules**
Since this is personal/private (unlike the trip sites, which are meant
to be shared with family), lock it down to just you. The app has a
Google sign-in screen (see below) so `request.auth` will be populated —
paste this into Firestore Rules and Storage Rules, swapping in your
email:

```
// Firestore rules
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /activityLog_days/{dayId} {
      allow read, write: if request.auth != null && request.auth.token.email == "YOUR_EMAIL_HERE";
      match /entries/{entryId} {
        allow read, write: if request.auth != null && request.auth.token.email == "YOUR_EMAIL_HERE";
      }
    }
  }
}
```

```
// Storage rules
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /activityLogPhotos/{allPaths=**} {
      allow read, write: if request.auth != null && request.auth.token.email == "YOUR_EMAIL_HERE";
    }
  }
}
```

**4. Enable Google as a sign-in provider**
Build → Authentication → Get started → Sign-in method → Google → Enable.
That's it — the app itself now shows a sign-in screen on load and won't
render the log until someone signs in. Your security rules (above) do
the actual enforcement by checking `request.auth.token.email` — the
sign-in screen just gets a `request.auth` populated in the first place.
Anyone can still click "Sign in with Google" from the sign-in screen,
but only the email address named in your rules will actually be able to
read or write data; anyone else sees a friendly "access denied" toast.

## Auto-creating tomorrow's page at midnight

`functions/` contains a scheduled Cloud Function (`createTomorrowsDayPage`)
that runs at midnight every night and creates the next day's Firestore
doc ahead of time, so the page already exists when you open it rather
than being created on first visit. The client-side lazy-creation logic
in `app.js` is kept as a fallback (e.g. for the very first day, before
you've deployed the function) — it only fires if a day doc isn't
already there.

**This needs the Blaze (pay-as-you-go) plan** — scheduled functions
run on Cloud Scheduler, which isn't available on the free Spark plan.
In practice a single function running once a day costs pennies a
month, but it's a new project, so it'll start on Spark by default and
need to be upgraded before this will deploy.

To deploy:

```
npm install -g firebase-tools   # if you don't already have it
cd activity-log-site
firebase login
firebase use --add              # pick your new dedicated Field Log project
cd functions && npm install && cd ..
firebase deploy --only functions
```

The function defaults to `America/Los_Angeles` for figuring out when
"midnight" is — change `TIME_ZONE` at the top of `functions/index.js`
if you're usually logging from somewhere else.

**Note on weather/city**: the scheduled function only creates an empty
day doc — it doesn't (and can't) capture weather or a city tag ahead
of time, since those depend on your device's GPS location, which only
exists once you actually open the page. Those still populate lazily on
first visit, same as before.

## Running it locally

Because the app uses ES module imports, opening `index.html` directly
(`file://`) won't work — serve it over http:

```
cd activity-log-site
python3 -m http.server 8000
```

Then visit `http://localhost:8000`.

## Deploying

Same as the trip site: push this folder to a GitHub repo and enable
GitHub Pages on it (or add it as a second folder/branch if you want it
under the same repo).

## What's implemented

- **Hierarchy**: `#/2026` (year) → `#/2026/7` (month) → `#/2026/7/13`
  (day page), all client-side routed off the URL hash.
- **Day page**: title with day-of-week + week number, a tagged city
  badge, a noon weather badge, a text composer, check-in button, and
  photo upload (camera roll or live capture on mobile).
- **City tag & weather**: both captured automatically, once, the first
  time a day page is opened with no existing data — using the browser's
  geolocation. Weather is fetched from Open-Meteo (no API key needed):
  the archive API for past dates, the forecast API for today, pulling
  the reading closest to noon and freezing it in Firestore so it never
  changes on later visits.
  - **Assumption**: I used Open-Meteo for weather and BigDataCloud's
    free reverse-geocoding endpoint for the city name, since neither
    needs an API key — let me know if you'd rather use a specific
    weather/geocoding provider (e.g. one you're already using on the
    trip site).
- **Check-ins**: each click stores a fresh GPS reading + place name as
  its own timeline entry, rendered as a postmark-style stamp.
- **Timeline**: text, check-ins, and photos all merge into one
  chronological feed per day.
- **Lazy day creation**: day documents are created on first visit/entry,
  not pre-generated — so the month/day grids show empty cells for days
  with nothing logged yet, and you can jump to any date.

## Mobile-first pass

The CSS is now written mobile-first: the default (unqueried) styles
target a ~360-390px phone width, and a single `@media (min-width: 600px)`
block layers on roomier spacing/type for tablet and desktop — nothing
is hidden or reworked at the small end, larger screens just get more
breathing room. Specifically:

- All buttons and links are at least 44px tall (comfortable thumb
  targets), and the composer's Check-in / Add photo / Save controls
  stack full-width on phones instead of being squeezed into a row.
- The entry textarea uses 16px type — under 16px, iOS Safari zooms
  the whole page in on focus, which is disorienting on a form like this.
- Year/month/day grid cards, the timeline, and photo heights all use
  smaller spacing on phones and expand at the 600px breakpoint.
- `viewport` meta tag with `width=device-width, initial-scale=1.0` was
  already in place so the browser doesn't fake a desktop-width canvas.

**I don't have a way to screenshot-test this from here** (no headless
browser in this environment) — the changes are based on a CSS audit
against standard mobile guidelines (44px tap targets, 16px inputs,
no horizontal scroll at 320-390px widths), not a rendered check. Worth
verifying yourself once it's running: Chrome DevTools' device toolbar
(Cmd/Ctrl+Shift+M) at a few widths (iPhone SE ~375px is a good small
baseline), or just load it on your phone once deployed.

## Open questions for next pass

- Sign-in screen (see security rules note above)
- Whether a day with multiple check-ins in different cities should ever
  update the "tagged city" badge, or if that should always stay fixed
  to the first reading of the day
- Editing/deleting entries after the fact
