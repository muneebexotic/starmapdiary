const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

// Same trick as auth.refresh.test.js: the parser is browser ESM in a CommonJS package, so its
// real source is handed to Node as a data: URL rather than duplicated here. It imports nothing,
// so the missing base URL has nothing to resolve.
const SOURCE_PATH = path.join(__dirname, "..", "public", "js", "services", "auth-handoff.js");

let modulePromise = null;
function loadModule() {
  if (!modulePromise) {
    const source = fs.readFileSync(SOURCE_PATH, "utf8");
    const encoded = Buffer.from(source, "utf8").toString("base64");
    modulePromise = import(`data:text/javascript;base64,${encoded}`);
  }
  return modulePromise;
}

test("an ordinary visit carries no handoff", async () => {
  const { parseAuthHandoff } = await loadModule();

  assert.equal(parseAuthHandoff(""), null);
  assert.equal(parseAuthHandoff("#"), null);
  assert.equal(parseAuthHandoff(undefined), null);
  // The app uses fragments of its own elsewhere; only Supabase's shape should be claimed.
  assert.equal(parseAuthHandoff("#reader/2026-08-11"), null);
});

test("a confirmed signup hands over both halves of the session", async () => {
  const { parseAuthHandoff } = await loadModule();

  const handoff = parseAuthHandoff(
    "#access_token=eyJhbGciOi.abc&expires_in=3600&refresh_token=r0tat3d&token_type=bearer&type=signup"
  );

  assert.equal(handoff.session.access_token, "eyJhbGciOi.abc");
  // Storing the access token without its refresh token is what produced the hourly logout.
  assert.equal(handoff.session.refresh_token, "r0tat3d");
  assert.equal(handoff.type, "signup");
  assert.equal(handoff.error, undefined);
});

test("a leading hash is optional", async () => {
  const { parseAuthHandoff } = await loadModule();

  const withHash = parseAuthHandoff("#access_token=a&refresh_token=b&type=signup");
  const without = parseAuthHandoff("access_token=a&refresh_token=b&type=signup");

  assert.deepEqual(withHash, without);
});

test("a spent or stale link explains itself and points somewhere", async () => {
  const { parseAuthHandoff } = await loadModule();

  const handoff = parseAuthHandoff(
    "#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired"
  );

  assert.equal(handoff.session, undefined);
  assert.match(handoff.error, /expired/i);
  // The way out matters more than the diagnosis: a fresh link is one sign-in away.
  assert.match(handoff.error, /sign in/i);
});

test("an unfamiliar failure falls back to Supabase's own wording, plus-decoded", async () => {
  const { parseAuthHandoff } = await loadModule();

  const handoff = parseAuthHandoff(
    "#error=server_error&error_description=Database+error+saving+new+user"
  );

  assert.equal(handoff.error, "Database error saving new user");
});

test("a failure with no description still says something", async () => {
  const { parseAuthHandoff } = await loadModule();

  const handoff = parseAuthHandoff("#error=access_denied");

  assert.equal(handoff.session, undefined);
  assert.ok(handoff.error.length > 0);
});
