# Feature Requirement Document — Streaks ("Constellation Streak")

| Field | Value |
| --- | --- |
| Feature | Daily journaling streaks for Star Map Diary |
| Status | Phases 1–2 implemented (engine + quiet UI) — Phases 3–4 not started |
| Author | Design + engineering spec |
| Date | 2026-08-09 |
| Related systems | `diary_entries`, `reminder_settings`, `/api/reminders/*`, `SceneManager` constellation layer |

---

## 1. Summary

Add a streak system that counts **consecutive local calendar days on which the user wrote at least one diary entry**.

The defining constraint of this design: the streak is **derived from entry history, never incremented from a launch date**. A user who has journaled for the last 10 days sees `10` the first time they open the app after this ships, and `11` after today's entry — not `0`. This is not a migration or a backfill job; it falls out of computing the streak from `diary_entries` on every read (see §6).

The second defining constraint: Star Map Diary is a private, emotionally-loaded product. Research on streaks in journaling and mental-health apps (§3) is consistent that punitive streak mechanics produce guilt, shallow "streak-saving" entries, and eventual abandonment. This spec therefore adopts **gentle gamification**: the streak is visible but never shouty, breaks are soft, the longest streak is never erased, and the whole system can be switched off.

---

## 2. Goals and non-goals

### 2.1 Goals

| ID | Goal | Measure |
| --- | --- | --- |
| G-1 | Increase the proportion of users who write on consecutive days | D7 / D30 return rate; % of active users with `current_streak >= 3` |
| G-2 | Give existing users immediate credit for the history they already have | 100% of users with a qualifying history see a non-zero streak on first load post-launch, with zero manual migration |
| G-3 | Make consistency legible inside the galaxy metaphor rather than bolting a generic "🔥 12" chip onto it | Qualitative; streak surface is diegetic (constellation trail) |
| G-4 | Do not manufacture guilt | Streak opt-out rate < 5%; no increase in churn in the 7 days after a streak break vs. control |
| G-5 | Correctness across timezones and DST | Zero streak-correctness defects in QA matrix (§11) |

### 2.2 Non-goals (explicitly out of scope for v1)

- Social streaks, leaderboards, friend comparison, sharing.
- Paid or purchasable streak freezes / streak repair as a monetised item.
- Backdating: letting a user write an entry "for yesterday" to repair a gap. (Discussed in §12 as an open question — it conflicts with the honesty of a diary.)
- Streak-based push notification escalation ("Your 47-day streak dies in 2 hours!"). See §9 for what we do instead.
- Weekly / "N days per week" goal variants.
- Streak as a gate on any feature. Nothing is ever locked behind a streak.

---

## 3. UX research

### 3.1 Why streaks work

