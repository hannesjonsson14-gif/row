# Personal Dashboard

A set of small, self-contained HTML apps that share a top bar.

## Deploy your own copy

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fhannesjonsson14-gif%2Frow)

One click → Vercel signs you in, copies the repo to your GitHub, and deploys it. ~30 seconds to a live URL.

## How to use

Open any `.html` file directly in your browser — no build step, no install.

| File | What it is |
|---|---|
| [index.html](index.html) | Goals tracker (Day Ring, Goal Ticker, To Do list) — the home page |
| [health.html](health.html) | Supplement / daily stack tracker |
| [po-water.html](po-water.html) | Water intake tracker |
| [finance.html](finance.html) | Finances |
| [food.html](food.html) | Calorie & macro tracker (week strip, meals, food search, saved foods/meals, targets) |
| [gym.html](gym.html) | Progressive overload gym tracker — Anterior / Posterior program |
| [topbar.js](topbar.js) | Shared top bar and tab bar — auto-injected into pages that `<script src="topbar.js">` |
| [sync.js](sync.js) | Shared cloud sync — `initCloudSync({ appKey, syncedKeys, syncedPrefixes, onApplied })` |

Each app stores its state in browser `localStorage`, so everything works offline.

## Cloud sync

`sync.js` mirrors each page's keys to one Supabase table, `app_state` (`key`, `data`, `updated_at`): one row per app (`health`, `food`, `goals`, `finance`), with `data = { localStorageKey: value }`. `gym.html` syncs its own `po-coach` row inline.

- A page only writes the keys it changed, merged into the row as it is right now, so it never touches keys of the row it doesn't sync (Main also syncs the `food` row, and the top bar's water `+` writes into the `health` row).
- Edits made offline are remembered (`__rowsync_dirty:<app>` in localStorage) and pushed on the next load; they win over the cloud copy instead of being overwritten.
- A failed read never counts as "no cloud data": nothing is pushed or deleted until a read works (retried with backoff).
- A pull never deletes a local key. Keys the row never had are added to it; a key another device deleted (`__rowsync_known:<app>` remembers which keys the row has had) isn't pushed back.
- Changes from other devices arrive in realtime; pages re-render on `onApplied` and the `row-sync-applied` event.
- The water `+` in the top bar merges only `po_water_v1` into the `health` row (`window.rowSync.mergePush`), and its Undo toast takes the drinks back out. Its daily goal is the same formula and defaults as `po-water.html`.

There are no accounts: the publishable key in `sync.js` and `gym.html` is enough to read and write the table, so treat the data as not private until Supabase Auth and row-level security are added.

## Building from scratch

[BUILD_DASHBOARD.md](BUILD_DASHBOARD.md) is the prompt I gave Claude to generate `index.html` — paste it into Claude if you want to rebuild that page yourself.

## iPhone app

[ios/](ios) wraps these pages in a small native app (a web view with the pages bundled in). The build copies `../*.html`, `topbar.js` and `sync.js` into the app, so the repo stays the single source of truth.

1. `open ios/Row.xcodeproj`
2. Pick your iPhone as the run destination and press Run (signing: team `JRH46HXFZR`, edit `ios/project.yml` for a different one).
3. After editing `ios/project.yml`: `cd ios && xcodegen generate`.

The app has its own storage, separate from Safari; data moves between them only through cloud sync. Export JSON (Fitness and Water settings) opens the share sheet, so a backup can go to Files, AirDrop or Mail.
