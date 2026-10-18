import * as http from 'http';
import type { Announcement, AppData, IpcResult, ScanResult } from '../shared/types';

/**
 * Built-in LAN sharing server (the host / "main computer" side).
 *
 * Serves the app's data over plain HTTP so another computer running the same
 * app in LAN mode can use this machine's database — no extra software to
 * install on either machine.
 *
 * The handlers are the SAME functions the IPC layer registers, so a remote
 * scan, patch or login behaves exactly like a local one (including SMS/email
 * queueing and window broadcasts on this machine).
 *
 * Intentionally unauthenticated: the user opted for "IP address only, no key",
 * so sharing is a host-side toggle that is OFF by default and should stay off
 * on machines nobody connects to.
 *
 * Must stay Node 16-compatible (Electron 22 on Windows 7): no global fetch.
 */

export interface LanHandlers {
  getData(): Promise<AppData>;
  login(username: string, password: string): Promise<IpcResult<{ role: 'admin' | 'teacher' }>>;
  patch(patch: Partial<AppData>): Promise<IpcResult>;
  scan(code: string, nowMs?: number): Promise<IpcResult<ScanResult>>;
  slotReason(slotId: string, date: string, reason: string | null, note: string): Promise<IpcResult>;
  retry(kind: 'sms' | 'email', id: string): Promise<IpcResult>;
  announceAdd(a: Announcement): Promise<IpcResult>;
  announceRemove(id: string): Promise<IpcResult>;
}

/** Bumped on every accepted mutation so clients can poll cheaply (GET /rev). */
let revision = 0;

let server: http.Server | null = null;

export function lanServerRunning(): boolean {
  return server !== null;
}

export async function startLanServer(
  port: number,
  handlers: LanHandlers
): Promise<{ ok: boolean; error?: string }> {
  stopLanServer();
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => { void route(req, res, handlers); });
    let settled = false;
    srv.once('error', (err: NodeJS.ErrnoException) => {
      if (settled) return;
      settled = true;
      resolve({ ok: false, error: friendlyListenError(err, port) });
    });
    srv.listen(port, '0.0.0.0', () => {
      settled = true;
      /* Runtime errors after a successful listen are logged, not fatal. */
      srv.on('error', (err: NodeJS.ErrnoException) => console.error('LAN server error:', err));
      server = srv;
      resolve({ ok: true });
    });
  });
}

export function stopLanServer(): void {
  const srv = server;
  server = null;
  if (!srv) return;
  // Node 18.2+ tears down keep-alive sockets eagerly; harmless when absent.
  try {
    (srv as unknown as { closeAllConnections?: () => void }).closeAllConnections?.();
  } catch { /* not available */ }
  try { srv.close(); } catch { /* already closed */ }
}

function friendlyListenError(err: NodeJS.ErrnoException, port: number): string {
  if (err.code === 'EADDRINUSE') {
    return `Port ${port} is already in use on this computer. Close the other program using it, or change "port" in network.json.`;
  }
  if (err.code === 'EACCES') return `Not allowed to use port ${port} on this computer.`;
  return `Could not start sharing: ${err.message}`;
}

// ---------- request handling ----------

function send(res: http.ServerResponse, status: number, payload: unknown): void {
  if (res.writableEnded) return;
  res.statusCode = status;
  res.end(JSON.stringify(payload));
}

function readJson(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > 256 * 1024 * 1024) {
        reject(new Error('Request too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) { resolve({}); return; }
      try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') resolve(parsed as Record<string, unknown>);
        else reject(new SyntaxError('Invalid JSON body'));
      } catch { reject(new SyntaxError('Invalid JSON body')); }
    });
    req.on('error', reject);
  });
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

async function route(req: http.IncomingMessage, res: http.ServerResponse, h: LanHandlers): Promise<void> {
  const url = (req.url ?? '/').split('?')[0];
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (req.method === 'GET') {
      if (url === '/ping') return send(res, 200, { ok: true, service: 'bantay-pasok' });
      if (url === '/rev') return send(res, 200, { ok: true, rev: revision });
      if (url === '/data') return send(res, 200, { ok: true, data: await h.getData() });
      return send(res, 404, { ok: false, error: 'Not found' });
    }
    if (req.method !== 'POST') return send(res, 404, { ok: false, error: 'Not found' });

    let body: Record<string, unknown>;
    try {
      body = await readJson(req);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return send(res, msg.includes('JSON') ? 400 : 500, { ok: false, error: msg });
    }

    switch (url) {
      case '/login': {
        const result = await h.login(str(body.username), str(body.password));
        return send(res, 200, { result });
      }
      case '/scan': {
        const nowMs = typeof body.nowMs === 'number' ? body.nowMs : undefined;
        const result = await h.scan(String(body.code ?? ''), nowMs);
        revision++;
        return send(res, 200, { result, data: await h.getData() });
      }
      case '/patch': {
        const r = await h.patch((body.patch ?? {}) as Partial<AppData>);
        if (!r.ok) return send(res, 200, { ok: false, error: r.error });
        revision++;
        return send(res, 200, { ok: true, data: await h.getData() });
      }
      case '/slot': {
        const r = await h.slotReason(
          str(body.slotId), str(body.date),
          body.reason === null ? null : str(body.reason),
          str(body.note)
        );
        if (!r.ok) return send(res, 200, { ok: false, error: r.error });
        revision++;
        return send(res, 200, { ok: true, data: await h.getData() });
      }
      case '/retry': {
        const kind = body.kind === 'email' ? 'email' : 'sms';
        const r = await h.retry(kind, str(body.id));
        if (!r.ok) return send(res, 200, { ok: false, error: r.error });
        revision++;
        return send(res, 200, { ok: true, data: await h.getData() });
      }
      case '/announce/add': {
        const r = await h.announceAdd(body.announcement as unknown as Announcement);
        if (!r.ok) return send(res, 200, { ok: false, error: r.error });
        revision++;
        return send(res, 200, { ok: true, data: await h.getData() });
      }
      case '/announce/remove': {
        const r = await h.announceRemove(str(body.id));
        if (!r.ok) return send(res, 200, { ok: false, error: r.error });
        revision++;
        return send(res, 200, { ok: true, data: await h.getData() });
      }
      default:
        return send(res, 404, { ok: false, error: 'Not found' });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    try { send(res, 500, { ok: false, error: msg }); } catch { /* response already closed */ }
  }
}