Streaks convert a diffuse intention ("I should journal more") into a concrete, countable asset the user owns. The mechanism is **loss aversion**: people weigh the loss of a 100-day streak far more heavily than the gain of a 101st day, so the streak becomes "a trophy worth protecting" ([Smashing Magazine](https://www.smashingmagazine.com/2026/02/designing-streak-system-ux-psychology/), [Bootcamp](https://medium.com/design-bootcamp/designing-for-user-retention-the-psychology-behind-streaks-cf0fd84b8ff9)).

Importantly, this isn't only an engagement trick. Duolingo's retention research found that **consecutive daily activity produces stronger habit formation than the same volume of activity spread unevenly across a week** — which is a genuine behaviour-change argument for the consecutive-day framing, not just a metrics argument ([Lenny's Podcast summary](https://www.getrecall.ai/summary/lennys-podcast/behind-the-product-duolingo-streaks-or-jackson-shuttleworth-group-pm-retention-team)).

The retention curve is front-loaded: the jump **from a 1-day to a 2-day streak is the single largest retention step**, with gains continuing but flattening after roughly day 7. Duolingo has run 600+ experiments on this one surface.

**Implication for us (F-1):** the early milestones matter most. If the first celebration is at 30 days, most users quit before ever seeing one. Milestones must start at 3 days.

### 3.2 Why streaks fail — and fail hardest in journaling apps

This is the risk area, and the literature is blunt about it.

- **Streaks reward showing up, not reflecting.** A three-word entry typed at 23:58 to save a streak earns exactly the same reward as a thoughtful one. Over time this trains the user to produce junk, and the diary stops being worth re-reading ([Daylogue](https://daylogue.com/learn/journaling-app-guilt)).
- **Gamified feedback increases anxiety, guilt, dependency and burnout**, disproportionately for users with depression, anxiety or perfectionist tendencies — precisely the population most drawn to a reflective journaling app ([HEAD Foundation digest](https://digest.headfoundation.org/2025/09/21/winning-at-what-cost-the-psychology-of-gamification-and-the-fight-for-our-focus/), [Unstar](https://unstar.app/blog/mental-health-app-reviews-what-users-say-about-wellbeing-apps-2026)).
- **A hard reset to zero drives abandonment rather than restart.** Users who lose a long streak frequently churn instead of beginning again ([Smashing Magazine](https://www.smashingmagazine.com/2026/02/designing-streak-system-ux-psychology/)).
- **"You missed your session!" notifications measurably make anxiety worse.** Guilt-framed reminders are the most-complained-about pattern in mental-health app reviews.
- Apps regarded as handling this well (e.g. Balance) **de-emphasise the streak in the UI and never send guilt-inducing notifications** — the pattern the sources call "gentle gamification": track progress, don't punish breaks.

**Implication for us (F-2):** the streak must be a *quiet* surface — glanceable, never the visual focus, never modal on open, never the subject of a reminder's headline. **(F-3)** breaking must be soft and recoverable. **(F-4)** it must be possible to turn the whole thing off, and that setting must be easy to find, not buried.

### 3.3 Safety nets: what the successful implementations actually do

There is strong convergence here. A **limited number of freezes / grace days reduces churn from users who missed a day for a legitimate reason while preserving the loss-aversion mechanic** ([AppStorys](https://appstorys.com/blog-Streaks-Milestones-Habit-Gamification), [Smashing](https://www.smashingmagazine.com/2026/02/designing-streak-system-ux-psychology/)). Duolingo A/B-tested raising the allowance from one freeze to two or three and saw **significant increases in DAU retention and return rate** — the freeze did not devalue the streak, it protected it.

The framing matters as much as the mechanic: freezes/grace should read as *the system being on your side*, not as a consolation prize.

**Implication for us (F-5):** ship a grace mechanism, earned automatically, never purchased, never begged for.

### 3.4 Timezones are the #1 source of streak bugs

Streak logic is "deceptively complex": timezone handling, DST transitions, freeze logic and period boundaries each add edge cases that are hard to test exhaustively ([Trophy](https://trophy.so/blog/streak-timezone-dst-handling)). The canonical failure: a user in Sydney writes at 23:55 local, a UTC server calls it tomorrow, and the streak breaks. Timezone mishandling is reported as **the most common category of support ticket** for consumer apps with a global user base.

The recommended discipline is: store a per-user IANA timezone, convert every streak computation into user-local dates, store deadline timestamps in UTC, and render deadlines client-side.

**Implication for us (F-6):** we already store `reminder_settings.timezone` (an IANA zone, synced by `ReminderManager.start()` on every session) and already use Luxon server-side. The streak engine must reuse that exact machinery — not `new Date()` on the server.

### 3.5 Day-one behaviour for existing users

Two strategies exist in the wild: **fresh start** (everyone begins at zero when the feature ships — e.g. Skio) and **historical backfill** (compute from existing activity — e.g. Buffer, which pulls recent post history and calculates streaks from it).

Fresh start is chosen when the historical data isn't available or trustworthy. **We have complete, timestamped, per-user history in `diary_entries`.** Choosing fresh start here would actively punish the most loyal users — a user 200 days into a private journalling habit being told "Streak: 0" is a credibility failure the feature may not recover from.

**Implication for us (F-7):** retroactive is mandatory, and the cleanest way to guarantee it is architectural — never store an incrementing counter as the source of truth (§6).

### 3.6 Competitive teardown

| Product | Grace mechanic | Reset behaviour | Prominence | What we take / leave |
| --- | --- | --- | --- | --- |
| Duolingo | Earned + purchasable freezes (2–3), streak repair | Hard reset, heavily merchandised | Very high — flame in permanent nav, aggressive push | Take: earned freeze, early milestones, freeze count tuning. Leave: purchase pressure, guilt push. |
| Snapchat | Hourglass warning, manual restore via support | Hard reset | Very high, social | Leave almost all of it — social streak pressure is the canonical dark pattern. |
| Apple Fitness rings | None (monthly award framing) | Soft — history stays visible in the calendar grid | Medium, glanceable | Take: the *history grid*. A month of filled days is motivating without a number shouting. |
| Strava | None | Soft | Low | Take: low prominence for a tool people use for other reasons. |
| Balance / calm-first apps | N/A | Soft | Deliberately low | Take: the whole posture — quiet surface, no guilt notifications. |
| Buffer | N/A | Soft | Low | Take: backfill-from-history model. |

### 3.7 Research summary → design principles

| # | Principle | Source finding |
| --- | --- | --- |
| P-1 | **Retroactive by construction.** History defines the streak; the launch date is irrelevant. | F-7 |
| P-2 | **Quiet by default.** Glanceable, peripheral, never modal on open, never the largest thing on screen. | F-2 |
| P-3 | **Soft failure.** One missed day is bridged; a real break preserves and re-frames the longest streak. Never render a bare "0". | F-3, F-5 |
| P-4 | **Reward the sky, not the number.** The primary reward is the constellation the user is visibly building; the integer is secondary. | F-2 + the product's existing metaphor |
| P-5 | **Early wins.** First milestone at 3 days. | F-1 |
| P-6 | **Escapable.** One toggle hides everything, permanently, without losing the underlying data. | F-4 |
| P-7 | **Correct in the user's timezone, always.** | F-6 |
| P-8 | **Never trade entry quality for streak length.** No mechanic may reward volume, speed or minimum-length entries. | F-2 |

---

## 4. Streak definition (normative rules)

These are the authoritative rules. Every one is testable.

| ID | Rule |
| --- | --- |
| **S-1** | A **qualifying day** is a local calendar date on which the user has ≥ 1 row in `diary_entries`. Multiple entries on one date count once. There is no minimum length, word count, or sentiment requirement (P-8). |
| **S-2** | The **local date** of an entry is `(created_at AT TIME ZONE <user_tz>)::date`, where `<user_tz>` is the user's current IANA timezone (§7.2). Timezone resolution is a single value applied to the whole history — we do not attempt to reconstruct where the user physically was on each past day. |
| **S-3** | **The current streak counts through yesterday.** If today has no entry yet, the streak is the run of qualifying days ending yesterday, and its state is `active_pending`. Today's absence does **not** reduce it. This is the rule naive implementations get wrong. |
| **S-4** | A streak **breaks** only once a full local day has elapsed with no entry — i.e. when `today - last_qualifying_date > 1 day` (before grace, §5). |
| **S-5** | `longest_streak` is the maximum run length over the user's entire history, including runs that ended long ago, and including the current run. It is monotonic — it never decreases. |
| **S-6** | The streak is **computed from history on every read** (§6). No counter is incremented in place. Deleting an entry, or an entry arriving out of order, self-heals on the next read. |
| **S-7** | The day boundary is midnight in the user's timezone. There is no configurable "my day ends at 3am" setting in v1 (§12, open question O-2). |
| **S-8** | A user with zero entries has `current = 0`, `longest = 0`, and the streak UI is hidden entirely (§8.7) — a new user is never shown a zero. |

### 4.1 Worked example — the retroactive requirement (G-2)

User's timezone is `Asia/Karachi`. They have written one entry per day on **31 Jul → 09 Aug** (10 days). The streak feature ships on **09 Aug**. Today is **10 Aug**, 09:00 local, and they have not yet written.

| Moment | `current` | State | UI |
| --- | --- | --- | --- |
| 10 Aug 09:00, before writing | **10** | `active_pending` | "10 nights" — today is still open |
| 10 Aug 09:05, after writing | **11** | `active_today` | Trail extends, count animates 10 → 11 |
| 11 Aug 00:01, still not written | **11** | `active_pending` | unchanged |
| 11 Aug 22:00, still not written | **11** | `at_risk` (§8.4) | gentle amber state, one nudge |
| 12 Aug 00:01, 11 Aug never written | **11**, grace applied | `grace_used` | "Rest day used — your streak is intact" |
| 13 Aug 00:01, neither 11 nor 12 written | **0** current, **11** longest | `broken` | "Longest: 11 nights. Tonight starts the next one." |

Rows 1 and 2 are the user's stated requirement, and they hold **without any migration script**, because of S-6.

---

## 5. Grace ("rest day")

Named **rest day** in all user-facing copy — not "freeze", not "streak saver". The framing is permission, not rescue.

| ID | Rule |
| --- | --- |
| **R-1** | A single missed day inside a run is bridged automatically, without user action, if a rest day is available at that point in the run. |
| **R-2** | **Availability is deterministic and history-derived**: scanning the run backwards from the most recent qualifying day, a one-day gap may be bridged only if no other gap has been bridged within the previous 7 qualifying days of that same run. This makes the whole computation replayable from history alone — a stateful "freezes remaining" ledger would break S-6 and re-introduce the launch-date problem. |
| **R-3** | Two or more consecutive missed days always break the streak. Rest days never chain. |
| **R-4** | Rest days are never purchasable, never requestable, and never advertised before they are used — advertising them invites gaming and turns a safety net into a mechanic. |
| **R-5** | After a rest day is consumed the user is told, once, calmly, and only when they next open the app: *"You took a rest day on Tue — your streak carried over."* |
| **R-6** | Behind the flag `STREAK_GRACE_ENABLED` (default `true`). Disabling it yields strict consecutive-day semantics with no other behavioural change. |

Rationale: this reproduces the tested benefit of Duolingo's freeze allowance (§3.3) at roughly "one rest day per week", while remaining a pure function of entry history.

---

## 6. Architecture decision: derived, not stored

**Decision:** the streak is a **projection over `diary_entries`**, computed on read. There is no authoritative `users.current_streak` column that gets `+1`'d.

**Why this is the single most important decision in the document:**

| Consequence | Derived (chosen) | Stored counter (rejected) |
| --- | --- | --- |
| Existing users on launch day | Correct automatically (G-2) | Requires a backfill migration; every user added between writing and running it is wrong |
| Entry deleted | Self-heals next read | Counter drifts permanently |
| User changes timezone | Recomputes correctly | Needs bespoke reconciliation |
| Grace logic changed later | Recomputes the whole history under the new rule | Historic values frozen under the old rule; inconsistent |
| Cost | O(distinct days) scan per read | O(1) |

The cost objection does not apply here: this is a one-entry-per-day product, so a five-year power user has ~1,800 rows, and `diary_entries_user_id_created_at_idx` already covers the access pattern. If it ever matters, add the cache in §7.4 — a cache is safe precisely because the derivation stays authoritative.

**Caching is deliberately deferred to Phase 3.** Do not build it in v1.

---

## 7. Technical design

### 7.1 Data model

**No schema change is required for v1.** The streak reads `diary_entries` and `reminder_settings.timezone`, both of which exist.

Two additions are proposed:

```sql
-- Per-user streak preferences (opt-out, P-6; and milestone dedupe)
create table if not exists public.streak_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  visible boolean not null default true,
  celebrated_milestones int[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.streak_settings enable row level security;

drop policy if exists "streak_settings_select_own" on public.streak_settings;
create policy "streak_settings_select_own"
  on public.streak_settings for select using (auth.uid() = user_id);

drop policy if exists "streak_settings_upsert_own" on public.streak_settings;
create policy "streak_settings_upsert_own"
  on public.streak_settings for insert with check (auth.uid() = user_id);

drop policy if exists "streak_settings_update_own" on public.streak_settings;
create policy "streak_settings_update_own"
  on public.streak_settings for update
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
```

`celebrated_milestones` exists so a milestone celebration fires exactly once per user per milestone even though the streak itself is stateless. It is presentation state, not streak state — losing it would only re-show a celebration, never change a number.

### 7.2 Timezone resolution (P-7)

Resolution order, applied server-side, per request:

1. `reminder_settings.timezone` for the user, if present and valid per `validateTimezone()`.
2. The `X-Client-Timezone` request header (IANA string sent by the frontend), if valid — covers users who have never had reminder settings written.
3. `"UTC"`.

`ReminderManager.start()` already PUTs the browser's resolved zone to `/api/reminders/settings` on every session start, so (1) covers essentially all returning users. The frontend must additionally send the header on `/api/streak` and `POST /api/entries` so a first-ever load is correct before that PUT lands.

**Reuse, do not reimplement:** `src/services/reminders/time.js` already provides `validateTimezone`, `getLocalNow` and `toUtcBoundsForLocalDate`. The streak service must use them.

### 7.3 Computation

Fetch the distinct local dates, then fold in JS with Luxon. A `security invoker` RPC keeps the timezone conversion in Postgres (correct, index-friendly) while RLS still scopes rows to the caller:

```sql
create or replace function public.entry_local_dates(tz text)
returns table (local_date date)
language sql
stable
security invoker
as $$
  select distinct (created_at at time zone tz)::date as local_date
  from public.diary_entries
  order by 1;
$$;
```

Called from the user-scoped client: `scopedClient.rpc("entry_local_dates", { tz })`.

Fold (new module `src/services/streaks/compute.js`), given the ascending date list and `todayLocal`:

```
lastDate      = dates[last]
if none            -> { current: 0, longest: 0, state: "empty" }

// walk backwards accumulating the current run, bridging single gaps per R-2
current = run length ending at lastDate, with single-day gaps bridged
          when no bridge was used in the prior 7 qualifying days of the run

// S-3 / S-4: is that run still alive?
gapDays = todayLocal - lastDate
  0 -> state = "active_today"
  1 -> state = "active_pending"   (becomes "at_risk" in UI after a local-time threshold, §8.4)
  2 -> state = "grace_used"  and current stays intact, if grace available (R-1..R-3)
 >2 -> state = "broken", current = 0

longest = max run length over all history, under the same bridging rule
```

`longest` is computed over the full date list in the same pass. All arithmetic uses Luxon `DateTime` with the resolved zone and `.diff(other, "days")` on `startOf("day")` values — **never** millisecond subtraction, which breaks across DST (a 23- or 25-hour day).

Reference SQL for the same computation (useful for verification and for the Phase 3 cache), gaps-and-islands, strict variant:

```sql
with local_days as (
  select distinct (created_at at time zone $tz)::date as d
  from public.diary_entries where user_id = $uid
),
islands as (
  select min(d) as start_date, max(d) as end_date, count(*)::int as len
  from (select d, d - (row_number() over (order by d))::int as grp from local_days) g
  group by grp
)
select
  coalesce((select len from islands
            where end_date >= (now() at time zone $tz)::date - 1), 0) as current_streak,
  coalesce((select max(len) from islands), 0) as longest_streak;
```

### 7.4 Caching (Phase 3 only)

If read latency becomes a problem, add `streak_cache(user_id pk, computed_for_local_date date, payload jsonb, updated_at)`. Serve the cached payload when `computed_for_local_date = today_local` **and** the timezone is unchanged; otherwise recompute and write through. Invalidate on entry insert/delete. The derivation remains authoritative, so a corrupt cache is a performance bug, never a correctness bug.

### 7.5 API

**`GET /api/streak`** — `requireAuth`.

```jsonc
{
  "current": 10,
  "longest": 23,
  "state": "active_pending",   // empty | active_today | active_pending | at_risk | grace_used | broken
  "todayLogged": false,
  "lastEntryLocalDate": "2026-08-09",
  "todayLocalDate": "2026-08-10",
  "timezone": "Asia/Karachi",
  "graceUsedOn": null,          // local date bridged by a rest day, if any
  "nextMilestone": { "days": 14, "remaining": 4, "name": "Fortnight" },
  "recentDays": [               // last 60 local dates, ascending, for the history grid
    { "date": "2026-06-12", "logged": true },
    { "date": "2026-06-13", "logged": false }
  ],
  "visible": true
}
```

**`POST /api/entries`** — extend the existing 201 response with the recomputed streak so the client can animate immediately with no second round trip:

```jsonc
{
  "entry": { "...": "unchanged" },
  "streak": { "current": 11, "longest": 23, "state": "active_today",
              "milestoneReached": null }
}
```

`milestoneReached` is non-null only the first time a given milestone is hit (checked and recorded against `streak_settings.celebrated_milestones` in the same request).

**`PUT /api/streak/settings`** — `{ "visible": false }` → `{ "settings": { "visible": false } }`.

Errors follow the existing convention: `{ "error": "..." }` with 400/401. A streak failure must **never** fail the entry write — if streak computation throws inside `POST /api/entries`, log it and return the entry with `"streak": null`. Writing the diary is the product; the streak is decoration.

### 7.6 Integrity issue found during design (must fix)

`validateCreateEntryPayload` accepts a client-supplied `createdAt` and writes it straight to `diary_entries.created_at`. Once a streak depends on that column, a user (or anyone with their token) can fabricate an arbitrary streak by POSTing back-dated entries, and can also corrupt their own history by accident if their device clock is wrong.

**Required change:** reject `createdAt` that differs from server time by more than **5 minutes** (400, `"Entry timestamp is out of range."`). `inserted_at` already records server truth and stays as the audit column. Existing rows are grandfathered — they predate the streak and were not written to game it.

This is a small change to `src/domain/entries.js` and should land in the same phase as the streak read API, not after it.

---

## 8. UI / UX specification

### 8.1 Concept: the Constellation Trail

The number is the secondary reward. The primary reward is **diegetic** — inside the existing 3D sky, stars from consecutive days are joined by a distinct, brighter line, so a streak *is* a constellation the user watches themselves draw (P-4). This directly extends `SceneManager.addConstellationLinks`, which today links stars only by sentiment at `opacity: 0.11`.

| Property | Sentiment links (existing) | Streak trail (new) |
| --- | --- | --- |
| Joins | 2 nearest same-sentiment stars | one star per consecutive local day, in chronological order |
| Opacity | 0.11 | 0.34, with a slow travelling shimmer along the active run |
| Colour | sentiment colour | `#f5c96a` (the existing gold accent) so it reads as one system |
| Rest-day segment | — | dashed / 0.18 opacity — visibly bridged, honestly marked |
| Broken run | — | fades to 0.11 and desaturates; the line **stays in the sky forever** (P-3) |

If a day has multiple entries, the trail connects the **first** entry of each day; same-day siblings stay linked by the existing sentiment lines.

The trail must respect the existing date-filter behaviour: when `filterByDate` is active, `constellationTargetOpacity` goes to 0 — the streak trail follows the same rule.

### 8.2 Streak pill (primary surface)

A compact pill in the **top-left control cluster, immediately right of the existing `#date-filter` button**, matching `.auth-btn` geometry, `--radius-pill`, and the existing translucent panel treatment.

> Corrected during implementation: an earlier draft of this section placed the pill top-right. `#date-filter` is top-**left**; top-right belongs to `#auth-panel` (the logout control). The intent — sit inside the existing meta-controls cluster — is unchanged; only the side was wrong.

```
┌──────────────┐
│  ✦  11       │      idle
└──────────────┘
```

- Glyph is a **four-point star**, not a flame — a flame is another product's language and, per §3.2, carries "don't let it die" affect we specifically don't want.
- Label is the integer only. The word "nights" appears in the expanded card, not the pill.
- Hidden entirely when signed out, and when `current === 0 && longest === 0` (S-8).
- Tap/click opens the streak card (§8.3). Keyboard focusable, `aria-expanded`.
- Mobile: ≥ 44×44 px, consistent with the existing `@media` block that resizes `#date-filter-btn`.

### 8.3 Streak card (expanded, on tap)

A popover reusing the `#date-filter-popover` pattern — same glass panel, same open/close transition, same outside-click dismissal.

```
┌────────────────────────────────────┐
│  ✦  11 nights                      │
│  Longest: 23                       │
│                                    │
│  ▪▪▫▪▪▪▪ ▪▪▪▪▪▪▫ ▪▪▪▪▪▪▪ ▪▪▪▪      │  ← last 28 days
│  Mon                        today  │
│                                    │
│  Next: Fortnight, 3 nights away    │
│                                    │
│  Hide streaks                      │
└────────────────────────────────────┘
```

- The **history grid** (Apple-Fitness-style, §3.6) is the emotional payload — it shows a *pattern*, which is far more informative than a counter and reads as neutral data rather than judgement.
- Filled = entry, hollow = none, ringed = rest day, subtle outline = today when still open.
- "Hide streaks" is a plain text link right here (P-6) — not buried in a settings screen the app doesn't have.
- **Getting back in.** Hiding removes the pill, which removes the only way back — a gap in the original draft. The re-entry point is a "Show streaks" link inside the date filter popover, the adjacent meta-controls surface, shown only while streaks are hidden, and the confirmation message names it. Worth revisiting in Phase 4 if the app ever grows a real settings surface.

### 8.4 States and copy

Copy is the highest-risk part of this feature. All of it is invitational; none of it uses "don't", "lose", "miss", "broke", "failed", or an exclamation mark.

| State | Pill | Card headline | Notes |
| --- | --- | --- | --- |
| `empty` | hidden | — | S-8 |
| `active_today` | `✦ 11` gold | "11 nights · tonight's star is placed" | |
| `active_pending` | `✦ 11` neutral | "11 nights · today is still open" | The default morning state. Nothing urgent. |
| `at_risk` | `✦ 11` with a soft pulsing ring | "11 nights · there's still time tonight" | Enters only after the user's **last reminder slot** has passed locally and today has no entry — derived from `reminder_settings.reminder_times`, so it respects a schedule the user already chose. Amber, never red. |
| `grace_used` | `✦ 11` | "You took a rest day on Tuesday — your streak carried over" | Shown once (R-5), then reverts. |
| `broken` | `✦ 1` after they write again | "Longest: 23 nights. Tonight starts the next one." | **Never renders `0`.** Between the break and the next entry the pill shows the longest value greyed with a hairline outline, and the card leads with the longest streak. |

### 8.5 The moment of writing (the reward beat)

On a successful entry save, in order, total ≈ 1.1 s, non-blocking, never covering the composer:

1. The new star is added (existing behaviour) and flares briefly to ~1.3× scale.
2. The trail segment from yesterday's star draws toward it over ~600 ms.
3. The pill count animates `10 → 11` with a short scale-punch (~200 ms).
4. `aria-live="polite"`: *"Streak: 11 nights."*

That's the entire reward. No confetti, no full-screen takeover, no sound.

### 8.6 Milestones (P-5)

| Days | Name | Days | Name |
| --- | --- | --- | --- |
| 3 | First Light | 50 | Meridian |
| 7 | The Arc | 100 | Centaurus |
| 14 | Fortnight | 200 | Deep Field |
| 30 | Lunar Cycle | 365 | Full Orbit |

On a milestone the reward beat (§8.5) is extended: the whole run's trail brightens and traces end-to-end once, and a small toast appears above the composer — *"First Light · 3 nights"* — auto-dismissing after 5 s, reusing the `#focus-tip` component and its timing. It is never a modal, never blocks input, and fires at most once per milestone per user (§7.1).

### 8.7 Visibility, accessibility, motion

- **Opt-out (P-6):** `visible: false` hides the pill, the card, the trail, the toasts and the reward beat. The data keeps accruing silently, so re-enabling restores the true streak — the same derived-not-stored property that solves the launch-day problem.
- **Reduced motion:** under `prefers-reduced-motion: reduce`, the trail appears without drawing, the count changes without punch, the at-risk ring does not pulse. `main.css` already carries a global `prefers-reduced-motion` block that collapses every animation and transition, so streak surfaces inherit this for free — verified in the browser rather than assumed.
- **Colour independence:** every state is distinguishable by shape and text as well as colour (ring, outline, dash) — the at-risk state must not be conveyed by amber alone.
- **Screen readers:** the pill carries a full label, e.g. `aria-label="Streak: 11 nights. Today is still open."`; the history grid is a table with date and logged/not-logged per cell, not a wall of unlabelled divs.
- **Contrast:** gold `#f5c96a` on the dark panel meets AA for the text sizes used; the trail line is decorative and exempt but is never the sole carrier of information.

### 8.8 Placement rationale

Deliberately *not* placed: in the composer (turns writing into a transaction), as a launch modal (P-2), or centred in the sky (competes with the content). The top-left cluster is the app's existing "meta controls" zone — the same place `#date-filter` lives — so it inherits an established mental model and is out of the reading path.

---

## 9. Reminders integration

The reminder system already exists and already knows whether today is done (`hasCompletedEntryToday`). Streaks change it as little as possible.

| ID | Rule |
| --- | --- |
| **N-1** | The streak count **may appear** in a reminder body, but never in the title, and never with a countdown or a threat. Permitted: *"Your entry for 10 Aug is still open. You're on 11 nights."* Forbidden: *"Don't lose your 11-day streak!"*, *"2 hours left!"* (§3.2). |
| **N-2** | No new reminder slots, no increase in frequency, no streak-length-based escalation. The user's chosen `reminder_times` remain the only schedule. |
| **N-3** | No notification is ever sent about a **broken** streak. The single highest-complaint pattern in the research is the "you missed it" message; we do not send one, ever. |
| **N-4** | A rest day being consumed produces no push — the user learns about it in-app, once, when they return (R-5). |
| **N-5** | If `streak_settings.visible = false`, reminder copy reverts to the current streak-free wording. |

Implementation touch point: `makePushPayload` in `src/services/reminders/dispatch.js` takes an optional streak value; everything else in the dispatch path is unchanged.

---

## 10. Analytics

| Metric | Purpose | Guardrail? |
| --- | --- | --- |
| Distribution of `current_streak` across active users | Health of the mechanic | |
| D1 / D7 / D30 return rate, split by streak bucket at entry | G-1 | |
| Conversion rate from 1-day → 2-day streak | The largest lever per §3.1 | |
| % of at-risk days that convert to an entry before midnight | Is the at-risk state helpful or just noise? | |
| Rest-day usage rate; % of rest days that continue vs. break next day | Tune R-2's 7-day window | |
| **Streak opt-out rate** | G-4 | **Alert if > 5%** |
| **Churn in the 7 days after a break, vs. matched users who never streaked** | G-4 — the abandonment risk from §3.2 | **Alert if positive** |
| **Median entry character count, by streak length bucket** | Detects the "junk entry to save the streak" failure (P-8) | **Alert if median falls materially as streaks lengthen** |

The last three are the ones that decide whether this feature stays.

---

## 11. Edge cases and QA matrix

| # | Scenario | Expected |
| --- | --- | --- |
| 1 | Existing user, 10 consecutive days ending yesterday, opens today before writing | `current = 10`, `active_pending` (§4.1) |
| 2 | Same user writes today | `current = 11`, `active_today` |
| 3 | Brand-new user, zero entries | Streak UI absent entirely (S-8) |
| 4 | 3 entries on the same local date | Counts as 1 day (S-1) |
| 5 | Entry at 23:58 local while server is UTC+0 and user is UTC+11 | Counts for the user's local date, not UTC's (§3.4) |
| 6 | DST spring-forward (23-hour day) | Day counted once; no skip. Verified via Luxon day arithmetic, not ms subtraction |
| 7 | DST fall-back (25-hour day, ambiguous local hour) | Day counted once; no double count |
| 8 | User flies Karachi → New York mid-streak | Streak recomputed under the new zone; a boundary day may shift by one. Must not break an otherwise-valid run of ≥ 2 days. Documented, accepted (S-2) |
| 9 | User has no `reminder_settings` row | Falls back to `X-Client-Timezone`, then UTC (§7.2) |
| 10 | Invalid/unknown IANA string stored | `validateTimezone` rejects → UTC; no crash |
| 11 | One missed day, grace available | Bridged, `grace_used`, dashed segment (R-1) |
| 12 | Two consecutive missed days | Broken, `longest` preserved (R-3, S-5) |
| 13 | Missed day, but a rest day was already used 4 days ago | Not bridged → broken (R-2) |
| 14 | `STREAK_GRACE_ENABLED=false` | Strict consecutive semantics; nothing else changes (R-6) |
| 15 | Entry deleted from a mid-run day | Run splits on next read; no drift (S-6) |
| 16 | Client POSTs `createdAt` 30 days in the past | 400, entry rejected (§7.6) |
| 17 | Client clock 10 minutes fast | 400 with a clear message — better than silently corrupting history |
| 18 | Streak computation throws during `POST /api/entries` | Entry still saved, 201, `"streak": null` (§7.5) |
| 19 | Offline / failed `GET /api/streak` | Pill hidden; no error toast; retry on next refresh cycle |
| 20 | Date filter active | Trail hides with the other constellation lines (§8.1) |
| 21 | Logout | Streak state cleared alongside `scene.clearEntries()` and `reminders.stop()` |
| 22 | `visible = false` | No pill, no trail, no toast, no streak text in reminders (N-5) |
| 23 | 365+ day streak | Trail renders without frame-rate regression; verify line count budget |
| 24 | Milestone hit twice (e.g. reaches 7, breaks, reaches 7 again) | Celebration fires once only (§7.1) |

Unit tests belong on the pure fold in `src/services/streaks/compute.js` — it takes a date array, a today, and a zone, and returns a result object, so cases 1–15 are all fast table-driven tests with no database.

---

## 12. Open questions

| ID | Question | Recommendation |
| --- | --- | --- |
| O-1 | Should a user be able to write an entry *for* a past date and repair a gap? | **No** for v1. A diary's value is that it is honest about when it was written; retro-filling turns it into a scoreboard. Revisit only with strong demand. |
| O-2 | Configurable day boundary (e.g. "my day ends at 4am") for night writers? | Defer. Real need for late-night journalers, but it multiplies the timezone test matrix. Phase 4 candidate. |
| O-3 | Is the 7-day rest-day window right? | Ship with 7, instrument it (§10), tune once there is data. Duolingo's finding was that a *more* generous allowance improved retention, so 7 is the conservative starting point. |
| O-4 | Should the milestone toast be shareable (image export of the constellation)? | Attractive and on-metaphor, but it is the first step toward social pressure. Explicit non-goal for now. |

---

## 13. Rollout plan

| Phase | Scope | Exit criteria |
| --- | --- | --- |
| **1 — Engine** ✅ | `src/services/streaks/compute.js` (pure fold), `entry_local_dates` RPC, `GET /api/streak`, `createdAt` clamp (§7.6). No UI. | Cases 1–18 green as unit tests; API verified against a seeded account with real history |
| **2 — Quiet UI** ✅ | Streak pill + card + history grid, `streak_settings` table, opt-out, `visible` plumbed through. No trail, no celebrations. | Existing users see their true streak on first load (G-2); opt-out works end to end |
| **3 — The sky** | Constellation trail in `SceneManager`, reward beat, milestones, reduced-motion support. Cache only if measured as needed. | No frame-rate regression at 365 days (case 23) |
| **4 — Reminders + tuning** | N-1 copy change, analytics dashboards, rest-day window tuning. | Guardrail metrics (§10) stable for 4 weeks |

Ship Phase 1+2 together; they are the feature. Phase 3 is what makes it *this* product's feature.

### 13.1 Phase 1 — as built

| Spec | Delivered in |
| --- | --- |
| Pure fold (§7.3) | `src/services/streaks/compute.js` — dependency-free calendar arithmetic on UTC epoch days, so DST cannot produce an off-by-one |
| Milestones, grace window, history window | `src/services/streaks/constants.js` |
| Timezone resolution, data access, `at_risk`, payload assembly | `src/services/streaks/service.js` |
| `GET /api/streak` (§7.5) | `src/routes/streak.routes.js`, mounted in `src/app.js` |
| `entry_local_dates` RPC | `supabase/schema.sql` |
| `createdAt` clamp (§7.6) | `src/domain/entries.js` |
| `STREAK_GRACE_ENABLED` (R-6) | `src/config/env.js`, `.env.example` |
| QA cases 1–18 | `test/streaks.compute.test.js`, `test/streaks.service.test.js`, `test/entries.domain.test.js` — `npm test` |

Two deviations from the spec as written, both deliberate:

- **The RPC has a fallback.** `supabase/schema.sql` has to be applied by hand in the Supabase SQL editor, so if `entry_local_dates` is missing the service logs once and falls back to reading `created_at` and converting in Node (§7.3 named this an acceptable shortcut). The endpoint therefore works before the SQL is applied; applying it moves the work into Postgres.
- **`visible` is hard-coded `true`.** The `streak_settings` table lands in Phase 2, but the field is already in the payload so the client contract does not change when it does.

`getReminderSettingsRow` moved from `src/routes/reminders.routes.js` into `src/services/reminders/status.js` so both routers share one implementation, and `getLocalNow` is now exported from `src/services/reminders/time.js`. No behaviour changed in the reminder paths.

### 13.2 Phase 2 — as built

| Spec | Delivered in |
| --- | --- |
| `streak_settings` table + RLS (§7.1) | `supabase/schema.sql` |
| Settings read/write | `src/services/streaks/settings.js` |
| `PUT /api/streak/settings`, `visible` on `GET /api/streak` | `src/routes/streak.routes.js` |
| Pill, card, history grid, legend (§8.2, §8.3) | `public/index.html`, `public/styles/main.css` |
| States and copy (§8.4) | `public/js/features/streaks.js` |
| Opt-out and re-entry (P-6) | `streaks.js` + "Show streaks" in the date filter popover |
| `X-Client-Timezone` on every request (§7.2) | `public/js/services/api-client.js` |
| Lifecycle wiring | `public/js/app.js` |

Deviations and decisions:

- **The history grid is a labelled list, not a `<table>`.** §8.7 called for a table, but a 4×7 block of days has no real row/column semantics to expose — the week grouping is a layout convenience. It renders as `role="list"` with a per-day `aria-label` ("Aug 9: entry written", "Aug 10: today, still open"), which is what a screen reader user actually needs, plus a visible legend.
- **Cell size is capped at 26px** rather than filling the card width. At full width the grid dominated the popover, which works against P-2.
- **Re-entry after opting out** is the "Show streaks" link described in §8.3 above.
- **`#date-filter-popover[hidden]` was fixed in passing.** It carries an explicit `display: grid`, which beats the user-agent rule for `[hidden]`, so while "closed" it stayed in the layout at `opacity: 0` and kept intercepting clicks. The streak card would have had the same defect; both are now explicitly `display: none` when hidden.

Verified in Chromium via a stub-API harness (62 assertions): every state renders, no state ever shows `0`, the broken pill uses a hollow glyph so the state does not depend on colour, Escape closes the card and returns focus, the two popovers are mutually exclusive, the opt-out round trip restores the real value rather than resetting it, touch targets clear 44px, and the mobile card fits a 390px viewport with no horizontal overflow.

---

## 14. Acceptance criteria

1. A user whose last 10 local days each contain ≥ 1 entry sees **10** on first load after launch, before writing anything, with **no migration having been run**, and **11** immediately after writing. *(G-2, §4.1)*
2. No user ever sees the number `0` presented as their streak. *(S-8, P-3)*
3. All date arithmetic resolves through the user's IANA timezone via Luxon; no server-side `new Date()` day math exists in the streak path. *(P-7)*
4. Deleting an entry mid-run produces a correct streak on the next read with no manual repair. *(S-6)*
5. A single missed day with grace available leaves the streak intact and is honestly marked in the UI. *(R-1, §8.1)*
6. No notification, in any state, mentions a lost, broken, or endangered streak. *(N-1, N-3)*
7. One tap on "Hide streaks" removes every streak surface in the product, and re-enabling restores the correct, still-accruing value. *(P-6)*
8. A failure in streak computation never prevents a diary entry from being saved. *(§7.5)*
9. Every state is distinguishable without relying on colour, and every state is announced to screen readers. *(§8.7)*

---

## Sources

- [Designing A Streak System: The UX And Psychology Of Streaks — Smashing Magazine](https://www.smashingmagazine.com/2026/02/designing-streak-system-ux-psychology/)
- [Behind the product: Duolingo streaks — Jackson Shuttleworth, Lenny's Podcast (summary)](https://www.getrecall.ai/summary/lennys-podcast/behind-the-product-duolingo-streaks-or-jackson-shuttleworth-group-pm-retention-team)
- [The Psychology of Hot Streak Game Design: Keeping Players Coming Back Without Shame — UX Magazine](https://uxmag.com/articles/the-psychology-of-hot-streak-game-design-how-to-keep-players-coming-back-every-day-without-shame)
- [Streaks & Milestones: Habit-Forming Gamification — AppStorys](https://appstorys.com/blog-Streaks-Milestones-Habit-Gamification)
- [Designing for User Retention: The Psychology Behind Streaks — Bootcamp](https://medium.com/design-bootcamp/designing-for-user-retention-the-psychology-behind-streaks-cf0fd84b8ff9)
- [Why Do Journaling Apps Make Me Feel Guilty? — Daylogue](https://daylogue.com/learn/journaling-app-guilt)
- [Winning at What Cost? The Psychology of Gamification — The HEAD Foundation](https://digest.headfoundation.org/2025/09/21/winning-at-what-cost-the-psychology-of-gamification-and-the-fight-for-our-focus/)
- [Mental Health App Reviews: What Users Really Say — Unstar](https://unstar.app/blog/mental-health-app-reviews-what-users-say-about-wellbeing-apps-2026)
- [Streak Timezone & DST Handling — Trophy](https://trophy.so/blog/streak-timezone-dst-handling)
- [How to Build a Streaks Feature — Trophy](https://trophy.so/blog/how-to-build-a-streaks-feature)
- [Implementing a Daily Streak System: A Practical Guide — Tiger Abrodi](https://tigerabrodi.blog/implementing-a-daily-streak-system-a-practical-guide)
- [Understanding streaks in Buffer — Buffer Help Center](https://support.buffer.com/article/907-understanding-streaks-in-buffer)
- [Streaks guide — Skio](https://help.skio.com/docs/streaks-guide)
