import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { LAN_PORT } from '../shared/constants';
import type { NetConfig } from '../shared/types';

/**
 * Network / storage-mode configuration (Settings → Database).
 * Persisted as `network.json` next to data.json / bantay-pasok.db:
 *   { "mode": "local" | "lan", "host": "192.168.1.10", "share": false, "port": 39500 }
 */

export function defaultNetConfig(): NetConfig {
  return { mode: 'local', host: '', share: false, port: LAN_PORT };
}

function configPath(dataDir: string): string {
  return path.join(dataDir, 'network.json');
}

export function loadNetConfig(dataDir: string): NetConfig {
  try {
    const parsed = JSON.parse(fs.readFileSync(configPath(dataDir), 'utf-8')) as Partial<NetConfig>;
    const port = parsed.port;
    return {
      mode: parsed.mode === 'lan' ? 'lan' : 'local',
      host: typeof parsed.host === 'string' ? parsed.host.trim() : '',
      share: parsed.share === true,
      port: Number.isInteger(port) && (port as number) > 0 ? (port as number) : LAN_PORT
    };
  } catch {
    return defaultNetConfig();
  }
}

export function saveNetConfig(dataDir: string, cfg: NetConfig): void {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(configPath(dataDir), JSON.stringify(cfg, null, 2), 'utf-8');
}

/** IPv4 addresses other LAN computers can reach this machine on (Settings hint). */
export function localLanIps(): string[] {
  const out: string[] = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const iface of list ?? []) {
      // Node reports family as 'IPv4' (Node < 18) and sometimes as 4 — accept both.
      const family = (iface as { family?: string | number }).family;
      if ((family === 'IPv4' || family === 4) && !iface.internal && iface.address) {
        out.push(iface.address);
      }
    }
  }
  return out;
}