import React, { useState } from 'react';
import { useData } from '../store';
import { api } from '../api';
import type { DbConfigView } from '../api';
import { Modal, Pill, confirmDialog } from '../ui';
import { hashPassword } from '../shared/seed';
import { monogramOf } from '../shared/constants';
import type { Settings, User, UpdateStatusInfo } from '../shared/types';

export default function SettingsPage(): React.ReactElement {
  const { data, refresh } = useData();
  const [addingUser, setAddingUser] = useState(false);
  const [draft, setDraft] = useState<Settings | null>(null);
  const [usersDraft, setUsersDraft] = useState<User[] | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [verifyState, setVerifyState] = useState<'idle' | 'busy' | 'ok' | 'fail'>('idle');
  const [verifyMsg, setVerifyMsg] = useState<string | null>(null);
  const [dbState, setDbState] = useState<{ enabled: boolean; lastError: string | null } | null>(null);
  const [dbForm, setDbForm] = useState<DbConfigView | null>(null);
  const [dbMsg, setDbMsg] = useState<string | null>(null);
  const [dbBusy, setDbBusy] = useState(false);
  const [upd, setUpd] = useState<UpdateStatusInfo | null>(null);
  const [updBusy, setUpdBusy] = useState(false);
  const [tokenMsg, setTokenMsg] = useState<string | null>(null);
  React.useEffect(() => {
    void api.updateStatus().then(res => { if (res.ok && res.data) setUpd(res.data); });
    // Live progress while the updater downloads in the main process.
    const off = api.onUpdateEvent(e => {
      setUpd(prev => (prev ? { ...prev, state: e.state, progress: e.progress, error: e.error ?? null, version: e.version ?? prev.version } : prev));
    });
    return off;
  }, []);
  React.useEffect(() => {
    void (async () => {
      const res = await api.dbStatus();
      if (res.ok && res.data) {
        setDbState({ enabled: res.data.enabled, lastError: res.data.lastError });
        setDbForm(res.data.config);
      }
    })();
  }, []);
  // Edits stay in a local draft until "Save changes"; the effect re-syncs the draft whenever
  // saved data changes (initial load, or after a save round-trips through the store → SQLite).
  // NOTE: must stay before any early return (rules of hooks) — deep-links load this page
  // before data arrives, and an extra hook after the guard crashed the page.
  React.useEffect(() => { if (data) setDraft(data.settings); }, [data?.settings]);
  if (!data) return <div className="empty">Loading…</div>;
  const s = draft ?? data.settings;

  const setS = (patch: Partial<Settings>): void => {
    setDraft(d => ({ ...(d ?? data.settings), ...patch }));
    setDirty(true);
  };

  const saveAll = async (): Promise<void> => {
    setSaving(true);
    await api.patchData({ settings: draft ?? data.settings, users: usersDraft ?? data.users });
    await refresh();
    setSaving(false);
    setDirty(false);
    setSavedFlash(true);
    window.setTimeout(() => setSavedFlash(false), 3200);
  };

  const smsRows = [...data.sms].sort((a, b) => b.ts - a.ts).slice(0, 15);
  const emailRows = [...(data.emails ?? [])].sort((a, b) => b.ts - a.ts).slice(0, 15);

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">Settings</h1>
          <div className="page-sub">Users, time rules, GSM module and holidays</div>
        </div>
      </div>

      <div className="grid-2">
        <div className="stack">
          <div className="card">
            <h3>School</h3>
            <div className="field">
              <label>School name (shown on the scanner, SMS, emails and ID cards)</label>
              <input
                value={s.schoolName ?? ''}
                placeholder="Mabuhay National High School"
                onChange={e => setS({ schoolName: e.target.value })}
              />
              <div className="card-note">
                ID card monograms, the scanner badge and SMS/email sign-offs all follow this name.
                Current monogram: <b>{monogramOf(s.schoolName ?? '')}</b>
              </div>
            </div>
          </div>

          <div className="card">
            <h3>Time rules</h3>
            <div className="form-row">
              <div className="field">
                <label>Early cutoff (arrivals before this are "early")</label>
                <input type="time" value={s.earlyCutoff} onChange={e => void setS({ earlyCutoff: e.target.value })} />
              </div>
              <div className="field">
                <label>Late after (students)</label>
                <input type="time" value={s.lateAfter} onChange={e => void setS({ lateAfter: e.target.value })} />
              </div>
            </div>
            <div className="field">
              <label>Teacher grace period (minutes after a slot starts)</label>
              <input
                type="number" min={0} max={30} value={s.graceMinutes}
                onChange={e => void setS({ graceMinutes: Number(e.target.value) })}
              />
              <div className="card-note">Teachers and students get a {s.graceMinutes}-minute grace period after a slot's start time before they are marked late.</div>
            </div>
          </div>

          <div className="card">
            <h3>GSM module</h3>
            <label style={{ display: 'flex', gap: 10, alignItems: 'center', fontWeight: 600, fontSize: 14, marginBottom: 10 }}>
              <input type="checkbox" checked={s.smsEnabled} onChange={e => void setS({ smsEnabled: e.target.checked })} />
              Send SMS to parents on scan
            </label>
            <label style={{ display: 'flex', gap: 10, alignItems: 'center', fontWeight: 600, fontSize: 14, marginBottom: 10 }}>
              <input type="checkbox" checked={s.gsmSimulated} onChange={e => void setS({ gsmSimulated: e.target.checked })} />
              Simulation mode (no modem needed)
            </label>
            <div className="form-row">
              <div className="field">
                <label>Serial port</label>
                <input value={s.gsmPort} placeholder="COM3 or /dev/ttyUSB0" onChange={e => void setS({ gsmPort: e.target.value })} />
              </div>
              <div className="field">
                <label>Baud rate</label>
                <select value={s.gsmBaud} onChange={e => void setS({ gsmBaud: Number(e.target.value) })}>
                  {[9600, 57600, 115200].map(b => <option key={b} value={b}>{b}</option>)}
                </select>
              </div>
            </div>
            <div className="card-note">
              Plug the GSM modem (SIM800L / SIM7600) into the port, disable simulation, and texts go out over AT commands.
              Failed texts retry automatically up to 3 times and appear in the sidebar until sent.
            </div>
          </div>

          <div className="card">
            <h3>Gmail / Email setup</h3>
            <label style={{ display: 'flex', gap: 10, alignItems: 'center', fontWeight: 600, fontSize: 14, marginBottom: 10 }}>
              <input type="checkbox" checked={s.emailEnabled} onChange={e => void setS({ emailEnabled: e.target.checked })} />
              Send email to parents on scan
            </label>
            <div className="form-row">
              <div className="field">
                <label>SMTP server</label>
                <input value={s.smtpHost} placeholder="smtp.gmail.com" onChange={e => void setS({ smtpHost: e.target.value })} />
              </div>
              <div className="field" style={{ maxWidth: 130 }}>
                <label>Port</label>
                <select
                  value={s.smtpPort}
                  onChange={e => {
                    const port = Number(e.target.value);
                    void setS({ smtpPort: port, smtpSecure: port === 465 });
                  }}
                >
                  <option value={465}>465 (SSL)</option>
                  <option value={587}>587 (TLS)</option>
                </select>
              </div>
            </div>
            <div className="field">
              <label>Gmail address</label>
              <input type="email" value={s.smtpUser} placeholder="school.notifications@gmail.com" onChange={e => void setS({ smtpUser: e.target.value })} />
            </div>
            <div className="field">
              <label>Gmail App Password (16 characters)</label>
              <input type="password" value={s.smtpPass} placeholder="abcd efgh ijkl mnop" onChange={e => void setS({ smtpPass: e.target.value })} />
            </div>
            <div className="field">
              <label>From name (shown on outgoing mail)</label>
              <input value={s.emailFromName} placeholder="Bantay Pasok" onChange={e => void setS({ emailFromName: e.target.value })} />
            </div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 4 }}>
              <button
                className="btn primary small"
                disabled={verifyState === 'busy' || !s.smtpUser || !s.smtpPass}
                onClick={async () => {
                  setVerifyState('busy');
                  const res = await api.smtpVerify({ host: s.smtpHost, port: s.smtpPort, secure: s.smtpSecure, user: s.smtpUser, pass: s.smtpPass });
                  setVerifyState(res.ok ? 'ok' : 'fail');
                  setVerifyMsg(res.ok ? 'Credentials verified — test email path works.' : (res.error ?? 'Verification failed.'));
                }}
              >
                {verifyState === 'busy' ? 'Checking…' : 'Test connection'}
              </button>
              {verifyState === 'ok' && <Pill color="green">Connection OK</Pill>}
              {verifyState === 'fail' && <Pill color="red">Failed</Pill>}
            </div>
            {verifyMsg && verifyState === 'fail' && <div className="card-note" style={{ color: 'var(--red)' }}>{verifyMsg}</div>}
            <div className="card-note" style={{ marginTop: 8 }}>
              Gmail requires an <b>App Password</b>, not your normal login password: Google Account → Security → 2-Step Verification → App passwords.
              With no credentials set, emails are simulated so the flow still works for testing.
              Emails go to the guardian's email address; failures retry automatically up to 3 times.
            </div>
          </div>

          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3>Software updates</h3>
              {upd && <Pill color={upd.state === 'downloaded' ? 'green' : upd.state === 'error' ? 'red' : 'gray'}>v{upd.currentVersion}</Pill>}
            </div>
            {upd && (
              <>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginTop: 4 }}>
                  <button
                    className="btn primary small"
                    disabled={updBusy || upd.state === 'downloading' || upd.state === 'available' || upd.state === 'downloaded'}
                    onClick={async () => {
                      setUpdBusy(true);
                      const res = await api.updateCheck();
                      if (res.ok && res.data) setUpd(res.data);
                      setUpdBusy(false);
                    }}
                  >
                    Check for updates
                  </button>
                  {upd.state === 'available' && (
                    <button
                      className="btn primary small"
                      disabled={updBusy}
                      onClick={async () => {
                        setUpdBusy(true);
                        const res = await api.updateDownload();
                        if (res.ok && res.data) setUpd(res.data);
                        setUpdBusy(false);
                      }}
                    >
                      Download update
                    </button>
                  )}
                  {upd.state === 'downloaded' && (
                    <button
                      className="btn yellow small"
                      onClick={async () => {
                        if (await confirmDialog({ message: `Install version ${upd.downloadedVersion ?? upd.version ?? ''} now? The app will close and reopen.`, confirmLabel: 'Install now' })) void api.updateInstall();
                      }}
                    >
                      Restart &amp; install v{upd.downloadedVersion ?? upd.version}
                    </button>
                  )}
                </div>
                {upd.state === 'downloading' && (
                  <div style={{ height: 6, background: 'var(--line)', borderRadius: 99, marginTop: 10, overflow: 'hidden' }}>
                    <div style={{ width: `${upd.progress}%`, height: '100%', background: 'var(--green)', transition: 'width .3s' }} />
                  </div>
                )}
                <div className="card-note" style={{ marginTop: 8 }}>
                  {upd.state === 'checking' && <>Checking GitHub for a newer version…</>}
                  {upd.state === 'available' && <>New version <b>v{upd.version}</b> is available — click “Download update”.</>}
                  {upd.state === 'not-available' && <>You are on the latest version (v{upd.currentVersion}).</>}
                  {upd.state === 'downloading' && <>Downloading… {upd.progress}%</>}
                  {upd.state === 'downloaded' && <>Version <b>v{upd.downloadedVersion ?? upd.version}</b> is ready — click “Restart &amp; install”.</>}
                  {upd.state === 'error' && <span style={{ color: 'var(--red)' }}>{upd.error}</span>}
                  {upd.state === 'idle' && <>The app also checks automatically after every restart.</>}
                </div>
                <div className="field" style={{ marginTop: 10 }}>
                  <label>GitHub token (private repository only — public releases need nothing here)</label>
                  <input
                    type="password"
                    placeholder="ghp_…  (stored only on this computer)"
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        const el = e.target as HTMLInputElement;
                        if (el.value.trim()) {
                          void api.updateSetToken(el.value.trim()).then(r => setTokenMsg(r.ok ? 'Token saved on this computer.' : r.error ?? 'Failed to save'));
                        }
                      }
                    }}
                  />
                  {tokenMsg && <div className="card-note">{tokenMsg}</div>}
                  <div className="card-note">
                    Updates come from the app's GitHub Releases. For a private repo, paste a token with <b>Contents: Read</b> access and press Enter.
                  </div>
                </div>
              </>
            )}
            {!upd && <div className="card-note">Software updates are only available in the installed desktop app.</div>}
          </div>

          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3>SQLite database</h3>
              {dbState && <Pill color={dbState.enabled ? 'green' : 'gray'}>{dbState.enabled ? 'Connected' : 'Local JSON'}</Pill>}
            </div>
            {dbForm && (
              <>
                <label style={{ display: 'flex', gap: 10, alignItems: 'center', fontWeight: 600, fontSize: 14, margin: '10px 0' }}>
                  <input
                    type="checkbox"
                    checked={dbForm.enabled}
                    onChange={e => setDbForm({ ...dbForm, enabled: e.target.checked })}
                  />
                  Store attendance in SQLite (JSON stays as automatic backup)
                </label>
                <div className="field">
                  <label>Database file (created automatically)</label>
                  <input value={dbForm.file} placeholder="Leave empty for the default location" onChange={e => setDbForm({ ...dbForm, file: e.target.value })} />
                </div>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginTop: 4 }}>
                  <button
                    className="btn ghost small"
                    disabled={dbBusy}
                    onClick={async () => {
                      setDbBusy(true); setDbMsg(null);
                      const res = await api.saveDbConfig(dbForm, true);
                      setDbMsg(res.ok && res.data?.ok ? `Connection OK — SQLite ${res.data.version}` : (res.data?.error ?? res.error ?? 'Failed'));
                      setDbBusy(false);
                    }}
                  >
                    Test connection
                  </button>
                  <button
                    className="btn primary small"
                    disabled={dbBusy}
                    onClick={async () => {
                      setDbBusy(true); setDbMsg(null);
                      const saveRes = await api.saveDbConfig(dbForm, false);
                      if (saveRes.ok) {
                        if (dbForm.enabled) {
                          const conn = await api.dbConnect();
                          setDbMsg(conn.ok ? 'Connected. Tables are created automatically; the local data was imported if the database was empty.' : conn.error ?? 'Connection failed');
                        } else {
                          await api.dbDisconnect();
                          setDbMsg('Using local JSON storage.');
                        }
                        const st = await api.dbStatus();
                        if (st.ok && st.data) setDbState({ enabled: st.data.enabled, lastError: st.data.lastError });
                      } else {
                        setDbMsg(saveRes.error ?? 'Failed to save');
                      }
                      setDbBusy(false);
                    }}
                  >
                    Save and connect
                  </button>
                  {dbState?.enabled && (
                    <button
                      className="btn ghost small"
                      disabled={dbBusy}
                      onClick={async () => {
                        setDbBusy(true); setDbMsg(null);
                        const res = await api.dbImportJson();
                        setDbMsg(res.ok ? 'Local data.json imported into SQLite.' : res.error ?? 'Import failed');
                        setDbBusy(false);
                      }}
                    >
                      Import data.json now
                    </button>
                  )}
                </div>
                {dbMsg && <div className="card-note" style={{ marginTop: 8 }}>{dbMsg}</div>}
                {dbState?.lastError && (
                  <div className="card-note" style={{ color: 'var(--red)', marginTop: 4 }}>Last database error: {dbState.lastError}</div>
                )}
                <div className="card-note" style={{ marginTop: 8 }}>
                  Every save writes to data.json first, then syncs to the local SQLite database file — the kiosk keeps working even if the file is locked or moved.
                  Settings, holidays and borrowed classes are stored too. Turning this off keeps all data in the local JSON file.
                </div>
              </>
            )}
          </div>

          <div className="card">
            <h3>Holidays</h3>
            <div className="field">
              <label>Add a holiday date (no classes, holiday greeting shows)</label>
              <input
                type="date"
                onChange={e => {
                  const v = e.target.value;
                  if (v && !s.holidayDates.includes(v)) void setS({ holidayDates: [...s.holidayDates, v] });
                }}
              />
            </div>
            <div className="toolbar">
              {s.holidayDates.map(h => (
                <span key={h} className="pill yellow" style={{ cursor: 'pointer' }} onClick={() => void setS({ holidayDates: s.holidayDates.filter(x => x !== h) })}>
                  {h} ✕
                </span>
              ))}
              {s.holidayDates.length === 0 && <span className="card-note">No holidays set</span>}
            </div>
          </div>
        </div>

        <div className="stack">
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3>Users</h3>
              <button className="btn yellow small" onClick={() => setAddingUser(true)}>＋ Add user</button>
            </div>
            <table className="table">
              <thead><tr><th>Username</th><th>Role</th><th></th></tr></thead>
              <tbody>
                {data.users.map(u => (
                  <tr key={u.id}>
                    <td><b>{u.username}</b> <span style={{ color: 'var(--muted)' }}>({u.displayName})</span></td>
                    <td><Pill color={u.role === 'admin' ? 'green' : 'blue'}>{u.role}</Pill></td>
                    <td style={{ textAlign: 'right' }}>
                      {data.users.length > 1 && (
                        <button className="btn ghost small" onClick={async () => {
                          if (!(await confirmDialog({ message: `Delete the account "${u.username}"?`, destructive: true }))) return;
                          setUsersDraft((usersDraft ?? data.users).filter(x => x.id !== u.id));
                          setDirty(true);
                        }}>🗑</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="card-note">Default login: admin / admin123</div>
          </div>

          <div className="card">
            <h3>Terms</h3>
            {s.terms.map((t, i) => (
              <div className="form-row" key={t.name}>
                <div className="field"><label>{t.name} start</label>
                  <input type="date" value={t.start} onChange={e => {
                    const terms = [...s.terms];
                    terms[i] = { ...t, start: e.target.value };
                    void setS({ terms });
                  }} />
                </div>
                <div className="field"><label>end</label>
                  <input type="date" value={t.end} onChange={e => {
                    const terms = [...s.terms];
                    terms[i] = { ...t, end: e.target.value };
                    void setS({ terms });
                  }} />
                </div>
              </div>
            ))}
          </div>

          <div className="card">
            <h3>SMS log</h3>
            <table className="table">
              <thead><tr><th>Time</th><th>To</th><th>Message</th><th>Status</th></tr></thead>
              <tbody>
                {smsRows.map(m => (
                  <tr key={m.id}>
                    <td style={{ whiteSpace: 'nowrap' }}>{new Date(m.ts).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' })}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{m.to}</td>
                    <td style={{ fontSize: 12.5 }}>{m.body}</td>
                    <td>
                      <Pill color={m.status === 'sent' ? 'green' : m.status === 'failed' ? 'red' : 'orange'}>{m.status}</Pill>
                      {m.status === 'failed' && (
                        <button className="btn ghost small" style={{ marginLeft: 6 }} onClick={async () => {
                          await api.smsRetry(m.id);
                          void refresh();
                        }}>Retry</button>
                      )}
                    </td>
                  </tr>
                ))}
                {smsRows.length === 0 && <tr><td colSpan={4} className="empty">No texts yet</td></tr>}
              </tbody>
            </table>
          </div>

          <div className="card">
            <h3>Email log</h3>
            <table className="table">
              <thead><tr><th>Time</th><th>To</th><th>Subject</th><th>Status</th></tr></thead>
              <tbody>
                {emailRows.map(m => (
                  <tr key={m.id}>
                    <td style={{ whiteSpace: 'nowrap' }}>{new Date(m.ts).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' })}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{m.to}</td>
                    <td style={{ fontSize: 12.5 }}>{m.subject}</td>
                    <td>
                      <Pill color={m.status === 'sent' ? 'green' : m.status === 'failed' ? 'red' : 'orange'}>{m.status}</Pill>
                      {m.status === 'failed' && (
                        <button className="btn ghost small" style={{ marginLeft: 6 }} onClick={async () => {
                          await api.emailRetry(m.id);
                          void refresh();
                        }}>Retry</button>
                      )}
                    </td>
                  </tr>
                ))}
                {emailRows.length === 0 && <tr><td colSpan={4} className="empty">No emails yet</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className={`save-bar ${(dirty || savedFlash) ? 'show' : ''}`}>
        {saving ? (
          <span className="save-bar-note">Saving…</span>
        ) : dirty ? (
          <>
            <span className="save-bar-note">You have unsaved changes — nothing is applied until you save.</span>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn ghost small" disabled={saving} onClick={() => { setDraft(data.settings); setUsersDraft(data.users); setDirty(false); }}>
                Discard
              </button>
              <button className="btn primary small" disabled={!dirty || saving} onClick={() => void saveAll()}>
                Save changes
              </button>
            </div>
          </>
        ) : (
          <span className="save-bar-note" style={{ color: 'var(--green-700)', fontWeight: 700 }}>✓ All changes saved</span>
        )}
      </div>

      {addingUser && (
        <Modal title="Add a user" onClose={() => setAddingUser(false)} width={460}>
          <AddUser onDone={u => {
            setUsersDraft([...(usersDraft ?? data.users), u]);
            setDirty(true);
            setAddingUser(false);
          }} />
        </Modal>
      )}
    </div>
  );
}

function AddUser({ onDone }: { onDone: (u: { id: string; username: string; passwordHash: string; role: 'admin' | 'teacher'; displayName: string }) => void }): React.ReactElement {
  const [f, setF] = useState({ username: '', password: '', displayName: '', role: 'admin' as 'admin' | 'teacher' });
  return (
    <>
      <div className="form-row">
        <div className="field"><label>Username</label><input value={f.username} onChange={e => setF({ ...f, username: e.target.value })} /></div>
        <div className="field"><label>Display name</label><input value={f.displayName} onChange={e => setF({ ...f, displayName: e.target.value })} /></div>
      </div>
      <div className="field"><label>Password</label><input type="password" value={f.password} onChange={e => setF({ ...f, password: e.target.value })} /></div>
      <div className="field">
        <label>Role</label>
        <select value={f.role} onChange={e => setF({ ...f, role: e.target.value as 'admin' | 'teacher' })}>
          <option value="admin">Admin</option>
          <option value="teacher">Teacher</option>
        </select>
      </div>
      <div className="modal-actions">
        <button className="btn primary" disabled={!f.username || !f.password}
          onClick={() => onDone({ id: `u_${Date.now().toString(36)}`, username: f.username, passwordHash: hashPassword(f.password), role: f.role, displayName: f.displayName || f.username })}>
          Save user
        </button>
      </div>
    </>
  );
}
