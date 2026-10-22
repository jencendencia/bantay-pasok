import React, { useMemo, useState } from 'react';
import { useData } from '../store';
import { api } from '../api';
import { Modal } from '../ui';
import { ABSENCE_REASONS, fmt12, timeToMin, todayStr } from '../shared/constants';
import { LOGIN_EARLY_MIN, LOGIN_LATE_MIN } from '../shared/scan';
import type { Slot } from '../shared/types';

function minutesOfDay(dt: Date): number {
  return dt.getHours() * 60 + dt.getMinutes();
}

const BREAKS = [
  { after: '09:10', label: 'Recess · 9:10 – 9:30', start: '09:10', end: '09:30' },
  { after: '12:00', label: 'Lunch break · 12:00 – 1:00', start: '12:00', end: '13:00' }
];

export default function Dashboard(): React.ReactElement {
  const { data, now, refresh } = useData();
  const [reasonSlot, setReasonSlot] = useState<{ slot: Slot; status: { reason: string; note: string } | null } | null>(null);
  const [borrowOpen, setBorrowOpen] = useState(false);
  const [borrowPending, setBorrowPending] = useState<string[]>([]);

  // NOTE: memos must stay before any early return (rules of hooks).
  const periods = useMemo(() => {
    if (!data) return [];
    const dow = now.getDay();
    const todays = data.slots.filter(s => s.days.includes(dow));
    const seen = new Map<string, { start: string; end: string }>();
    for (const s of [...todays].sort((a, b) => timeToMin(a.start) - timeToMin(b.start))) {
      if (!seen.has(s.start)) seen.set(s.start, { start: s.start, end: s.end });
    }
    return [...seen.entries()].map(([k, v]) => ({ id: k, ...v }));
  }, [data, now]);

  const borrowedLabel = useMemo(() => {
    if (!data) return '';
    const borrowed = data.borrowed.sections;
    if (borrowed.includes('all')) return 'All sections';
    if (borrowed.length === 0) return '';
    return borrowed
      .map(id => data.sections.find(s => s.id === id)?.name.split(' • ')[0] || id)
      .join(', ');
  }, [data]);

  // Teacher logins that were saved but could not be attached to a class period.
  // The grid is built from class events, so without this list an arrival outside
  // the period window looks like the teacher never scanned at all.
  const unmatchedLogins = useMemo(() => {
    if (!data) return [];
    const ds = (d: Date): string =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const dayStr = ds(now);
    // An event whose period was deleted from the class program can no longer be
    // drawn on the grid either, so it counts as an unmatched login too.
    const periodIds = new Set(data.slots.map(s => s.id));
    const events = data.classEvents.filter(e => e.date === dayStr && periodIds.has(e.slotId));
    const recordedSlots = new Set(events.map(e => e.slotId));
    const dow = now.getDay();
    // A login is represented when it falls inside a period that already has an
    // entry. Matching by exact time would flag every repeat login in a class
    // the teacher is already checked in to.
    const represented = (teacherId: string, ts: number): boolean => {
      // A login attached to a class by hand counts as recorded, even though its
      // time is outside the period window (that is why it needed attaching).
      if (events.some(e => e.teacherId === teacherId && e.ts === ts)) return true;
      const at = minutesOfDay(new Date(ts));
      return data.slots.some(s => {
        if (s.teacherId !== teacherId || !s.days.includes(dow) || !recordedSlots.has(s.id)) return false;
        const delta = at - timeToMin(s.start);
        return delta >= -LOGIN_EARLY_MIN && delta <= LOGIN_LATE_MIN;
      });
    };
    return data.scans
      .filter(sc => sc.role === 'teacher' && sc.kind === 'in' && ds(new Date(sc.ts)) === dayStr)
      .filter(sc => !represented(sc.personId, sc.ts))
      .sort((a, b) => b.ts - a.ts)
      .map(sc => {
        const t = data.teachers.find(x => x.id === sc.personId);
        const dep = t ? data.departments.find(x => x.id === t.departmentId) : undefined;
        return {
          id: sc.id,
          ts: sc.ts,
          teacherId: sc.personId,
          name: t ? `${t.firstName} ${t.lastName}` : 'Unknown teacher',
          department: dep?.name ?? 'Faculty'
        };
      });
  }, [data, now]);

  if (!data) return <div className="empty">Loading…</div>;

  const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const dow = now.getDay();
  const isHoliday = data.holiday.date === dateStr || data.settings.holidayDates.includes(dateStr);
  const borrowed = data.borrowed.sections;
  const isBorrowed = (sid: string): boolean => borrowed.includes('all') || borrowed.includes(sid);

  const todaysSlots = data.slots.filter(s => s.days.includes(dow));

  const nowMin = minutesOfDay(now);
  const currentPeriod = periods.find(p => nowMin >= timeToMin(p.start) && nowMin < timeToMin(p.end));

  const startedSlots = todaysSlots.filter(s => nowMin >= timeToMin(s.start));
  const teachersIn = startedSlots.filter(s => data.classEvents.some(e => e.slotId === s.id && e.date === dateStr)).length;
  const studentsPresent = new Set(data.attendance.filter(e => e.date === dateStr && e.kind === 'in').map(e => e.studentId)).size;
  const smsSent = data.sms.filter(m => m.status === 'sent' && new Date(m.ts).toDateString() === now.toDateString()).length;

  // Students present per section (for the tally under "Latest scans")
  const presentIds = new Set(data.attendance.filter(e => e.date === dateStr && e.kind === 'in').map(e => e.studentId));
  const presentBySection = data.sections.map(secC => {
    const studs = data.students.filter(s => s.sectionId === secC.id);
    const present = studs.filter(s => presentIds.has(s.id)).length;
    return { id: secC.id, name: secC.name, present, total: studs.length };
  });

  const clock = (ts: number): string =>
    new Date(ts).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' });

  // Teachers physically in school: the last scan of the day for each teacher
  // says whether they are in or have logged out. Counting periods instead hides
  // everyone who has no class right now (and every arrival-only login).
  const lastKindByTeacher = new Map<string, 'in' | 'out'>();
  for (const sc of [...data.scans].sort((a, b) => a.ts - b.ts)) {
    if (sc.role !== 'teacher' || todayStr(new Date(sc.ts)) !== dateStr) continue;
    lastKindByTeacher.set(sc.personId, sc.kind);
  }
  const teachersOnCampus = [...lastKindByTeacher.values()].filter(k => k === 'in').length;

  const latestScans = [...data.scans].sort((a, b) => b.ts - a.ts).slice(0, 8).map(sc => {
    const t = data.teachers.find(x => x.id === sc.personId);
    const s = data.students.find(x => x.id === sc.personId);
    // Only the class event created by THIS scan describes this scan; using the
    // teacher's latest event showed an older class and a wrong "late N min".
    const ev = t ? data.classEvents.find(e => e.teacherId === sc.personId && e.ts === sc.ts) : undefined;
    let slotInfo = ev ? data.slots.find(x => x.id === ev.slotId) : undefined;
    // No entry was created by this scan itself (e.g. a second login in a class
    // the teacher is already recorded for): show the class it belongs to, not
    // "no class matched".
    if (!slotInfo && t) {
      const at = minutesOfDay(new Date(sc.ts));
      const dowOf = new Date(sc.ts).getDay();
      slotInfo = data.slots
        .filter(s => s.teacherId === sc.personId && s.days.includes(dowOf))
        .filter(s => data.classEvents.some(e => e.slotId === s.id && e.date === dateStr))
        .filter(s => {
          const delta = at - timeToMin(s.start);
          return delta >= -LOGIN_EARLY_MIN && delta <= LOGIN_LATE_MIN;
        })
        .sort((a, b) => Math.abs(at - timeToMin(a.start)) - Math.abs(at - timeToMin(b.start)))[0];
    }
    const sec = slotInfo ? data.sections.find(x => x.id === slotInfo.sectionId) : undefined;
    const dep = t ? data.departments.find(x => x.id === t.departmentId) : undefined;
    // A student row describes what THIS scan did. It used to be a fixed string,
    // so departures and rejected rescans claimed an on-time arrival and a text
    // that was never sent.
    const att = s ? data.attendance.find(a => a.studentId === s.id && a.ts === sc.ts) : undefined;
    const sms = s && data.settings.smsEnabled
      ? data.sms.find(m => m.studentId === s.id && Math.abs(m.ts - sc.ts) <= 120_000)
      : undefined;
    const studentWhat = !s ? ''
      : att
        ? `${att.kind === 'in' ? 'arrived' : 'departed'} ${clock(sc.ts)}${sms ? ' · SMS sent' : ''}`
        : sc.kind === 'out' ? `left ${clock(sc.ts)}` : 'not counted';
    return {
      ts: sc.ts,
      name: t ? `${t.firstName} ${t.lastName}` : s ? `${s.firstName} ${s.lastName}` : 'Unknown',
      detail: t
        ? sc.kind === 'out'
          ? `Teacher · ${dep?.name ?? 'Faculty'} · logged out ${clock(sc.ts)}`
          : slotInfo
            ? `Teacher · ${sec ? sec.name.split(' • ')[0] : ''} ${slotInfo.subject} ${ev ? lateness(slotInfo, ev.ts) : '· already recorded'}`.replace(/\s+/g, ' ').trim()
            : `Teacher · ${dep?.name ?? 'Faculty'} · logged in, no class matched`
        : s
          ? `Student · ${data.sections.find(x => x.id === s.sectionId)?.name ?? ''} · ${studentWhat}`
          : ''
    };
  });

  function lateness(slot: Slot | null | undefined, ts: number): string {
    if (!slot) return '';
    const late = minutesOfDay(new Date(ts)) - timeToMin(slot.start);
    if (late > (data?.settings.graceMinutes ?? 5)) return `· late ${late} min`;
    return '· on time';
  }

  const slotCell = (slot: Slot | undefined, period: { start: string; end: string }, secId: string) => {
    if (!slot) return <div key={secId + period.start + 'empty'} className="slot no-scan" />;
    const ev = data.classEvents.find(e => e.slotId === slot.id && e.date === dateStr);
    const st = data.slotStatuses.find(x => x.id === `${slot.id}|${dateStr}`);
    const login = unmatchedLogins.find(l => l.teacherId === slot.teacherId);
    const teacher = data.teachers.find(t => t.id === slot.teacherId);
    const isBrw = isBorrowed(slot.sectionId);
    const late = ev ? minutesOfDay(new Date(ev.ts)) - timeToMin(slot.start) : 0;
    const inClass = !!ev && late <= data.settings.graceMinutes;
    const lateIn = !!ev && late > data.settings.graceMinutes;

    const cls = isBrw ? 'borrowed' : inClass || lateIn ? 'in' : st ? 'needs-reason' : 'no-scan';
    const reasonLabel = st ? (ABSENCE_REASONS.find(r => r.id === st.reason)?.label ?? '') : '';

    return (
      <button
        key={slot.id}
        className={`slot ${cls}`}
        disabled={isHoliday}
        style={isHoliday ? { cursor: 'not-allowed' } : undefined}
        onClick={() => {
          if (!isHoliday && !isBrw) {
            setReasonSlot({ slot, status: st ? { reason: String(st.reason), note: st.note } : null });
          }
        }}
        title={
          isBrw ? 'Class is borrowed'
            : ev ? 'Teacher is in'
              : login ? `Teacher logged in at ${clock(login.ts)} but no class period matched`
                : isHoliday ? 'Locked — it is a holiday'
                  : 'Click to record a reason'
        }
      >
        <span className="s-subject">{slot.subject}</span>
        {isBrw ? (
          <span className="s-teacher">Class borrowed</span>
        ) : (
          <>
            <span className="s-teacher">{teacher ? `${teacher.firstName} ${teacher.lastName}` : '—'}</span>
            {ev && <span className="s-in">In {fmt12(slot.start).replace(' ', '').toLowerCase()}</span>}
            {!ev && login && (
              <span className="s-reason" style={{ color: 'var(--muted)', fontSize: '11px' }}>
                Login {clock(login.ts)} · not counted
              </span>
            )}
            {!ev && st && (
              <span className="s-reason" style={{ color: 'var(--red)' }}>
                {reasonLabel || 'Excused'}
              </span>
            )}
            {!ev && !st && !login && (
              <span className="s-reason" style={{ color: 'var(--red)', fontSize: '11px' }}>
                ＋ No scan yet · add reason
              </span>
            )}
          </>
        )}
      </button>
    );
  };

  const toggleBorrowPending = (id: string) => {
    if (isHoliday) return; // locked while the holiday is on
    if (id === 'all') {
      if (borrowPending.includes('all')) setBorrowPending([]);
      else setBorrowPending(['all', ...data.sections.map(s => s.id)]);
    } else {
      const withoutAll = borrowPending.filter(x => x !== 'all');
      if (withoutAll.includes(id)) {
        setBorrowPending(withoutAll.filter(x => x !== id));
      } else {
        const next = [...withoutAll, id];
        if (next.length === data.sections.length) setBorrowPending(['all', ...next]);
        else setBorrowPending(next);
      }
    }
  };

  return (
    <div>
      {/* Top Action Toolbar */}
      <div className="toolbar" style={{ marginBottom: 16 }}>
        {/* Holiday Button */}
        <button
          className={`btn ${isHoliday ? 'primary' : 'ghost'}`}
          title={isHoliday ? 'Fields are locked while the holiday is on' : 'Press to lock the dashboard for a holiday'}
          onClick={async () => {
            await api.patchData({ holiday: { date: isHoliday ? null : dateStr } });
            void refresh();
          }}
        >
          ⚐ {isHoliday ? 'Holiday active — fields locked' : 'Holiday'}
        </button>

        {/* Class Borrowed Dropdown (06c_admin_dashboard_class_borrowed.png) */}
        <div style={{ position: 'relative' }}>
          <button
            className={`btn ${borrowed.length ? 'primary' : 'ghost'}`}
            disabled={isHoliday}
            style={isHoliday ? { cursor: 'not-allowed' } : undefined}
            title={isHoliday ? 'Locked — it is a holiday' : 'Choose sections whose teachers are excused today'}
            onClick={() => {
              if (isHoliday) return;
              setBorrowPending(borrowed.includes('all') ? ['all', ...data.sections.map(s => s.id)] : [...borrowed]);
              setBorrowOpen(!borrowOpen);
            }}
          >
            ⇄ Class borrowed{borrowedLabel ? `: ${borrowedLabel}` : ''} ▾
          </button>

          {borrowOpen && (
            <div className="popover-card">
              <div className="pop-title">Class borrowed for</div>
              <div className="pop-sub">Teachers of the chosen sections are not marked absent or late while this is on.</div>

              <label className="popover-check">
                <input
                  type="checkbox"
                  checked={borrowPending.includes('all') || borrowPending.length === data.sections.length}
                  onChange={() => toggleBorrowPending('all')}
                />
                <span>All sections</span>
              </label>

              {data.sections.map(sec => {
                const checked = borrowPending.includes('all') || borrowPending.includes(sec.id);
                return (
                  <label key={sec.id} className="popover-check">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleBorrowPending(sec.id)}
                    />
                    <span>{sec.name}</span>
                  </label>
                );
              })}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
                <button className="btn ghost small" onClick={() => setBorrowOpen(false)}>Cancel</button>
                <button
                  className="btn primary small"
                  disabled={isHoliday}
                  onClick={async () => {
                    const final = borrowPending.includes('all') ? ['all'] : borrowPending;
                    await api.patchData({ borrowed: { sections: final } });
                    setBorrowOpen(false);
                    void refresh();
                  }}
                >
                  Apply{borrowPending.length ? ` to ${borrowPending.filter(x => x !== 'all').map(id => data.sections.find(s => s.id === id)?.name.split(' • ')[0]).join(', ')}` : ''}
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="spacer" />

        {/* Stat Chips */}
        <span className="stat-chip" title="Teachers whose last scan today was a login, not a logout">
          Teachers on campus <b>{teachersOnCampus}</b>
        </span>
        <span className="stat-chip">
          Teachers in class <b>{teachersIn} of {startedSlots.length || 12}</b>
        </span>
        {unmatchedLogins.length > 0 && (
          <span className="stat-chip" title="Teacher logins saved today that did not match any class period">
            Logins without a class <b>{unmatchedLogins.length}</b>
          </span>
        )}
        <span className="stat-chip">
          Students present <b>{studentsPresent} / {data.students.length}</b>
        </span>
        <span className="stat-chip">
          SMS sent today <b>{smsSent}</b>
        </span>
      </div>

      {/* Main Grid: Class Timetable & Latest Scans Sidebar (06_admin_dashboard.png) */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: 16, alignItems: 'start' }}>
        {/* Timetable Card */}
        <div className="card">
          <div className="monitor-grid">
            <div />
            {data.sections.map(sec => (
              <div key={sec.id} className={`monitor-head ${isBorrowed(sec.id) ? 'borrowed' : ''}`}>
                <div className="mh-name">{sec.name}</div>
                <div className="mh-grade">{isBorrowed(sec.id) ? 'Class borrowed' : sec.grade}</div>
              </div>
            ))}

            {periods.map(p => {
              const isNow = currentPeriod?.id === p.id;
              const pIdx = periods.indexOf(p) + 1;
              return (
                <React.Fragment key={p.id}>
                  <div className="slot-time">
                    P{pIdx}
                    {isNow && <span className="now-badge">NOW</span>}
                    <div style={{ fontWeight: 400, fontSize: 11.5, marginTop: 2 }}>
                      {fmt12(p.start)} – {fmt12(p.end)}
                    </div>
                  </div>
                  {data.sections.map(sec => {
                    const slot = todaysSlots.find(s => s.sectionId === sec.id && s.start === p.start);
                    return slotCell(slot, p, sec.id);
                  })}
                  {BREAKS.filter(b => b.after === p.end).map(b => (
                    <div key={b.label} className="break-row">
                      <span>{b.label}</span>
                    </div>
                  ))}
                </React.Fragment>
              );
            })}
          </div>

          <div className="legend" style={{ marginTop: 18, borderTop: '1px solid var(--line)', paddingTop: 12 }}>
            <span className="key"><span className="swatch" style={{ background: '#fdf5ca', borderColor: '#e8d068' }} /> Teacher is in class</span>
            <span className="key"><span className="swatch" style={{ background: '#f5f8f6' }} /> Teacher has not scanned for this class</span>
            <span className="key"><span className="swatch" style={{ background: '#fff', border: '2px dashed var(--red)' }} /> Needs a reason. Click the slot.</span>
            <span className="spacer" />
            <span>Click any empty slot to record a reason.</span>
          </div>
        </div>

        {/* Latest Scans Live Feed Sidebar */}
        <div className="card" style={{ padding: '16px 18px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h3 style={{ margin: 0, fontSize: 16 }}>Latest scans</h3>
            <span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600 }}>live</span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            {latestScans.map((sc, i) => (
              <div key={i} style={{ display: 'flex', gap: 12, padding: '10px 0', borderBottom: '1px solid #f0f4f1' }}>
                <div style={{ fontSize: 12, color: 'var(--muted)', width: 44, flex: 'none', fontVariantNumeric: 'tabular-nums' }}>
                  {new Date(sc.ts).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' })}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: 13.5, color: '#142a22' }}>{sc.name}</div>
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{sc.detail}</div>
                </div>
              </div>
            ))}
            {latestScans.length === 0 && <div className="empty">No scans recorded yet today</div>}
          </div>

          {/* Logins that never became a class event — keeps the log and the grid in agreement */}
          <div style={{ borderTop: '1px solid var(--line)', marginTop: 12, paddingTop: 12 }}>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 8 }}>
              Logins without a class
            </div>
            {unmatchedLogins.length === 0 ? (
              <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>Every teacher login matched a class.</div>
            ) : (
              unmatchedLogins.map(l => (
                <div key={l.id} style={{ display: 'flex', gap: 12, padding: '7px 0', borderBottom: '1px solid #f0f4f1' }}>
                  <div style={{ fontSize: 12, color: 'var(--muted)', width: 44, flex: 'none', fontVariantNumeric: 'tabular-nums' }}>
                    {clock(l.ts)}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: 13.5, color: '#142a22' }}>{l.name}</div>
                    <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                      {l.department} · no class period matched
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Present-per-section tally (right under the live scan feed) */}
          <div style={{ borderTop: '1px solid var(--line)', marginTop: 12, paddingTop: 12 }}>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 8 }}>
              Present per section
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {presentBySection.map(r => (
                <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: '#142a22', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {r.name}
                  </span>
                  <span style={{ width: 70, height: 8, borderRadius: 999, background: '#e7efe9', overflow: 'hidden', flex: 'none' }}>
                    <span
                      style={{
                        display: 'block', height: '100%',
                        width: `${r.total ? Math.round((r.present / r.total) * 100) : 0}%`,
                        background: r.present === r.total && r.total > 0 ? '#279655' : '#1f85b6'
                      }}
                    />
                  </span>
                  <span style={{ width: 44, textAlign: 'right', fontSize: 12.5, fontVariantNumeric: 'tabular-nums', color: 'var(--muted)', flex: 'none' }}>
                    {r.present}/{r.total}
                  </span>
                </div>
              ))}
              {presentBySection.length === 0 && <div className="empty">No sections yet</div>}
            </div>
          </div>
        </div>
      </div>

      {/* Reason for Absence Modal (06b_admin_dashboard_absence_reason.png) */}
      {reasonSlot && (
        <ReasonModal
          slot={reasonSlot.slot}
          existing={reasonSlot.status}
          date={dateStr}
          loginTs={unmatchedLogins.find(l => l.teacherId === reasonSlot.slot.teacherId)?.ts ?? null}
          onClose={() => setReasonSlot(null)}
        />
      )}
    </div>
  );
}

