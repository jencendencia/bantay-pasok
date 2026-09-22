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

export default function ScannerApp(): React.ReactElement {
  const { data, now } = useData();
  const [activeScan, setActiveScan] = useState<ScanResult | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualQuery, setManualQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const manualInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Focus the manual search when the manual panel opens; restore the scanner input when it closes.
  useEffect(() => {
    if (manualOpen) manualInputRef.current?.focus();
    else inputRef.current?.focus();
  }, [manualOpen]);

  useEffect(() => {
    if (!activeScan) return;
    const t = setTimeout(() => setActiveScan(null), 4500);
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

  if (!data) {
    return (
      <div style={{ height: '100vh', position: 'relative' }}>
        <TitleBar title="Bantay Pasok · Scanner" theme="dark" target="scanner" />
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
      <TitleBar title="Bantay Pasok · Scanner" theme="dark" target="scanner" />
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
                <AvatarIcon
                  role={activeScan.kind === 'teacher' ? 'teacher' : 'student'}
                  sex={activeScan.name?.includes('Ma.') || activeScan.name?.includes('Maria') || activeScan.name?.includes('Sofia') || activeScan.name?.includes('Bea') ? 'F' : 'M'}
                  size={150}
                />
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
              title="Look up a student by name who forgot their ID"
            >
              ✎ No ID?
            </button>
          </div>
        </div>
      )}

      {/* Manual check-in panel (student forgot their QR card) */}
      {manualOpen && data && (
        <div className="manual-overlay" onClick={e => { e.stopPropagation(); setManualOpen(false); }}>
          <div className="manual-panel" onClick={e => e.stopPropagation()}>
            <h2>Manual check-in</h2>
            <p className="manual-sub">For students without their QR ID. Type the student's name and pick them from the list — the same flow as a scan applies.</p>
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
                if (!q) return <div className="manual-hint">Start typing to search {data.students.length} students…</div>;
                const matches = data.students
                  .filter(s => `${s.firstName} ${s.lastName}`.toLowerCase().includes(q) || `${s.lastName} ${s.firstName}`.toLowerCase().includes(q))
                  .sort((a, b) => `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`))
                  .slice(0, 7);
                if (matches.length === 0) return <div className="manual-hint">No student named “{manualQuery.trim()}”.</div>;
                return matches.map(s => {
                  const sec = data.sections.find(x => x.id === s.sectionId);
                  const alreadyIn = data.attendance.some(a => a.studentId === s.id && a.kind === 'in' && a.date === today);
                  return (
                    <button
                      key={s.id}
                      className="manual-result"
                      onClick={() => {
                        setManualOpen(false);
                        setManualQuery('');
                        void submit(s.qr);
                      }}
                    >
                      <span className="manual-name"><b>{s.lastName}, {s.firstName}</b></span>
                      <span className="manual-meta">{sec?.name ?? 'No section'} · {s.qr}{alreadyIn ? ' · already checked in (tap = going home)' : ''}</span>
                    </button>
                  );
                });
              })()}
            </div>
            <div className="manual-foot">
              <button className="manual-cancel" onClick={e => { e.stopPropagation(); setManualOpen(false); }}>Cancel (Esc)</button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
