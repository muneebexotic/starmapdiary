# Handoff: Star Map Diary — interface redesign

## Overview

A redesign of every interface layer that sits on top of Star Map Diary's live three.js galaxy: writing an entry, reading one, the streak, the date filter, auth, reminders, first-run guidance and the hide-interface control.

The 3D scene itself is **unchanged**. Nothing in this handoff touches `public/js/three/*` except to read from it.

The design's organising idea: on a phone, only two things exist at rest — a line to write on, and one dot that turns the interface off. Everything else lives behind a single surface called **the log**. Colour is borrowed from the sky (the same gold as the streak trail); the interface introduces no palette of its own.

## About the design files

The files in this bundle are **design references written in HTML/JS** — running prototypes that show the intended look, motion and behaviour. They are not production code to paste in.

The target codebase (`muneebexotic/starmapdiary`) is plain HTML/CSS/JS with **one stylesheet, no build step, no framework**. So the implementation route is:

- Rewrite `public/index.html`'s overlay markup to the structure described below.
- Rewrite `public/styles/main.css` accordingly. **Author it as normal CSS classes** — the prototypes use inline styles only because of the tool they were built in, and that is not how this should ship.
- `public/js/app.js`, `features/streaks.js` and `features/reminders.js` keep their responsibilities; their DOM wiring changes to the new element ids, and two behaviours move (see *Behaviour changes* below).

Do not port the prototype's React-ish runtime (`support.js`) or `sky.js`. `sky.js` is a 2D canvas stand-in for the real galaxy, written so the overlay could be judged over something truthful; the real app already has the real scene.

## Fidelity

**High-fidelity.** Colours, type, spacing, radii, motion curves and copy are final and are listed exactly below. Recreate them.

---

## Design tokens

### Colour

| Token | Value | Use |
| --- | --- | --- |
| `--bg` | `#02030a` | page behind the canvas |
| `--ink` | `rgba(244,238,229,0.94)` | primary text |
| `--ink-2` | `rgba(244,238,229,0.72)` | secondary text, transient messages |
| `--ink-3` | `rgba(244,238,229,0.62)` | labels, captions (AA floor — do not go below) |
| `--ink-4` | `rgba(244,238,229,0.56)` | date line, row hints |
| `--hairline` | `rgba(244,238,229,0.08)` | row separators |
| `--edge` | `rgba(244,238,229,0.10)` | composer border |
| `--gold` | `#f5c96a` | streak, trail, milestone, send-ready |
| `--blue` | `#72a6ff` | rest nights only |
| `--panel` | `rgba(7,10,19,0.74)` | log surface |
| `--composer` | `rgba(8,11,20,0.55)` | writing field |
| `--wash` | `rgba(2,3,10,0.68)` | reader backdrop |

Mood colours are unchanged from `public/js/config/sentiment.js`: positive `#f5c96a`, neutral `#f2f4ff`, negative `#72a6ff`, reflective `#8457db`. They are used for the star, the reader's mood dot and the hover dot — never for text.

Contrast: `--ink-3` on `--panel` measures ≈5.5:1. Nothing smaller than 11px, nothing dimmer than 0.62 alpha.

### Typography

Two families, both Google Fonts:

```
Newsreader — 200..500, plus italic 300   (everything the user writes)
Karla      — 400, 500, 600              (everything the app says)
```

| Role | Font | Size | Weight | Line-height | Tracking |
| --- | --- | --- | --- | --- | --- |
| Composer text + placeholder | Newsreader | 17px | 300 | 1.5 | — |
| Entry text (reader) | Newsreader | 20px phone / 21px desktop | 300 | 1.62 | 0.002em |
| Streak headline | Newsreader | 27px | 300 | 1.15 | -0.01em |
| Milestone line | Newsreader | 21px | 300 | 1.3 | — |
| Wordmark (signed out) | Newsreader | 32px | 300 | 1.1 | -0.015em |
| Date / streak / meta row | Karla | 12.5px | 400 | — | 0.02em |
| Section labels ("YOUR NIGHTS") | Karla | 10.5px uppercase | 400 | — | 0.18em |
| Weekday letters | Karla | 11px | 400 | — | 0.1em |
| Settings row title | Karla | 14px | 400 | — | — |
| Settings row hint | Karla | 12px | 400 | 1.4 | — |
| Field labels (signed out) | Karla | 10.5px uppercase | 400 | — | 0.18em |
| Primary button | Karla | 15px | 600 | — | 0.01em |

