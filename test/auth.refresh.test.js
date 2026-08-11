const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

// The client is browser ESM, but this package is CommonJS, so `import()` of a .js path here
// would load it as CJS and choke on `export`. Handing the real file's source to Node as a
// data: URL forces module semantics without a build step or a second copy of the logic.
// It has no imports of its own, so there is nothing for the missing base URL to resolve.
const SOURCE_PATH = path.join(__dirname, "..", "public", "js", "services", "api-client.js");

let modulePromise = null;
function loadModule() {
  if (!modulePromise) {
    const source = fs.readFileSync(SOURCE_PATH, "utf8");
    const encoded = Buffer.from(source, "utf8").toString("base64");
    modulePromise = import(`data:text/javascript;base64,${encoded}`);
  }
  return modulePromise;
}

const AUTH_KEY = "test_auth_token";
const REFRESH_KEY = "test_refresh_token";

function makeStorage(seed = {}) {
  const map = new Map(Object.entries(seed));
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
    has: (key) => map.has(key)
  };
}

// `respond` receives each request and returns { status, body }. Every call is recorded so a
// test can assert how many times the refresh endpoint was actually hit.
async function harness({ seed = {}, respond, onAuthLost } = {}) {
  const { ApiClient, SESSION_EXPIRED_MESSAGE } = await loadModule();

  const storage = makeStorage(seed);
  const calls = [];

  globalThis.localStorage = storage;
  globalThis.fetch = async (url, options = {}) => {
    const headers = options.headers || {};
    const authorization = headers.Authorization || null;
    const call = {
      path: String(url).replace(/^\/api/, ""),
      method: options.method,
      token: authorization ? authorization.replace("Bearer ", "") : null,
      body: options.body ? JSON.parse(options.body) : null
    };
    calls.push(call);

    const { status = 200, body = {} } = respond(call, calls.length - 1) || {};
    return {
      status,
      ok: status >= 200 && status < 300,
      json: async () => body
    };
  };

  const api = new ApiClient({
    baseUrl: "/api",
    authTokenKey: AUTH_KEY,
    refreshTokenKey: REFRESH_KEY,
    onAuthLost
  });

  const countOf = (target) => calls.filter((call) => call.path === target).length;
  return { api, calls, storage, countOf, SESSION_EXPIRED_MESSAGE };
}

const session = (n) => ({ access_token: `access-${n}`, refresh_token: `refresh-${n}` });

test("a session stores both halves, and clearing removes both", async () => {
  const { api, storage } = await harness({ respond: () => ({ status: 200, body: {} }) });

  api.setSession(session(1));
  assert.equal(storage.getItem(AUTH_KEY), "access-1");
  assert.equal(storage.getItem(REFRESH_KEY), "refresh-1");

  api.clearToken();
  assert.equal(storage.has(AUTH_KEY), false);
  assert.equal(storage.has(REFRESH_KEY), false);
});

test("an expired access token is renewed and the original request retried", async () => {
  const { api, calls, countOf } = await harness({
    seed: { [AUTH_KEY]: "access-1", [REFRESH_KEY]: "refresh-1" },
    respond: (call) => {
      if (call.path === "/auth/refresh") return { status: 200, body: { session: session(2) } };
      // Only the renewed token is accepted.
      if (call.token === "access-2") return { status: 200, body: { id: "u1" } };
      return { status: 401, body: { error: "Unauthorized." } };
    }
  });

  const me = await api.get("/auth/me");

  assert.deepEqual(me, { id: "u1" });
  assert.equal(countOf("/auth/refresh"), 1);
  assert.deepEqual(
    calls.map((call) => `${call.path}:${call.token || "-"}`),
    ["/auth/me:access-1", "/auth/refresh:-", "/auth/me:access-2"]
  );
});

test("the rotated refresh token replaces the spent one", async () => {
  const { api, calls, storage } = await harness({
    seed: { [AUTH_KEY]: "access-1", [REFRESH_KEY]: "refresh-1" },
    respond: (call) => {
      if (call.path === "/auth/refresh") return { status: 200, body: { session: session(2) } };
      return call.token === "access-2"
        ? { status: 200, body: { ok: true } }
        : { status: 401, body: {} };
    }
  });

  await api.get("/auth/me");

  const refreshCall = calls.find((call) => call.path === "/auth/refresh");
  assert.deepEqual(refreshCall.body, { refreshToken: "refresh-1" });
  assert.equal(storage.getItem(REFRESH_KEY), "refresh-2");
  assert.equal(storage.getItem(AUTH_KEY), "access-2");
});

