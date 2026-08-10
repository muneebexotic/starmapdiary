# Design handoff — interface redesign

`incoming/` is the Claude Design bundle for the overlay redesign, kept verbatim.

**These are design references, not production code.** They are React-ish prototypes that
run in a browser to show intended look, motion and behaviour. Per the bundle's own README:

- Do not port `support.js` (the prototype runtime) or `sky.js` (a 2D stand-in for the galaxy —
  the real three.js scene already exists and is unchanged by this redesign).
- `ios-frame.jsx` and `browser-window.jsx` are presentation chrome for the framed board only.
- The prototypes use inline styles because of the tool that produced them. The real
  implementation is normal CSS classes in `public/styles/main.css`.

Start with `incoming/README.md` — it carries the exact tokens, type scale, motion curves,
per-screen specs, accessibility requirements and final copy.

To run a prototype locally: serve this directory and open `Star Map Diary.dc.html`.
It needs network access for React/Babel (unpkg) and Google Fonts.
Query params: `?safe=ios` fakes iOS insets, `?state=log|read|out` opens a preset screen.
