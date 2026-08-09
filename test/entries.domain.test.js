const test = require("node:test");
const assert = require("node:assert/strict");

const { validateCreateEntryPayload, MAX_CLOCK_SKEW_MS } = require("../src/domain/entries");

const NOW = Date.parse("2026-08-10T12:00:00.000Z");

function payload(overrides = {}) {
  return {
    text: "A quiet evening.",
    sentiment: "reflective",
    createdAt: new Date(NOW).toISOString(),
    position: { x: 1, y: 2, z: 3 },
    ...overrides
  };
}

test("accepts a well-formed entry and canonicalizes the timestamp", () => {
  const result = validateCreateEntryPayload(payload({ createdAt: "2026-08-10T12:00:00+00:00" }), { now: NOW });

  assert.equal(result.valid, true);
  assert.equal(result.value.createdAt, "2026-08-10T12:00:00.000Z");
  assert.equal(result.value.text, "A quiet evening.");
});

test("case 16: a back-dated timestamp is rejected", () => {
  const thirtyDaysAgo = new Date(NOW - 30 * 24 * 60 * 60 * 1000).toISOString();
  const result = validateCreateEntryPayload(payload({ createdAt: thirtyDaysAgo }), { now: NOW });

  assert.equal(result.valid, false);
  assert.match(result.error, /out of range/);
});

test("a future-dated timestamp is rejected", () => {
  const tomorrow = new Date(NOW + 24 * 60 * 60 * 1000).toISOString();
  const result = validateCreateEntryPayload(payload({ createdAt: tomorrow }), { now: NOW });

  assert.equal(result.valid, false);
  assert.match(result.error, /out of range/);
});

test("case 17: a modest clock skew is tolerated, a large one is not", () => {
  const withinSkew = new Date(NOW + MAX_CLOCK_SKEW_MS - 1000).toISOString();
  assert.equal(validateCreateEntryPayload(payload({ createdAt: withinSkew }), { now: NOW }).valid, true);

  const beyondSkew = new Date(NOW + MAX_CLOCK_SKEW_MS + 1000).toISOString();
  assert.equal(validateCreateEntryPayload(payload({ createdAt: beyondSkew }), { now: NOW }).valid, false);
});

test("still rejects the pre-existing invalid payload shapes", () => {
  const cases = [
    payload({ text: "" }),
    payload({ text: "x".repeat(4001) }),
    payload({ sentiment: "elated" }),
    payload({ position: { x: 1, y: 2 } }),
    payload({ createdAt: "" }),
    payload({ createdAt: "yesterday" })
  ];

  for (const body of cases) {
    assert.equal(validateCreateEntryPayload(body, { now: NOW }).valid, false);
  }
});
