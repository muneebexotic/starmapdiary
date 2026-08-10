// Sample diary content for the design. Shape matches the API payload:
// { id, text, sentiment, createdAt } — see src/domain/entries.js / public/js/app.js.
(function () {
  const E = [
    ["2026-03-12T23:14", "reflective", "Started this because I kept forgetting what the year felt like. Not what happened. What it felt like."],
    ["2026-03-13T22:51", "neutral", "Late train. Read half a chapter and looked out the window for the other half."],
    ["2026-03-15T23:40", "positive", "Ran into someone I hadn't seen in years and we both had the same amount of time."],
    ["2026-03-19T00:20", "negative", "Tired in a way sleep doesn't fix. Writing it down anyway."],
    ["2026-03-24T23:02", "neutral", "Cooked properly for the first time in a while. Ate standing up."],
    ["2026-04-02T22:38", "reflective", "I notice I only write when the house is quiet. Maybe that's the whole point of it."],
    ["2026-04-09T23:55", "positive", "Good day. Genuinely. Nothing to report, which is the report."],
    ["2026-04-16T21:47", "negative", "Difficult call with home. Sat in the car afterwards for twenty minutes."],
    ["2026-04-27T23:30", "neutral", "Rain all evening. Left the window open on purpose."],
    ["2026-05-06T22:12", "reflective", "Re-read March. I sounded further away than I remember being."],
    ["2026-05-14T23:19", "positive", "Finished the thing I'd been avoiding since February. It took forty minutes."],
    ["2026-05-21T00:04", "neutral", "Walked the long way. Counted six planes."],
    ["2026-06-01T23:08", "reflective", "A month where mostly I kept going. That counts."],
    ["2026-06-11T22:44", "negative", "Not a good one. Leaving it at that."],
    ["2026-06-18T23:36", "positive", "Swimming outdoors in June is the closest I get to being a kid again."],
    ["2026-06-29T23:51", "neutral", "Everything on the list, none of it interesting."],
    ["2026-07-08T22:29", "reflective", "I keep writing about weather. Perhaps weather is how I say the rest of it."],
    ["2026-07-16T23:22", "positive", "She laughed at the bad joke. The really bad one. Made my week."],
    ["2026-07-21T00:11", "negative", "Anxious about nothing I can name, which is worse than something."],
    ["2026-07-25T23:03", "neutral", "Bought lemons. Fixed the shelf. Small, fine day."],
    ["2026-07-30T23:41", "reflective", "Twenty-three nights in a row earlier this year and I didn't notice until it stopped."],
    ["2026-08-01T22:57", "positive", "First proper evening on the balcony. Stayed out until it was cold."],
    ["2026-08-03T23:12", "positive", "Sat on the step and let the phone stay inside."],
    ["2026-08-04T23:26", "neutral", "Long day, short entry. Still here."],
    ["2026-08-05T23:58", "reflective", "Realised I've been waiting for a version of this year that was never coming, and the actual one has been fine."],
    ["2026-08-07T22:19", "positive", "Slept nine hours and everything looked solvable again."],
    ["2026-08-08T22:42", "reflective", "Walked home the long way tonight. The air had that first-cold-of-autumn edge to it and I didn't mind at all. Kept thinking about how much of this year I spent waiting for something to start, when it had already started."],
    ["2026-08-09T23:33", "neutral", "Quiet Sunday. Washed everything, wrote nothing until now."]
  ];

  window.DIARY_ENTRIES = E.map(function (row, i) {
    return { id: "e" + i, createdAt: row[0] + ":00", sentiment: row[1], text: row[2] };
  });

  // Aug 06 has no entry: the server's grace rule covered it as a rest day.
  window.DIARY_REST_DAYS = ["2026-08-06"];
  window.DIARY_TODAY = "2026-08-10";
})();
