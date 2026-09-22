import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import type { AppData, EmailMessage } from '../shared/types';

const MAX_ATTEMPTS = 3;
const RETRY_DELAYS = [5_000, 15_000, 30_000];

export class EmailModule {
  private getData: () => AppData;
  private transport: Transporter | null = null;
  private transportKey = ''; // user|pass|host|port of the current transport
  private timer: NodeJS.Timeout | null = null;
  private busy = false;
  private simSends = 0;
  lastError: string | null = null;

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
    void this.closeTransport();
  }

  /** Builds the parent email subject and body for a student scan. */
  static parentMail(kind: 'arrival' | 'departure', name: string, time12: string, punctual?: string, school?: string): { subject: string; body: string } {
    const tag = kind === 'arrival' ? 'Arrival' : 'Departure';
    const subject = `[${school || 'School'}] ${tag} notice - ${name}`;
    const punct = punctual ? ` Status: ${punctual}.` : '';
    const body = kind === 'arrival'
      ? `Good day!\n\n${name} arrived at school at ${time12}.${punct}\n\n- Bantay Pasok Attendance Monitor${school ? `, ${school}` : ''}`
      : `Good day!\n\n${name} left school at ${time12}. Thank you and safe travels.\n\n- Bantay Pasok Attendance Monitor${school ? `, ${school}` : ''}`;
    return { subject, body };
  }

  enqueue(d: AppData, msg: Omit<EmailMessage, 'id' | 'status' | 'attempts'>): void {
    d.emails.push({
      ...msg,
      id: `em_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      status: 'pending',
      attempts: 0
    });
  }

  /** Periodic drain of the email queue. */
  async tick(): Promise<void> {
    if (this.busy) return;
    const d = this.getData();
    const now = Date.now();
    const due = d.emails.find(m =>
      m.status === 'pending' ||
      (m.status === 'retrying' && (m.nextRetryTs ?? 0) <= now)
    );
    if (!due) { this.lastError = null; return; }
    this.busy = true;
    try {
      await this.send(d, due);
      due.status = 'sent';
      due.sentTs = Date.now();
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
    const m = d.emails.find(x => x.id === id);
    if (m && m.status === 'failed') {
      m.status = 'pending';
      m.attempts = 0;
      m.nextRetryTs = undefined;
    }
  }

  private async send(d: AppData, msg: EmailMessage): Promise<void> {
    const s = d.settings;
    if (!s.smtpUser || !s.smtpPass) {
      // No credentials configured: behave like SMS simulation mode so the
      // flow still works out of the box for demo/testing purposes.
      this.simSends += 1;
      if (this.simSends % 17 === 0) throw new Error('SMTP busy (simulated fault)');
      return;
    }
    await this.sendGmail(s.smtpHost, s.smtpPort, s.smtpSecure, s.smtpUser, s.smtpPass, msg.to, msg.subject, msg.body, s.emailFromName);
  }

  private async sendGmail(
    host: string, port: number, secure: boolean,
    user: string, pass: string,
    to: string, subject: string, body: string, fromName: string
  ): Promise<void> {
    const key = `${user}|${pass}|${host}|${port}`;
    if (!this.transport || this.transportKey !== key) {
      await this.closeTransport();
      this.transport = nodemailer.createTransport({
        host,
        port,
        secure,
        auth: { user, pass }
      });
      this.transportKey = key;
    }
    await this.transport.sendMail({
      from: `"${fromName}" <${user}>`,
      to,
      subject,
      text: body
    });
  }

  /** Verify SMTP credentials on demand (Settings → Test connection). */
  async verify(user: string, pass: string, host: string, port: number, secure: boolean): Promise<void> {
    const t = nodemailer.createTransport({ host, port, secure, auth: { user, pass } });
    try {
      await t.verify();
    } finally {
      void t.close();
    }
  }

  private async closeTransport(): Promise<void> {
    if (this.transport) {
      try { this.transport.close(); } catch { /* ignore */ }
      this.transport = null;
      this.transportKey = '';
    }
  }
}
