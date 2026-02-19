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
   - `SUPABASE_PROJECT_REF`
   - `SUPABASE_ACCESS_TOKEN` (for MCP tooling)

## 2) Apply DB schema
Run SQL in Supabase SQL editor (or via MCP):
- `supabase/schema.sql`

## 3) Run app
```bash
npm install
npm start
```
Open `http://localhost:3000`.

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