`font-size: 17px` on the composer and `16px` on auth inputs is deliberate — below 16px iOS zooms the page on focus.

### Spacing, radius, motion

- Deck gutter 16px; column max-width 640px, centred.
- Radii: composer 22px, log 28px (top two corners only on phone), calendar cell 13px, primary button 16px, hover card 16px, pills 999px.
- Elevation is blur, not borders: log `backdrop-filter: blur(36px) saturate(1.2)` + `0 -20px 70px rgba(0,0,0,0.55)` + `inset 0 1px 0 rgba(255,255,255,0.06)`. Composer `blur(26px)` + `0 20px 48px rgba(0,0,0,0.45)`. Hover card `blur(18px)`.
- Easing: `cubic-bezier(0.2, 0.8, 0.2, 1)` everywhere. Durations: fades 0.3–0.35s, sheets/reader rise 0.36–0.42s, hide-interface 0.42s, send-button state 0.3s, switch knob 0.28s.
- Keyframes: `smd-rise` (opacity 0→1, translateY 16px→0), `smd-lift` (6px), `smd-fade`.
- `@media (prefers-reduced-motion: reduce)` sets all animation/transition durations to `0.01ms !important`.

### Safe areas and keyboard

Root carries `--sat: env(safe-area-inset-top, 0px)` and `--sab: env(safe-area-inset-bottom, 0px)`; every top and bottom offset is `calc(Npx + var(--sat|--sab))`. Keyboard: keep the existing `visualViewport` listener from `app.js` writing `--kb`, and add it into the deck's bottom padding: `padding-bottom: calc(16px + var(--sab) + var(--kb))`.

---

## Screens

### 1. Sky at rest (signed in)

**Purpose:** look at the galaxy; write tonight's line.

**Layout.** The canvas fills the viewport. One fixed deck along the bottom edge, one control at top right, nothing else.

- **Deck**: `position:fixed; left:0; right:0; bottom:0; padding: 88px 16px calc(16px + var(--sab) + var(--kb))`. Background is a scrim, not a panel: `linear-gradient(to top, rgba(2,3,10,0.92) 6%, rgba(2,3,10,0.6) 46%, rgba(2,3,10,0) 100%)`. `pointer-events:none` on the scrim; `auto` on the inner column so the sky stays draggable either side of it.
- Inner column: `max-width:640px; margin:0 auto; display:flex; flex-direction:column; gap:8px`.

**Components, top to bottom inside the deck:**

1. **Message line** (conditional) — centred, Karla 12.5px, `--ink-2`, `animation: smd-fade 0.35s`. Single channel for every transient string in the product.
2. **Milestone line** (conditional) — centred, Newsreader 21px, `--gold`, `animation: smd-lift 0.5s`. Shown instead of / above the message line.
3. **Meta row** — a full-width `<button>`, `min-height:44px`, `padding:0 6px`, transparent. Left: date (`Mon, 10 August`, Karla 12.5px `--ink-4`), then a 5px `--gold` dot with `box-shadow: 0 0 9px rgba(245,201,106,0.85)` and the streak (`6 nights`, `--ink-2`). Right: the word `LOG` (12.5px, uppercase, 0.06em, `rgba(244,238,229,0.5)`) plus a 13px chevron-up (`M6 14l6-6 6 6`, stroke 2, round caps). Opens the log.
4. **Composer** — `display:flex; align-items:flex-end; gap:9px`.
   - `<textarea>`: `flex:1 1 auto; min-height:60px; max-height:168px; resize:none; padding:18px; border-radius:22px; border:1px solid var(--edge); background:var(--composer)`; Newsreader 17px/1.5; auto-grows on input (reuse `syncEntryInputHeight` from `app.js`).
   - Send `<button>`: `flex:0 0 44px; width:44px; height:44px; margin-bottom:8px; border-radius:999px`. Contains the repo's own 4-point star path `M12 2.4l2.3 7.3 7.3 2.3-7.3 2.3-2.3 7.3-2.3-7.3L2.4 12l7.3-2.3z` at 15px, `fill:currentColor`.
     - Empty draft: `background:transparent; color:rgba(244,238,229,0.34); box-shadow: inset 0 0 0 1px rgba(244,238,229,0.16)` — a hollow ring.
     - Non-empty: `background: linear-gradient(160deg,#f7d489,#eedcc4); color:#10131c; box-shadow: 0 8px 22px rgba(245,201,106,0.3)`. The glyph lights up as you write.
     - `:active` → `transform: scale(0.93)`.
   - **The send button is a sibling of the field, not inside it.** This is what removes the current overlap.
