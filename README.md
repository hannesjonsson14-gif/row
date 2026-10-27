# Personal Dashboard

A set of small, self-contained HTML apps that share a top bar.

## Deploy your own copy

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FRowanThistlebrooke%2FYTdashh1)

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
| [topbar.js](topbar.js) | Shared top bar — auto-injected into pages that `<script src="topbar.js">` |

Each app stores its own state in browser `localStorage`. No accounts, no server.

## Building from scratch

[BUILD_DASHBOARD.md](BUILD_DASHBOARD.md) is the prompt I gave Claude to generate `index.html` — paste it into Claude if you want to rebuild that page yourself.

## iPhone app

[ios/](ios) wraps these pages in a small native app (a web view with the pages bundled in). The build copies `../*.html`, `topbar.js` and `sync.js` into the app, so the repo stays the single source of truth.

1. `open ios/Row.xcodeproj`
2. Pick your iPhone as the run destination and press Run (signing: team `JRH46HXFZR`, edit `ios/project.yml` for a different one).
3. After editing `ios/project.yml`: `cd ios && xcodegen generate`.

The app has its own storage, separate from Safari; data moves between them only through cloud sync.
