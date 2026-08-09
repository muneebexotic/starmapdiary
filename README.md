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

Set `STREAK_GRACE_ENABLED=false` to disable automatic rest days and use strict
consecutive-day counting.

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