test("a burst of parallel 401s renews exactly once", async () => {
  const { api, countOf } = await harness({
    seed: { [AUTH_KEY]: "access-1", [REFRESH_KEY]: "refresh-1" },
    respond: (call) => {
      if (call.path === "/auth/refresh") return { status: 200, body: { session: session(2) } };
      return call.token === "access-2"
        ? { status: 200, body: { path: call.path } }
        : { status: 401, body: {} };
    }
  });

  const results = await Promise.all([
    api.get("/entries"),
    api.get("/streak"),
    api.get("/reminders/settings")
  ]);

  assert.deepEqual(
    results.map((result) => result.path),
    ["/entries", "/streak", "/reminders/settings"]
  );
  // A rotated refresh token is single-use; renewing three times would spend two dead tokens.
  assert.equal(countOf("/auth/refresh"), 1);
});

test("a refused refresh ends the session once, with a message that names the cause", async () => {
  let lost = 0;
  const { api, storage, countOf, SESSION_EXPIRED_MESSAGE } = await harness({
    seed: { [AUTH_KEY]: "access-1", [REFRESH_KEY]: "refresh-1" },
    respond: (call) =>
      call.path === "/auth/refresh"
        ? { status: 401, body: { error: "That session has expired." } }
        : { status: 401, body: { error: "Unauthorized." } },
    onAuthLost: () => {
      lost += 1;
    }
  });

  await assert.rejects(() => api.get("/auth/me"), { message: SESSION_EXPIRED_MESSAGE });

  assert.equal(lost, 1);
  assert.equal(storage.has(AUTH_KEY), false);
  assert.equal(storage.has(REFRESH_KEY), false);
  // The refresh attempt must not itself retry-and-refresh.
  assert.equal(countOf("/auth/refresh"), 1);
});

test("a revoked token does not loop: one renewal, then the session ends", async () => {
  const { api, countOf, calls } = await harness({
    seed: { [AUTH_KEY]: "access-1", [REFRESH_KEY]: "refresh-1" },
    // Renewal keeps succeeding, but the API rejects every access token it issues.
    respond: (call) =>
      call.path === "/auth/refresh"
        ? { status: 200, body: { session: session(2) } }
        : { status: 401, body: {} }
  });

  await assert.rejects(() => api.get("/entries"));

  assert.equal(countOf("/auth/refresh"), 1);
  assert.equal(countOf("/entries"), 2);
  assert.equal(calls.length, 3);
});

test("a reload holding only a refresh token renews before spending a doomed request", async () => {
  const { api, calls } = await harness({
    seed: { [REFRESH_KEY]: "refresh-1" },
    respond: (call) =>
      call.path === "/auth/refresh"
        ? { status: 200, body: { session: session(2) } }
        : { status: 200, body: { id: "u1" } }
  });

  const me = await api.get("/auth/me");

  assert.deepEqual(me, { id: "u1" });
  // Renewal comes first: no 401 round trip is wasted.
  assert.deepEqual(
    calls.map((call) => call.path),
    ["/auth/refresh", "/auth/me"]
  );
  assert.equal(calls[1].token, "access-2");
});

test("a dead refresh token on reload retires the session instead of asking for a login", async () => {
  let lost = 0;
  const { api, storage, calls, SESSION_EXPIRED_MESSAGE } = await harness({
    seed: { [REFRESH_KEY]: "refresh-1" },
    respond: () => ({ status: 401, body: { error: "That session has expired." } }),
    onAuthLost: () => {
      lost += 1;
    }
  });

  await assert.rejects(() => api.get("/auth/me"), { message: SESSION_EXPIRED_MESSAGE });

  assert.equal(lost, 1);
  assert.equal(storage.has(REFRESH_KEY), false);
  // Only the renewal was attempted; the doomed /auth/me never went out.
  assert.deepEqual(
    calls.map((call) => call.path),
    ["/auth/refresh"]
  );
});

test("with neither token the client asks for a login instead of calling the API", async () => {
  const { api, calls } = await harness({ respond: () => ({ status: 200, body: {} }) });

  await assert.rejects(() => api.get("/entries"), { message: "Please log in to continue." });
  assert.equal(calls.length, 0);
});

test("an unauthenticated request is never renewed or retried", async () => {
  const { api, calls } = await harness({
    seed: { [REFRESH_KEY]: "refresh-1" },
    respond: () => ({ status: 401, body: { error: "Invalid credentials." } })
  });

  await assert.rejects(() => api.post("/auth/login", { email: "a@b.c" }, { auth: false }), {
    message: "Invalid credentials."
  });

  // A bad password must surface as a bad password, not as an expired session.
  assert.deepEqual(
    calls.map((call) => call.path),
    ["/auth/login"]
  );
});

test("non-401 failures are untouched by the renewal path", async () => {
  const { api, countOf } = await harness({
    seed: { [AUTH_KEY]: "access-1", [REFRESH_KEY]: "refresh-1" },
    respond: () => ({ status: 400, body: { error: "Entry timestamp is out of range." } })
  });

  await assert.rejects(() => api.post("/entries", { text: "hi" }), {
    message: "Entry timestamp is out of range."
  });
  assert.equal(countOf("/auth/refresh"), 0);
});
