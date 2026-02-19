export class ApiClient {
  constructor({ baseUrl, authTokenKey }) {
    this.baseUrl = baseUrl;
    this.authTokenKey = authTokenKey;
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

  clearToken() {
    this.token = "";
  }

  async request(method, path, { body, auth = true } = {}) {
    const headers = { "Content-Type": "application/json" };

    if (auth) {
      const token = this.token;
      if (!token) throw new Error("Please log in to continue.");
      headers.Authorization = `Bearer ${token}`;
    }

    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined
    });

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
}