function ReasonModal({
  slot,
  existing,
  date,
  loginTs,
  onClose
}: {
  slot: Slot;
  existing: { reason: string; note: string } | null;
  date: string;
  /** A login of this teacher today that no class has claimed yet. */
  loginTs: number | null;
  onClose: () => void;
}): React.ReactElement {
  const { data, refresh } = useData();
  const [reason, setReason] = useState<string>(existing?.reason ?? 'in_meeting');
  const [note, setNote] = useState(existing?.note ?? '');
  const teacher = data?.teachers.find(t => t.id === slot.teacherId);
  const sec = data?.sections.find(s => s.id === slot.sectionId);
  const loginClock = loginTs
    ? new Date(loginTs).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' })
    : '';

  return (
    <Modal title="Reason for absence" sub="This slot has no teacher scan." onClose={onClose} width={580}>
      <div className="card" style={{ background: 'var(--green-50)', marginBottom: 14, border: '1px solid var(--line)' }}>
        <div style={{ fontWeight: 800, fontSize: 16, color: '#132c24' }}>
          {teacher ? `Ma'am/Sir ${teacher.firstName} ${teacher.lastName}` : 'Unassigned Teacher'}
        </div>
        <div style={{ color: 'var(--muted)', fontSize: 13.5, marginTop: 3 }}>
          {slot.subject} · {sec?.name} · {fmt12(slot.start)} – {fmt12(slot.end)}
        </div>
      </div>

      <div className="reason-grid">
        {ABSENCE_REASONS.map(r => (
          <div
            key={r.id}
            className={`reason-card ${reason === r.id ? 'selected' : ''}`}
            onClick={() => setReason(r.id)}
          >
            <span className="radio-dot" />
            <span>
              <div className="rc-title">{r.label}</div>
              <div className="rc-hint">{r.hint}</div>
            </span>
          </div>
        ))}
      </div>

      <div className="field" style={{ marginTop: 12 }}>
        <label>Note (optional)</label>
        <input
          value={note}
          onChange={e => setNote(e.target.value)}
          placeholder="Example: With the principal for the SBM review"
        />
      </div>

      {loginTs && (
        <div className="card" style={{ border: '1px solid var(--line)', marginTop: 14 }}>
          <div style={{ fontWeight: 700, fontSize: 14 }}>
            {teacher ? `${teacher.firstName} ${teacher.lastName}` : 'This teacher'} logged in at {loginClock}
          </div>
          <div className="card-note" style={{ marginTop: 4 }}>
            That is outside the {LOGIN_EARLY_MIN}-minute window, so this class has no record yet.
            Attaching the login counts them for this period with their real arrival time.
          </div>
          <button
            className="btn primary small"
            style={{ marginTop: 10 }}
            onClick={async () => {
              if (!data) return;
              const events = data.classEvents.filter(e => !(e.slotId === slot.id && e.date === date));
              events.push({
                id: `cev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
                slotId: slot.id,
                teacherId: slot.teacherId,
                date,
                ts: loginTs
              });
              await api.patchData({ classEvents: events });
              void refresh();
              onClose();
            }}
          >
            Attach the {loginClock} login to this class
          </button>
        </div>
      )}

      <div className="card-note">
        If she scans in later, this slot turns yellow by itself and the late mark is recorded.
      </div>

      <div className="modal-actions">
        {existing && (
          <button
            className="btn ghost"
            style={{ marginRight: 'auto', color: 'var(--red)' }}
            onClick={async () => {
              await api.setSlotReason(slot.id, date, null, '');
              void refresh();
              onClose();
            }}
          >
            Clear reason
          </button>
        )}
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button
          className="btn primary"
          onClick={async () => {
            await api.setSlotReason(slot.id, date, reason, note);
            void refresh();
            onClose();
          }}
        >
          Save reason
        </button>
      </div>
    </Modal>
  );
}
