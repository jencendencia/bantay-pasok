import { SerialPort } from 'serialport';
import type { AppData, SmsMessage } from '../shared/types';

const MAX_ATTEMPTS = 3;
const RETRY_DELAYS = [5_000, 15_000, 30_000];

export class GsmModule {
  private getData: () => AppData;
  private port: SerialPort | null = null;
  private timer: NodeJS.Timeout | null = null;
  private busy = false;
  signal = 0;
  lastError: string | null = null;
  private simSends = 0;
  private portPath = '';
  private baud = 115200;

  constructor(getData: () => AppData) {
    this.getData = getData;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => { void this.tick(); }, 2_000);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.closePort();
  }

  configure(path: string, baud: number): void {
    this.portPath = path;
    this.baud = baud;
    this.closePort();
  }

  /** Builds the parent SMS body for a student scan. */
  static parentBody(kind: 'arrival' | 'departure', name: string, time12: string, punctual?: string, school?: string): string {
    if (kind === 'arrival') {
      const suffix = punctual ? ` (${punctual})` : '';
      return `Bantay Pasok: ${name} arrived at school at ${time12}${suffix}. - ${school || ''}`.trim();
    }
    return `Bantay Pasok: ${name} left school at ${time12}. - ${school || ''}`.trim();
  }

  enqueue(d: AppData, msg: Omit<SmsMessage, 'id' | 'status' | 'attempts'>): void {
    d.sms.push({
      ...msg,
      id: `sms_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      status: 'pending',
      attempts: 0
    });
  }

  /** Periodic drain of the SMS queue. */
  async tick(): Promise<void> {
    if (this.busy) return;
    const d = this.getData();
    const now = Date.now();
    const due = d.sms.find(m =>
      m.status === 'pending' ||
      (m.status === 'retrying' && (m.nextRetryTs ?? 0) <= now)
    );
    if (!due) { this.lastError = null; return; }
    this.busy = true;
    try {
      await this.send(d, due);
      due.status = 'sent';
      due.sentTs = Date.now();
      this.signal = 4;
      this.lastError = null;
    } catch (err) {
      due.attempts += 1;
      due.lastError = err instanceof Error ? err.message : String(err);
      this.lastError = due.lastError;
      if (due.attempts >= MAX_ATTEMPTS) {
        due.status = 'failed';
      } else {
        due.status = 'retrying';
        due.nextRetryTs = Date.now() + RETRY_DELAYS[Math.min(due.attempts - 1, RETRY_DELAYS.length - 1)];
      }
    } finally {
      this.busy = false;
    }
  }

  retryFailed(d: AppData, id: string): void {
    const m = d.sms.find(x => x.id === id);
    if (m && m.status === 'failed') {
      m.status = 'pending';
      m.attempts = 0;
      m.nextRetryTs = undefined;
    }
  }

  private async send(d: AppData, msg: SmsMessage): Promise<void> {
    if (d.settings.gsmSimulated || !d.settings.gsmPort) {
      this.simSends += 1;
      if (this.simSends % 17 === 0) throw new Error('Modem busy (simulated fault)');
      return;
    }
    await this.sendSerial(msg.to, msg.body);
  }

  private async sendSerial(to: string, body: string): Promise<void> {
    if (!this.port || !this.port.isOpen) {
      this.port = await this.openPort();
    }
    const port = this.port;
    const cmd = (c: string, waitMs: number): Promise<string> =>
      new Promise((resolve, reject) => {
        let buf = '';
        const onData = (chunk: Buffer) => {
          buf += chunk.toString('utf-8');
          if (buf.includes('OK') || buf.includes('ERROR')) {
            port.off('data', onData);
            resolve(buf);
          }
        };
        port.on('data', onData);
        port.write(c, (err) => {
          if (err) { port.off('data', onData); reject(err); }
        });
        setTimeout(() => {
          port.off('data', onData);
          if (buf.includes('ERROR')) reject(new Error('Modem returned ERROR'));
          else resolve(buf);
        }, waitMs);
      });

    await cmd('AT\r\n', 800);
    await cmd('AT+CMGF=1\r\n', 800);
    await cmd(`AT+CMGS="${to}"\r\n`, 1200);
    await cmd(body + '\u001A', 6000);
  }

  private openPort(): Promise<SerialPort> {
    return new Promise((resolve, reject) => {
      if (!this.portPath) { reject(new Error('No GSM port configured')); return; }
      const p = new SerialPort({ path: this.portPath, baudRate: this.baud, autoOpen: false });
      p.open((err) => { if (err) reject(err); else resolve(p); });
    });
  }

  private closePort(): void {
    if (this.port) {
      try { this.port.close(); } catch { /* ignore */ }
      this.port = null;
    }
  }
}
