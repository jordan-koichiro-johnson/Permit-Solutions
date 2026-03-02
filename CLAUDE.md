# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm start        # Production (node src/app.js, PORT=3000)
npm run dev      # Development with file watching (nodemon src/app.js)
```

No build step, no test runner, no linter configured. The app is plain Node.js with no transpilation.

## Architecture

Single-process Express app: HTTP server, SQLite DB, background scheduler, and email notifier all run together.

**Request flow:**
- Frontend (SPA in `public/`) calls REST API endpoints
- Routes (`src/routes/`) delegate to service layer or DB queries directly
- Checker service (`src/services/checker.js`) orchestrates: fetch permit → scrape → diff → save → notify
- Scheduler (`src/services/scheduler.js`) runs `checkAllPermits()` on a cron schedule (default every 4 hours)

**Data flow for a permit check:**
1. `checkPermit(id)` gets permit from DB, instantiates scraper, calls `scraper.checkStatus(permitNumber)`
2. Compares returned status to `permits.current_status`
3. Always inserts a `status_history` row; only updates `permits` if status changed
4. After batch check, `notifier.sendChangeReport()` if any changed

## Database

SQLite via `better-sqlite3` (WAL mode). DB auto-created at `data/permits.db` on first run.

Three tables: `permits`, `status_history`, `settings`. All queries are in `src/db/queries.js` as prepared statements — do not write raw SQL elsewhere. Schema defined in `src/db/index.js`.

## Scraper Pattern

All scrapers extend `BasePermitScraper` (`src/scrapers/base.js`) and must implement:
- `get name()` — lowercase hyphenated key (e.g. `'everett-wa'`)
- `get displayName()` — UI label
- `async checkStatus(permitNumber)` — returns `{ status, details, url }`

Register new scrapers in `src/scrapers/index.js`. The UI dropdown populates automatically from `listScrapers()`.

`example-city.js` is the demo scraper (no real browser, deterministic fake data via hash). `everett-wa.js` is a real Playwright implementation requiring `EVERETT_WA_USERNAME` and `EVERETT_WA_PASSWORD` env vars.

## Environment Variables

Copy `.env.example` to `.env`. Key vars:
- `PORT` (default 3000)
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM`, `EMAIL_TO` — email config (optional)
- `CHECK_INTERVAL_HOURS` — scheduler cadence (default 4)
- `EVERETT_WA_USERNAME`, `EVERETT_WA_PASSWORD`, `EVERETT_WA_CONTRACTOR_NAME` — Everett portal credentials

Email is not required; the app runs fully without it.

## Known Gotchas

- **No auth** — single-user assumption; no login/session management
- **Windows + Node v18** — avoid `/dev/stdin` in scripts; use `.env` or CLI args instead
- **Cron comments** — JSDoc block comments (`/* ... */`) inside cron schedule strings cause `SyntaxError`; use `//` comments
- **smtp_pass masking** — settings API returns `'••••••••'` for the password; the PUT handler ignores it if unchanged, so don't overwrite with the placeholder
- **Playwright** — scraper instances must `await browser.close()` in all code paths to avoid leaked processes
- **Bulk import** (`src/scripts/import-everett.js`) uses raw Node `https` with a manual cookie jar — no Playwright