5. **Hide-interface control** — `position:fixed; top:calc(11px + var(--sat)); right:12px; width:44px; height:44px`, transparent, containing one `<span>`: 15px circle, `border:1px solid rgba(244,238,229,0.5)`, no fill. When the interface is hidden it becomes a 9px filled `rgba(245,201,106,0.9)` disc and the button drops to `opacity:0.4`. Transitions width/height/background/border 0.3s.

**Placeholder copy is the nudge.** `Tonight is still open.` when today has no entry; `Another line?` when it does. The current reminder banner disappears entirely.

### 2. The log

**Purpose:** find a night, see the run, change settings, sign out. One surface for everything that is not writing.

**Phone** — bottom sheet: `left:0; right:0; bottom:0; max-height:84dvh; border-radius:28px 28px 0 0; padding:10px 18px calc(24px + var(--sab)); overflow:auto`, plus a 38×4px `rgba(244,238,229,0.18)` grab handle centred with 16px below it. Behind it, a `rgba(2,3,10,0.4)` scrim that closes on tap. Enter: `smd-rise 0.36s`.

**Desktop (≥900px)** — standing panel: `left:20px; top:20px; bottom:20px; width:384px; border-radius:28px; padding:26px 24px 28px`; no handle.

**Contents:**

1. Header row: `YOUR NIGHTS` (section label, `white-space:nowrap`) left, month range (`Jul – Aug`, 12px, `rgba(244,238,229,0.5)`) right.
2. Weekday letters `M T W T F S S` — 7-column grid, 11px, `--ink-3`, centred, `aria-hidden`.
3. **Nights calendar** — `display:grid; grid-template-columns:repeat(7,1fr); gap:2px`. Weeks run Monday-first and cover the last 28 days, so 4–5 rows. Each cell is a `<button aria-label>` with `aspect-ratio:1; min-height:44px; border-radius:13px; display:grid; place-items:center`, containing one dot:
   - written → 10px disc `--gold`, `box-shadow: 0 0 12px rgba(245,201,106,0.55)`
   - rest night → 10px `1px solid rgba(114,166,255,0.85)` ring on `rgba(114,166,255,0.14)`
   - nothing → 4px `rgba(244,238,229,0.2)` dot
   - future → 4px `rgba(244,238,229,0.07)` dot, `disabled`
   - today → cell gets `box-shadow: inset 0 0 0 1px rgba(244,238,229,0.24)`
   - filtered night → cell gets `inset 0 0 0 1px rgba(245,201,106,0.85)`
   - When streaks are off, written dots render `rgba(244,238,229,0.86)` with no glow — the calendar still works as a finder.
   - `aria-label` reuses the existing strings from `features/streaks.js`: `Aug 8: entry written` / `: rest night` / `: today, still open` / `: no entry`.
4. Caption, 12.5px `--ink-4`: `Tap a night to show only its stars.` → `Showing one night. Tap it again for the whole sky.`
5. **Streak block** (hidden when streaks are off): headline `6 nights` (Newsreader 27px); sub `Today is still open.` / `Tonight's star is placed.` (13px `--ink-2`); next `The Arc at 7 nights, 1 night away.` (12.5px `--ink-4`). Milestone names come from `src/services/streaks/constants.js` — First Light 3, The Arc 7, Fortnight 14, Lunar Cycle 30, Meridian 50, Centaurus 100, Deep Field 200, Full Orbit 365.
6. **Settings rows** — `min-height:60px`, `display:flex; justify-content:space-between; align-items:center`, separated by `1px solid var(--hairline)`. Title 14px `--ink`, hint 12px `--ink-4`.
   - `Streaks` — hint `Counts, trail and milestones.` / `Hidden. They keep counting quietly.`
   - `Nightly reminder` — hint `One notification, late evening.` / `Off. Nothing will interrupt you.`
   - iOS hint (only when reminders are on, on iOS, not standalone): full-width paragraph, 12.5px, `rgba(245,201,106,0.86)` — `On iPhone and iPad, add Star Map Diary to your Home Screen first: tap Share, then Add to Home Screen.`
   - Auth row: `Signed in as …` (12.5px `--ink-4`) with an underlined `Sign out` text button, `min-height:44px`.
