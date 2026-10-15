// Orchestrator control API (#25, SECURITY.md trust boundary 3). Listens only
// on the internal control network (never published) and accepts only the
// ACTIVE app container's token. A fixed set of verbs; none takes an image
// reference or a command.
//
//   GET    /v1/check   current vs latest release, window, update status
//   POST   /v1/update  queue the latest release (runs inside the window)
//   DELETE /v1/update  cancel a queued update (until the handover commits)
//   GET    /v1/status  update status
import http from "node:http";

const ROUTES = {
  "GET /v1/check": async (o) => [200, await o.check()],
  "POST /v1/update": async (o) => [202, await o.queueUpdate()],
  "DELETE /v1/update": async (o) => {
    const result = await o.cancelUpdate();
    return [result.state === "canceling" ? 202 : 200, result];
  },
  "GET /v1/status": async (o) => [200, o.status()],
};

/**
 * @param {object} o
 * @param {{ authorize(h: string): boolean, check(): Promise<object>, queueUpdate(): Promise<object>,
 *           cancelUpdate(): Promise<object>, status(): object }} o.orchestrator
 * @param {(msg: string) => void} [o.log]
 */
export function createControlServer({ orchestrator, log = () => {} }) {
  const server = http.createServer(async (req, res) => {
    const send = (status, body) => {
      res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      res.end(JSON.stringify(body));
    };
    req.resume(); // no verb takes a body; discard anything sent
    const route = ROUTES[`${req.method} ${req.url.split("?")[0]}`];
    if (!route) return send(404, { error: "Not found" });
    if (!orchestrator.authorize(req.headers.authorization)) return send(401, { error: "Unauthorized" });
    try {
      const [status, body] = await route(orchestrator);
      send(status, body);
    } catch (err) {
      if (!err.status) log(`${req.method} ${req.url}: ${err.stack || err.message}`);
      send(err.status || 500, { error: err.status ? err.message : "Internal error" });
    }
  });
  server.requestTimeout = 60_000;
  return server;
}
