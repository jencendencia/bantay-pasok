import * as http from 'http';

/**
 * HTTP client for the LAN sharing server (the client / "second computer" side).
 * Plain Node http on purpose: must run on both Electron 33 (Node 18+, Windows 11)
 * and Electron 22 (Node 16, Windows 7), so no global fetch.
 */

export interface LanResponse {
  ok: boolean;
  status: number;
  body: Record<string, unknown> | null;
  error?: string;
}

/**
 * Normalizes user input into { host, port }.
 * Accepts: '192.168.1.10', '192.168.1.10:4000', 'http://192.168.1.10/',
 * hostnames like 'main-pc.local'. Returns null for empty/garbage input.
 */
export function parseHost(input: string, defaultPort: number): { host: string; port: number } | null {
  let s = String(input ?? '').trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  if (!s) return null;
  let port = defaultPort;
  const m = /^([^:]+):(\d{1,5})$/.exec(s);
  if (m) {
    s = m[1];
    const p = Number(m[2]);
    if (!Number.isInteger(p) || p <= 0 || p > 65535) return null;
    port = p;
  }
  // IPv4 or simple hostname — reject spaces, paths and other junk early.
  if (!/^[A-Za-z0-9._-]+$/.test(s)) return null;
  return { host: s, port };
}

function friendlyError(err: unknown, host: string): string {
  const code = (err as NodeJS.ErrnoException | undefined)?.code;
  const message = err instanceof Error ? err.message : String(err);
  switch (code) {
    case 'ECONNREFUSED':
      return `Nothing is answering at ${host} — check the IP address, and make sure sharing is enabled on the other computer.`;
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
      return `"${host}" is not a valid IP address. Example: 192.168.1.10`;
    case 'ETIMEDOUT':
    case 'EHOSTUNREACH':
    case 'ENETUNREACH':
      return `No response from ${host} — it may be off, on a different network, or blocked by a firewall.`;
    case 'EPERM':
      return `Connection to ${host} was blocked — allow the app through the firewall on both computers.`;
    default:
      if (message === 'timeout') return `No response from ${host} — it may be off or not on the same network.`;
      return `Connection failed: ${message}`;
  }
}

function call(
  target: { host: string; port: number },
  method: 'GET' | 'POST',
  route: string,
  body?: unknown,
  timeoutMs = 8000
): Promise<LanResponse> {
  return new Promise(resolve => {
    const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body), 'utf8');
    const req = http.request(
      {
        host: target.host,
        port: target.port,
        method,
        path: route,
        headers: payload
          ? { 'Content-Type': 'application/json', 'Content-Length': payload.length }
          : undefined,
        timeout: timeoutMs
      },
      res => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          let parsed: Record<string, unknown> | null = null;
          try { parsed = JSON.parse(raw) as Record<string, unknown>; } catch { /* non-JSON */ }
          const status = res.statusCode ?? 0;
          if (status >= 200 && status < 300) {
            resolve({ ok: true, status, body: parsed });
          } else {
            const apiError = parsed && typeof parsed.error === 'string' ? parsed.error : undefined;
            resolve({ ok: false, status, body: parsed, error: apiError ?? `HTTP ${status}` });
          }
        });
      }
    );
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    req.on('error', (err: Error) => {
      resolve({ ok: false, status: 0, body: null, error: friendlyError(err, target.host) });
    });
    if (payload) req.write(payload);
    req.end();
  });
}

/** Sends a request to the host; resolves with a wrapped response (never throws). */
export function lanRequest(
  hostInput: string,
  port: number,
  method: 'GET' | 'POST',
  route: string,
  body?: unknown
): Promise<LanResponse> {
  const target = parseHost(hostInput, port);
  if (!target) {
    return Promise.resolve({
      ok: false,
      status: 0,
      body: null,
      error: `Enter the IP address of the other computer (e.g. 192.168.1.10).`
    });
  }
  return call(target, method, route, body);
}

/** Lightweight reachability check used by "Test and connect" (GET /ping). */
export async function lanProbe(hostInput: string, port: number): Promise<{ ok: boolean; error?: string }> {
  const r = await lanRequest(hostInput, port, 'GET', '/ping', undefined);
  if (r.ok && r.body && r.body.ok === true) return { ok: true };
  return { ok: false, error: r.error ?? 'The other computer did not answer.' };
}