7. **Switch** — `<button role="switch" aria-checked>` `52×44px` transparent (44px touch target), containing a 52×31px track at `top:6.5px` (`rgba(245,201,106,0.9)` on, `rgba(244,238,229,0.14)` off) and a 25px knob at `top:9.5px`, `left:3px` → `24px` (`#12151f` on, `rgba(244,238,229,0.75)` off).

### 3. Reading a night

**Purpose:** re-read an entry. This is half of what the product is for.

No card, no title bar, no close X in the corner.

- Backdrop: `rgba(2,3,10,0.68)` + `backdrop-filter: blur(2px)`, `smd-fade 0.34s`; clicking it closes.
- **The sky stops drifting** while the reader is open, and the touched star stays lit above the wash: a 110px absolutely-positioned div at the star's screen coordinates, `background: radial-gradient(circle, rgba(255,255,255,0.95) 0%, rgba(255,255,255,0.5) 9%, <mood>44 30%, transparent 68%)`.
- **Desktop:** a 440px text column placed 130px to the star's roomier side, top clamped to `starY - 120`, with a 1px **leader line** from the star to the column: `background: linear-gradient(to right, rgba(245,201,106,0.65), rgba(244,238,229,0.1))`. It reads like an annotated star chart.
- **Phone:** the column is bottom-anchored full width, `padding: 30px 22px calc(30px + var(--sab))`, `max-height:86dvh`.
- Content: meta line — 8px mood dot with `box-shadow: 0 0 12px <mood>` then `Friday, 8 August · 10:42 PM · Reflective` (12px, `rgba(244,238,229,0.62)`, 0.05em). Then the entry, Newsreader 20/21px, `line-height:1.62`, `white-space:pre-wrap`, `text-wrap:pretty`.
- Footer, 28px below: `CLOSE` (uppercase 12.5px, `rgba(244,238,229,0.62)`) at left; `Earlier night` / `Later night` at right, each `min-height:44px`, disabled at `rgba(244,238,229,0.24)`. **Earlier/later is new** — flag it if you don't want it.
- Escape closes. Tapping the sky closes.

### 4. Hover / long-press preview

Desktop hover, or ~380ms long-press on touch. Follows the pointer, `transform: translate(-50%, calc(-100% - 26px))`, clamped 150px from either viewport edge.

`max-width:min(300px,74vw); padding:13px 15px; border-radius:16px; background:rgba(5,7,15,0.86); backdrop-filter:blur(18px); box-shadow: 0 18px 44px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.05)`. First 80 characters + `…` in Newsreader 15px/1.45, then a 6px mood dot and `8 August · Reflective` in Karla 11px `rgba(244,238,229,0.58)`. `pointer-events:none`. Reuse `buildEntryPreview()` from `utils/formatters.js`.

### 5. Signed out

No locked composer, no shake, no lock icon. The sky is free to look at; entries are cleared as they are today.

Bottom-anchored column (phone) / same column centred (desktop), `gap:20px`:

- Wordmark `Star Map Diary`, Newsreader 32px/300.
- `A private diary. Each night you write becomes a star, and nights in a row are drawn into a constellation.` — 13.5px/1.55, `rgba(244,238,229,0.62)`, `max-width:36ch`.
- Two ruled fields, `height:46px`, transparent, `border:0; border-bottom:1px solid rgba(244,238,229,0.16)`, 16px text, with 10.5px uppercase labels above.
- Primary button: full width, `min-height:50px`, `border-radius:16px`, `linear-gradient(160deg,#f7d489,#eedcc4)`, `#10131c` text, `box-shadow: 0 10px 30px rgba(245,201,106,0.22)`. Label `Begin` (sign up) / `Return` (log in).
- Row: auth status (`Not signed in.` / `Signed in as …`) left; underlined toggle `I already have an account` / `Create an account instead` right, `min-height:44px`.

### 6. Interface hidden ("just look")

Everything except the hide control gets `opacity:0; transform:translateY(18px); pointer-events:none` over 0.42s. The control itself drops to `opacity:0.4` and its ring becomes a small gold disc. Escape restores. Persist in `localStorage` under the existing key.

### 7. First run

Three beats in the shared message line, then one caption — nothing permanent, nothing that can collide:

