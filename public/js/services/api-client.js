export const SESSION_EXPIRED_MESSAGE = "That session has expired. Sign in to carry on.";

export class ApiClient {
  constructor({ baseUrl, authTokenKey, refreshTokenKey, onAuthLost = null }) {
    this.baseUrl = baseUrl;
    this.authTokenKey = authTokenKey;
    this.refreshTokenKey = refreshTokenKey;
    this.onAuthLost = onAuthLost;
    // One renewal at a time. Bootstrap fires several authed calls at once, and a rotated
    // refresh token is single-use — a second concurrent renewal would spend a dead token.
    this.renewalInFlight = null;
  }

  get token() {
    return localStorage.getItem(this.authTokenKey) || "";
  }

  set token(value) {
    if (value) {
      localStorage.setItem(this.authTokenKey, value);
      return;
    }
    localStorage.removeItem(this.authTokenKey);
  }

  get refreshToken() {
    return localStorage.getItem(this.refreshTokenKey) || "";
  }

  set refreshToken(value) {
    if (value) {
      localStorage.setItem(this.refreshTokenKey, value);
      return;
    }
    localStorage.removeItem(this.refreshTokenKey);
  }

  // Both halves always move together: storing an access token without its refresh token is
  // what produced the hourly logout in the first place.
  setSession(session) {
    this.token = session?.access_token || "";
    this.refreshToken = session?.refresh_token || "";
  }

  clearToken() {
    this.token = "";
    this.refreshToken = "";
  }

  // Resolves true when the session was renewed. Never rejects — a refused refresh means the
  // session is simply over, which every caller handles the same way.
  renewSession() {
    if (this.renewalInFlight) return this.renewalInFlight;

    const refreshToken = this.refreshToken;
    if (!refreshToken) return Promise.resolve(false);

    this.renewalInFlight = (async () => {
      try {
        // auth: false keeps this out of the 401 branch below, so renewal cannot recurse.
        const payload = await this.request("POST", "/auth/refresh", {
          body: { refreshToken },
          auth: false
        });

        if (!payload.session?.access_token) return false;
        this.setSession(payload.session);
        return true;
      } catch (_error) {
        return false;
      } finally {
        this.renewalInFlight = null;
      }
    })();

    return this.renewalInFlight;
  }

  async request(method, path, { body, auth = true, retryOn401 = true } = {}) {
    const headers = { "Content-Type": "application/json" };

    // Lets the server resolve local dates correctly on a first-ever load, before reminder
    // settings (which carry the stored timezone) have been written.
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (timezone) headers["X-Client-Timezone"] = timezone;

    let sentToken = "";
    if (auth) {
      // A reload long after expiry can leave a stale access token, or none at all. Renewing up
      // front beats spending a round trip on a request that is certain to come back 401.
      sentToken = this.token;
      if (!sentToken && this.refreshToken) {
        if (!(await this.renewSession())) {
          // The refresh token is dead; leaving it in storage would fail every later call the
          // same way, so retire the session here rather than asking for a login that cannot work.
          this.clearToken();
          this.onAuthLost?.();
          throw new Error(SESSION_EXPIRED_MESSAGE);
        }
        sentToken = this.token;
      }
      if (!sentToken) throw new Error("Please log in to continue.");
      headers.Authorization = `Bearer ${sentToken}`;
    }

    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined
    });

    if (response.status === 401 && auth) {
      // A parallel request may have already renewed while this one was in flight; in that case
      // the token we sent is simply stale and a plain retry is enough.
      const alreadyRenewed = Boolean(this.token) && this.token !== sentToken;
      if (retryOn401 && (alreadyRenewed || (await this.renewSession()))) {
        return this.request(method, path, { body, auth, retryOn401: false });
      }

      this.clearToken();
      this.onAuthLost?.();
      throw new Error(SESSION_EXPIRED_MESSAGE);
    }

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || "Request failed.");
    }

    return payload;
  }

  get(path, options) {
    return this.request("GET", path, options);
  }

  post(path, body, options = {}) {
    return this.request("POST", path, { ...options, body });
  }

  put(path, body, options = {}) {
    return this.request("PUT", path, { ...options, body });
  }
}
