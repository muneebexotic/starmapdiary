# Star Map Diary (Supabase + Express)

This setup uses:
- Supabase Auth (email/password)
- Supabase Postgres (`diary_entries` with RLS)
- Express API for auth/session/token validation and entry CRUD
- Existing Three.js SPA frontend served by Express

## Why Express for this use case
- Keeps auth/session flow and validation centralized as the app grows.
- Avoids exposing business logic in the browser while still using Supabase RLS.
- Makes it easier to add rate limiting, audit logs, moderation, or billing later.

## 1) Configure env
1. Copy `.env.example` to `.env`
2. Fill values:
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
   - `PUBLIC_SITE_URL` (where confirmation emails land — see "Email confirmation" below)
   - `SUPABASE_SERVICE_ROLE_KEY` (required for cron reminder dispatch)
   - `SUPABASE_PROJECT_REF`
   - `SUPABASE_ACCESS_TOKEN` (for MCP tooling)
   - `CRON_SECRET`
   - `VAPID_PUBLIC_KEY`
   - `VAPID_PRIVATE_KEY`
   - `VAPID_SUBJECT`
   - `REMINDERS_ENABLED=true|false`

## 2) Apply DB schema
Run SQL in Supabase SQL editor (or via MCP):
- `supabase/schema.sql`

## 3) Run app
```bash
npm install
npm start
```
Open `http://localhost:3000`.

## Run tests
```bash
npm test
```
Uses the built-in Node test runner — no extra dependencies.

## Project structure
- `src/`: backend app layers
- `src/config`: environment parsing and validation
- `src/lib`: Supabase client factories/helpers
- `src/middleware`: cross-cutting request middleware
- `src/domain`: domain validation/normalization logic
- `src/routes`: API route modules by bounded context
- `src/services`: feature logic (`reminders`, `streaks`)
- `docs/`: feature design documents
- `test/`: unit tests
- `public/`: frontend static assets served by Express
- `public/js`: browser code split by concern (`config`, `services`, `features`, `three`)
- `public/styles`: CSS assets

This separation keeps transport, business rules, and infrastructure decoupled, so features can be changed without rewriting unrelated layers.

## Streaks
`GET /api/streak` returns the signed-in user's journaling streak. Send the browser's IANA
timezone as an `X-Client-Timezone` header so a first-ever load is correct before reminder
settings exist.

The streak is derived from `diary_entries` on every read rather than stored as a counter, so
existing history counts immediately and no backfill is needed. Design rationale, UX research
and the remaining phases are in `docs/streaks-frd.md`.

`POST /api/entries` returns the recomputed streak alongside the saved entry, so the client can
extend the constellation trail and update the count without a second request. Consecutive
journalling days are joined by a gold trail in the galaxy — the streak is something you watch
yourself draw, not just a number.

`PUT /api/streak/settings` with `{ "visible": false }` hides every streak surface. The streak
keeps accruing while hidden, so turning it back on shows the real value. Users re-enable it
from the "Show streaks" link in the date filter panel.

Set `STREAK_GRACE_ENABLED=false` to disable automatic rest days and use strict
consecutive-day counting.

## Email confirmation

A new account is held by Supabase until its address is confirmed, so sign-up finishes in an
inbox rather than on the page. Three things have to agree or the link goes somewhere useless:

1. `PUBLIC_SITE_URL` in this app's environment — sent as `emailRedirectTo` on signup and resend.
2. **Site URL** in Supabase → Authentication → URL Configuration — the fallback when a request
   carries no redirect, and the source of the `http://localhost:3000` links you get by default.
3. **Redirect URLs** in the same screen — an allow-list. A `emailRedirectTo` that isn't listed
   is silently ignored in favour of the Site URL, which is why a correct `PUBLIC_SITE_URL` can
   still appear to do nothing.

The link is verified by Supabase, which then redirects to the site with the finished session in
the URL fragment (implicit flow — `src/lib/supabase.js` pins `flowType: "implicit"` because the
sign-up call happens on this server while the link is opened in the reader's browser, so a PKCE
verifier would have nowhere to meet its code). `readAuthHandoff()` in `public/js/app.js` reads
that fragment, wipes it from the address bar, and boots straight into a signed-in app.

- `POST /api/auth/signup` returns `{ confirmationSent: true, session: null }` when the address
  needs confirming. An already-registered address returns exactly the same shape, so sign-up
  can't be used to test which addresses have accounts.
- `POST /api/auth/login` returns `403 { needsConfirmation: true }` for an unconfirmed address
  rather than a generic 401, so the client can offer another mail instead of a dead end.
- `POST /api/auth/resend-confirmation` sends another link. It reports success for everything
  except a rate limit, for the same privacy reason as signup.

Supabase's built-in SMTP only delivers to addresses on the project's team and is capped at a
couple of messages an hour. Configure custom SMTP before real users sign up, or their
confirmation mail is never sent at all.

## 4) Supabase MCP
Installed package:
- `@supabase/mcp-server-supabase`

Example MCP config:
- `supabase/mcp-config.example.json`

Run manually:
```bash
npx -y @supabase/mcp-server-supabase@latest --project-ref YOUR_PROJECT_REF
```
with env var `SUPABASE_ACCESS_TOKEN` set.

## 5) Reminder System
- APIs:
  - `GET /api/reminders/status`
  - `PUT /api/reminders/settings`
  - `GET /api/reminders/push/public-key`
  - `POST /api/reminders/push/subscribe`
  - `POST /api/reminders/push/unsubscribe`
  - `POST|GET /api/cron/reminders-dispatch` (protected by cron secret)
- For production, set `CRON_SECRET` in Vercel so scheduler requests are authorized.

### External Scheduler (cron-job.org)
Use cron-job.org to trigger reminders every 15 minutes on Vercel Hobby:
- URL: `https://YOUR_DOMAIN/api/cron/reminders-dispatch`
- Method: `POST`
- Header: `Authorization: Bearer YOUR_CRON_SECRET`
- Schedule: every 15 minutes

After setup, trigger one manual run and verify response includes:
- `{ "ok": true, "counters": ... }`
