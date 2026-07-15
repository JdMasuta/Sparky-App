// Central fetch wrapper. Sends cookies (admin session) and the CSRF header on
// mutations, and normalizes errors so callers can read err.status / err.field /
// err.message (the backend returns { error, field } on 4xx).
async function request(method, path, body) {
  const opts = { method, headers: {}, credentials: "include" };
  if (body !== undefined) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  if (!["GET", "HEAD"].includes(method)) {
    opts.headers["X-Requested-By"] = "sparky";
  }

  const res = await fetch(`/api${path}`, opts);
  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!res.ok) {
    const err = new Error((data && data.error) || res.statusText || "Request failed");
    err.status = res.status;
    err.field = data && data.field;
    err.body = data;
    throw err;
  }
  return data;
}

export const api = {
  get: (path) => request("GET", path),
  post: (path, body) => request("POST", path, body ?? {}),
  put: (path, body) => request("PUT", path, body ?? {}),
  del: (path) => request("DELETE", path),
};
