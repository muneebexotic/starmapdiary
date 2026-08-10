# Source

repo: muneebexotic/starmapdiary
branch: main
path: public/

## Last sync

date: 2026-08-10T12:12:42Z

### Updated in this project
- Rebuilt the current interface from `public/styles/main.css` and `public/index.html` as a reference, including the send/focus button collision.
- Redesigned the whole overlay: one writing line, one log surface, an in-place entry reader.
- Merged the 28-day streak history and the date filter into a single nights calendar.
- Moved the reminder banner and the iOS "Add to Home Screen" hint into the log's settings rows.

## Screen map

| Screen | Built from |
| --- | --- |
| Star Map Diary.dc.html — writing, streak, filter, focus, auth | public/index.html, public/js/app.js, public/styles/main.css |
| Star Map Diary.dc.html — nights calendar + streak copy | public/js/features/streaks.js, src/services/streaks/constants.js, public/js/utils/formatters.js |
| Star Map Diary.dc.html — reminders + iOS install hint | public/js/features/reminders.js |
| Star Map Diary.dc.html — entry reader, hover preview, mood colours | public/js/three/scene-manager.js, public/js/config/sentiment.js |
| sky.js — galaxy stand-in (positions, colours, trail) | public/js/three/layout.js, public/js/three/galaxy-utils.js, public/js/three/quality.js |
| Current UI as built.dc.html — recreation of today's interface | public/index.html, public/styles/main.css |
