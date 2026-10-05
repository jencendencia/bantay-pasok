import React, { useEffect, useRef, useState } from 'react';
import { useData } from '../store';
import { api } from '../api';
import { AvatarIcon, TitleBar, WavyFlourish } from '../ui';
import { visibleAnnouncements, pickRotating } from '../shared/announce';
import { monogramOf } from '../shared/constants';
import type { ScanResult } from '../shared/types';

function isoDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// How long the scan result stays on screen before returning to the announcement standby.
const SCAN_HOLD_MS = 10_000;

export default function ScannerApp(): React.ReactElement {
  const { data, now } = useData();
  const [activeScan, setActiveScan] = useState<ScanResult | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualQuery, setManualQuery] = useState('');
  const [loginOpen, setLoginOpen] = useState(false);
  const [loginUser, setLoginUser] = useState('');
  const [loginPass, setLoginPass] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loginBusy, setLoginBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const manualInputRef = useRef<HTMLInputElement>(null);
  const loginUserRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Focus the manual search when the manual panel opens; restore the scanner input when it closes.
  useEffect(() => {
    if (manualOpen) manualInputRef.current?.focus();
    else inputRef.current?.focus();
  }, [manualOpen]);

  // Focus the username field when the admin login panel opens.
  useEffect(() => {
    if (loginOpen) loginUserRef.current?.focus();
  }, [loginOpen]);

  // The scan result (announcement) holds for 10 seconds, then the standby rotation resumes.
  useEffect(() => {
    if (!activeScan) return;
    const t = setTimeout(() => setActiveScan(null), SCAN_HOLD_MS);
    return () => clearTimeout(t);
  }, [activeScan]);

  // Videos restart from the top whenever the standby screen is shown again.
  const [videoKey, setVideoKey] = useState(0);
  useEffect(() => { setVideoKey(k => k + 1); }, [activeScan]);

  // Video hold: while a fullscreen video plays, its slot is pinned so it is
  // never cut off mid-play; when it ends, rotation advances. Pinning happens
  // via the video element's onPlay/onEnded handlers, so no extra effects are
  // needed here. (All hooks live above the loading early-return.)
  const [videoPin, setVideoPin] = useState<string | null>(null);
  const [advTick, setAdvTick] = useState(0);

  useEffect(() => {
    const t = setInterval(() => {
      // Keep input focused unless user is interacting with tester
      if (document.activeElement?.tagName !== 'INPUT' || document.activeElement === inputRef.current) {
        inputRef.current?.focus();
      }
    }, 2500);
    return () => clearInterval(t);
  }, []);

  async function submit(code: string): Promise<void> {
    const res = await api.scan(code);
    if (res.ok && res.data) {
      setActiveScan(res.data);
    } else {
      setActiveScan(res.data || {
        ok: false,
        kind: 'unknown',
        message: res.error || 'ID not recognized. Please see the admin.',
        statusCategory: 'error'
      });
    }
  }

  // Kiosk → admin panel: verified against the accounts from Settings → Users.
  async function doLogin(): Promise<void> {
    setLoginBusy(true);
    setLoginError(null);
    const res = await api.login(loginUser, loginPass);
    setLoginBusy(false);
    if (res.ok) {
      setLoginOpen(false);
      setLoginUser('');
      setLoginPass('');
    } else {
      setLoginError(res.error ?? 'Login failed.');
    }
  }

  if (!data) {
    return (
      <div style={{ height: '100vh', position: 'relative' }}>
        <TitleBar title="Swiped Perfectly Just-in-time · Scanner" theme="dark" target="scanner" controls={false} />
        <div className="standby-screen" style={{ justifyContent: 'center', alignItems: 'center' }}>
          <h1 className="standby-greet">Loading system…</h1>
        </div>
      </div>
    );
  }

  const s = data.settings;
  const dayName = now.toLocaleDateString('en-PH', { weekday: 'long' });
  const today = isoDay(now);
  const isHoliday = data.holiday.date === today || s.holidayDates.includes(today);
  const greet = (isHoliday && s.holidayGreeting)
    ? s.holidayGreeting
    : (s.greetingPattern ?? 'Happy {day}!').replace('{day}', dayName);

  const activeAnnouncements = visibleAnnouncements(data.announcements, today);
  const rotateSeconds = s.rotateSeconds ?? 10;
  // Fullscreen announcement stage: every enabled/in-window announcement takes
  // the whole screen for one rotation slot, regardless of type. A playing
  // video keeps the stage until it ends, however long that takes.
  const baseIdx = activeAnnouncements.length
    ? activeAnnouncements.indexOf(pickRotating(activeAnnouncements, rotateSeconds, now.getTime()) ?? activeAnnouncements[0])
    : 0;
  const currentIdx = (() => {
    if (activeAnnouncements.length === 0) return 0;
    if (videoPin) {
      const pinIdx = activeAnnouncements.findIndex(a => a.id === videoPin);
      if (pinIdx >= 0) return pinIdx;
    }
    const bi = activeAnnouncements.indexOf(pickRotating(activeAnnouncements, rotateSeconds, now.getTime()) ?? activeAnnouncements[0]);
    return (Math.max(0, bi) + advTick) % activeAnnouncements.length;
  })();
  const currentFS = activeAnnouncements[currentIdx] ?? null;
  const advanceRotation = (): void => { setVideoPin(null); setAdvTick(t => t + 1); };

  return (
    <div style={{ height: '100vh', position: 'relative' }} onClick={() => inputRef.current?.focus()}>
      <TitleBar title="Swiped Perfectly Just-in-time · Scanner" theme="dark" target="scanner" controls={false} />
      {/* Hidden input to receive QR / Barcode scanner keyboard emulation */}
      <input
        ref={inputRef}
        style={{ position: 'absolute', opacity: 0, left: '-9999px', top: '-9999px' }}
        onKeyDown={e => {
          if (e.key === 'Enter') {
            const v = (e.target as HTMLInputElement).value;
            if (v.trim()) void submit(v);
            (e.target as HTMLInputElement).value = '';
          }
        }}
        autoFocus
      />

      {/* ===================================================================
          SCAN RESULT SPLIT-SCREEN (02_scan_teacher.png, 03a-03d)
          =================================================================== */}
      {activeScan ? (
        <div className="scan-screen-full">
          {/* Left Column: Role/Status Colored Header */}
          <div className={`scan-left-pane ${activeScan.statusCategory || (activeScan.kind === 'teacher' ? 'teacher' : 'on_time')}`}>
            <div className="scan-avatar-ring">
              <div className="scan-avatar-inner">
                {activeScan.photoData ? (
                  <img
                    src={activeScan.photoData}
                    alt={activeScan.name || ''}
                    style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                  />
                ) : (
                  <AvatarIcon
                    role={activeScan.kind === 'teacher' ? 'teacher' : 'student'}
                    sex={activeScan.sex ?? (activeScan.name?.includes('Ma.') || activeScan.name?.includes('Maria') || activeScan.name?.includes('Sofia') || activeScan.name?.includes('Bea') ? 'F' : 'M')}
                    size={150}
                  />
                )}
              </div>
            </div>
            <div className="scan-person-name">{activeScan.name || 'Student'}</div>
            <div className="scan-person-sub">{activeScan.subDetail || (activeScan.kind === 'teacher' ? 'Faculty Member' : 'Student')}</div>
            <div className="scan-person-id">ID {activeScan.qr || (activeScan.personId ? activeScan.personId.toUpperCase() : 'VERIFIED')}</div>
          </div>

          {/* Right Column: Dark Green Greeting and Feedback */}
          <div className="scan-right-pane">
            <div className="scan-right-top">
              <div className="scan-right-clock">
                {now.toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' })}
              </div>
              <div className="scan-right-date">
                {now.toLocaleDateString('en-PH', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
              </div>
            </div>

            <div className="scan-right-greeting">
              {activeScan.message}
            </div>

            <div className="scan-right-footer">
              {activeScan.kind === 'teacher' ? (
                <div className="now-teaching-box">
                  <div className="now-teaching-lbl">Now teaching</div>
                  <div className="now-teaching-val">{activeScan.detail || 'Scheduled Class Period'}</div>
                </div>
              ) : activeScan.detail ? (
                <div className="sms-confirmation-pill">
                  <span className="check-circle">✓</span>
                  <span>{activeScan.detail}</span>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : (
        /* ===================================================================
            FULLSCREEN ANNOUNCEMENT STANDBY (media takes the whole screen;
            scanning still works — the hidden input stays focused and any
            scan replaces this view with the greeting screen)
            =================================================================== */
        <div className="standby-screen announce-fs">
          {/* Slim top strip: school, greeting, clock */}
          <div className="announce-top">
            <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
              <div className="monogram-badge">{monogramOf(s.schoolName)}</div>
              <div>
                <div style={{ fontFamily: 'Playfair Display, Georgia, serif', fontWeight: 800, fontSize: 18 }}>
                  {s.schoolName}
                </div>
                <div style={{ color: '#a4c4b5', fontSize: 13, marginTop: 2 }}>
                  {greet}
                </div>
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div className="announce-clock">{now.toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' })}</div>
              <div className="announce-date">{now.toLocaleDateString('en-PH', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</div>
            </div>
          </div>

          {/* Fullscreen announcement stage */}
          <div className="announce-stage">
            {(!currentFS || (currentFS.type === 'photo' && !currentFS.photoData)) && (
              <h1 className="standby-greet">{greet}</h1>
            )}
            {currentFS?.type === 'text' && (
              <div className="announce-text-slide">
                <h2>{currentFS.title}</h2>
                {currentFS.body && <p>{currentFS.body}</p>}
                <div className="posted">Posted by {currentFS.postedBy}</div>
              </div>
            )}
            {currentFS?.type === 'photo' && currentFS.photoData && (
              <>
                <img key={currentFS.id} className="announce-media photo" src={currentFS.photoData} alt={currentFS.title} />
                <div className="announce-media-overlay">
                  <div className="am-title">{currentFS.title}</div>
                  {currentFS.body && <div className="am-caption">{currentFS.body}</div>}
                </div>
              </>
            )}
            {currentFS?.type === 'video' && currentFS.videoData && (
              <>
                <video
                  key={`${videoKey}|${currentFS.id}`}
                  className="announce-media video"
                  src={currentFS.videoData}
                  autoPlay
                  playsInline
                  onPlay={() => setVideoPin(currentFS.id)}
                  onEnded={advanceRotation}
                  onError={advanceRotation}
                />
                <div className="announce-media-overlay">
                  <div className="am-title">{currentFS.title}</div>
                  {currentFS.body && <div className="am-caption">{currentFS.body}</div>}
                </div>
              </>
            )}
          </div>

          {/* Bottom scan bar (always visible, so scanning is obvious) */}
          <div className="announce-bottom">
            <div className="bottom-qr-badge">⊞</div>
            <div>
              <div className="bottom-t1">Scan your QR code to check in</div>
              <div className="bottom-t2">Students and teachers: hold your ID card up to the scanner</div>
            </div>
            <button
              className="manual-checkin-btn"
              onClick={e => { e.stopPropagation(); setManualOpen(true); }}
              title="Look up a student or teacher by name when they forgot their ID"
            >
              ✎ No ID?
            </button>
            <button
              className="manual-checkin-btn"
              style={{ marginLeft: 10 }}
              onClick={e => { e.stopPropagation(); setLoginError(null); setLoginOpen(true); }}
              title="Open the admin panel (requires login)"
            >
              ⚙ Admin
            </button>
          </div>
        </div>
      )}

      {/* Manual check-in panel (student forgot their QR card) */}
      {manualOpen && data && (
        <div className="manual-overlay" onClick={e => { e.stopPropagation(); setManualOpen(false); }}>
          <div className="manual-panel" onClick={e => e.stopPropagation()}>
            <h2>Manual check-in</h2>
            <p className="manual-sub">For students and teachers without their QR ID. Type the name and pick them from the list — the same flow as a scan applies.</p>
            <input
              ref={manualInputRef}
              className="manual-search"
              value={manualQuery}
              placeholder="Type first or last name…"
              onChange={e => setManualQuery(e.target.value)}
              onKeyDown={e => { if (e.key === 'Escape') setManualOpen(false); }}
            />
            <div className="manual-results">
              {(() => {
                const q = manualQuery.trim().toLowerCase();
                if (!q) return <div className="manual-hint">Start typing to search {data.students.length} students and {data.teachers.length} teachers…</div>;
                type Row = { qr: string; name: string; meta: string; role: 'teacher' | 'student' };
                const studentRows: Row[] = data.students
                  .filter(s => `${s.firstName} ${s.lastName}`.toLowerCase().includes(q) || `${s.lastName} ${s.firstName}`.toLowerCase().includes(q))
                  .map(s => {
                    const sec = data.sections.find(x => x.id === s.sectionId);
                    const alreadyIn = data.attendance.some(a => a.studentId === s.id && a.kind === 'in' && a.date === today);
                    return {
                      qr: s.qr,
                      name: `${s.lastName}, ${s.firstName}`,
                      meta: `Student · ${sec?.name ?? 'No section'} · ${s.qr}${alreadyIn ? ' · already checked in (tap = going home)' : ''}`,
                      role: 'student' as const
                    };
                  });
                const teacherRows: Row[] = data.teachers
                  .filter(t => `${t.firstName} ${t.lastName}`.toLowerCase().includes(q) || `${t.lastName} ${t.firstName}`.toLowerCase().includes(q))
                  .map(t => {
                    const dep = data.departments.find(x => x.id === t.departmentId);
                    return {
                      qr: t.qr,
                      name: `${t.lastName}, ${t.firstName}`,
                      meta: `Teacher · ${dep?.name ?? 'Faculty'} · ${t.qr}`,
                      role: 'teacher' as const
                    };
                  });
                // Teachers first, then students; both alphabetical by last name.
                const matches = [...teacherRows, ...studentRows]
                  .sort((a, b) => (a.role === b.role ? a.name.localeCompare(b.name) : a.role === 'teacher' ? -1 : 1))
                  .slice(0, 7);
                if (matches.length === 0) return <div className="manual-hint">No student or teacher named “{manualQuery.trim()}”.</div>;
                return matches.map(r => (
                  <button
                    key={`${r.role}-${r.qr}`}
                    className="manual-result"
                    onClick={() => {
                      setManualOpen(false);
                      setManualQuery('');
                      void submit(r.qr);
                    }}
                  >
                    <span className="manual-name"><b>{r.name}</b></span>
                    <span className="manual-meta">{r.meta}</span>
                  </button>
                ));
              })()}
            </div>
            <div className="manual-foot">
              <button className="manual-cancel" onClick={e => { e.stopPropagation(); setManualOpen(false); }}>Cancel (Esc)</button>
            </div>
          </div>
        </div>
      )}

      {/* Admin login (kiosk → admin panel). Accounts come from Settings → Users. */}
      {loginOpen && (
        <div className="manual-overlay" onClick={e => { e.stopPropagation(); setLoginOpen(false); }}>
          <form
            className="manual-panel"
            style={{ maxWidth: 380 }}
            onClick={e => e.stopPropagation()}
            onSubmit={e => { e.preventDefault(); if (!loginBusy) void doLogin(); }}
          >
            <h2>Admin login</h2>
            <p className="manual-sub">Opens the admin panel. Accounts are managed in Settings → Users.</p>
            <input
              ref={loginUserRef}
              className="manual-search"
              value={loginUser}
              placeholder="Username"
              autoComplete="username"
              onChange={e => { setLoginUser(e.target.value); setLoginError(null); }}
              onKeyDown={e => { if (e.key === 'Escape') setLoginOpen(false); }}
            />
            <input
              className="manual-search"
              type="password"
              value={loginPass}
              placeholder="Password"
              autoComplete="current-password"
              style={{ marginTop: 8 }}
              onChange={e => { setLoginPass(e.target.value); setLoginError(null); }}
              onKeyDown={e => { if (e.key === 'Escape') setLoginOpen(false); }}
            />
            {loginError && <div className="manual-hint" style={{ color: 'var(--red)', marginTop: 8 }}>{loginError}</div>}
            <div className="manual-foot" style={{ justifyContent: 'space-between' }}>
              <button type="button" className="manual-cancel" onClick={e => { e.stopPropagation(); setLoginOpen(false); }}>Cancel (Esc)</button>
              <button type="submit" className="btn primary" disabled={!loginUser.trim() || !loginPass || loginBusy}>
                {loginBusy ? 'Signing in…' : 'Sign in'}
              </button>
            </div>
          </form>
        </div>
      )}

    </div>
  );
}