| t | What |
| --- | --- |
| 0.9s | `Drag to orbit. Pinch to zoom.` (`Scroll to zoom` on pointer devices) |
| 4.6s | `Tap a star to read that night.` (`Hover a star to glimpse it. Click to read it.`) |
| 8.6s | message clears; caption appears under the hide control, right-aligned, `max-width:196px`, 12.5px `--ink-2`: `Hide everything from here, and just look.` |
| 14s | caption fades; `localStorage` flag set |

Any interaction with the hide control ends the sequence early and sets the flag. The permanent `#hint` line at the top of the screen is deleted.

---

## Behaviour changes worth reviewing

Two features move conceptually. Both are judgement calls, not bugs:

1. **The date filter and the 28-day streak grid become one object.** They were always the same list — "your recent nights". The date `<input type="date">`, its popover, its Clear button and the separate `#streak-grid` all collapse into the log's calendar. `scene.filterByDate(dateStr)` / `clearFilter()` are called from a calendar cell instead. `Show streaks` moves out of the filter popover (where nobody would find it) into a settings switch next to `Hide streaks`.
2. **The reminder banner becomes the composer's placeholder.** "You have not added today's entry yet" was a banner with a button; now the field itself says `Tonight is still open.` Push enrolment moves to the `Nightly reminder` switch in the log, with the iOS install hint inline beneath it. `ReminderManager.shouldShowReminderBanner()` still decides whether today counts as open; it just drives copy instead of a banner.

Everything else keeps its current API: `GET /api/streak`, `PUT /api/streak/settings`, `POST /api/entries` returning `{ entry, streak }`, the reminder endpoints, and the scene's `addEntry / flareEntry / setStreakData / playTrailDraw / playMilestoneSweep`.

## State

```
signedIn, account
draft                       composer text
entries[]                   as returned by GET /api/entries
streak { current, longest, state, recentDays[], nextMilestone, visible }
logOpen                     the one sheet/panel
reading                     entry | null
hover                       { entry, x, y } | null
filterDay                   'YYYY-MM-DD' | null   (drives scene.filterByDate)
dim                         interface hidden      (persisted)
message | milestone         the single transient channel
remindersOn, iosHint
```

Only one of `logOpen` / `reading` is ever true. Opening either closes the other; the hover preview is suppressed while either is open.

## Accessibility

- Every control ≥44×44px, and no two overlap at any width (verified at 402px and 1320px).
- Focus: `:focus-visible { outline: 2px solid rgba(245,201,106,0.9); outline-offset: 3px; border-radius: 10px; }`
- Reader is `role="dialog" aria-modal="true"`; the log is `role="dialog" aria-label="The log"`; switches are `role="switch" aria-checked`; calendar cells carry the existing day labels; the hide control is `aria-pressed`.
- Keep `#streak-live` (`aria-live="polite"`) — the streak announcement still belongs there.
- All text meets AA on the near-black background; the dimmest text in the product is `rgba(244,238,229,0.56)` at 12px.

## Assets

None. Two icons, both already in `public/index.html`: the 4-point star `M12 2.4l2.3 7.3 7.3 2.3-7.3 2.3-2.3 7.3-2.3-7.3L2.4 12l7.3-2.3z` and a chevron `M6 14l6-6 6 6`. Fonts are Newsreader and Karla from Google Fonts — self-host them the same way three.js is self-hosted if you want to keep first paint free of third-party origins.

## Files in this bundle

| File | What it is |
| --- | --- |
| `Star Map Diary.dc.html` | The redesigned interface. Open it directly; it is fully interactive. |
| `Star Map Diary — Phone and Desktop.dc.html` | The same interface in five framed states (4 phone, 1 desktop). Start here. |
| `Current UI as built.dc.html` | Today's interface rebuilt from `main.css` for comparison, collisions included. |
| `sky.js` | 2D canvas stand-in for the galaxy. **Reference only** — the real scene already exists. Its star positions are `public/js/three/layout.js` verbatim. |
| `diary-data.js` | Sample entries used by the prototypes. |
| `support.js` | Runtime the `.dc.html` files need in order to open. Not part of the design. |
| `ios-frame.jsx`, `browser-window.jsx` | Device/browser chrome for the presentation file only. |

The prototypes read `?safe=ios` (fakes iOS insets) and `?state=log|read|out` (opens a preset state) — useful for jumping straight to a screen.
