import React, { useMemo, useRef, useState } from 'react';
import { useData } from '../store';
import { api } from '../api';
import { Modal, Pill, Segmented } from '../ui';
import { fmt12, timeToMin, minToTime, gradePeriodsFor, windowsForSection } from '../shared/constants';
import { StudentFace } from '../components/StudentFace';
import type { Section, SlotTimeWindows, Student } from '../shared/types';

type SortKey = 'alpha' | 'arrival';
type View = 'stats' | 'section';

/** One CSV row split into cells, handling quotes and "" escapes. */
export function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQ = false;
      } else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out.map(s => s.trim());
}

/** Parses CSV text into records keyed by (normalized) header names. */
export function parseCsvTable(text: string): Record<string, string>[] {
  const lines = text.replace(/^\uFEFF/, '').split(/\r\n|\r|\n/).filter(l => l.trim().length > 0);
  if (lines.length === 0) return [];
  const headers = parseCsvLine(lines[0]).map(h => h.toLowerCase().replace(/[^a-z]/g, ''));
  return lines.slice(1).map(line => {
    const cells = parseCsvLine(line);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { if (h) row[h] = cells[i] ?? ''; });
    return row;
  });
}

function minutesOfDay(ts: number): number {
  const dt = new Date(ts);
  return dt.getHours() * 60 + dt.getMinutes();
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function Sections(): React.ReactElement {
  const { data, now, refresh } = useData();
  const [sectionId, setSectionId] = useState<string | null>(null);
  const [sort, setSort] = useState<SortKey>('arrival');
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [view, setView] = useState<View>('stats');
  const [manageOpen, setManageOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  // NOTE: must stay before any early return (rules of hooks).
  // Attendance by time: arrivals per 15-min bucket (6:30, 6:45, 7:00, 7:15, 7:30, 7:45)
  const buckets = useMemo(() => {
    const out: { label: string; count: number; tone: string }[] = [];
    if (!data) return out;
    const ds = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const times = [
      { min: timeToMin('06:30'), label: '6:30', tone: 'blue' },
      { min: timeToMin('06:45'), label: '6:45', tone: 'blue' },
      { min: timeToMin('07:00'), label: '7:00', tone: '' },
      { min: timeToMin('07:15'), label: '7:15', tone: '' },
      { min: timeToMin('07:30'), label: '7:30', tone: 'orange' },
      { min: timeToMin('07:45'), label: '7:45', tone: 'orange' }
    ];
    for (const t of times) {
      const count = data.attendance.filter(e => {
        if (e.date !== ds || e.kind !== 'in') return false;
        const mm = minutesOfDay(e.ts);
        return mm >= t.min && mm < t.min + 15;
      }).length;
      out.push({ label: t.label, count, tone: t.tone });
    }
    return out;
  }, [data, now]);

  // Student count per section — built once so the picker stays fast with hundreds of sections.
  const countsById = useMemo(() => {
    const m = new Map<string, number>();
    if (data) for (const s of data.students) if (s.sectionId) m.set(s.sectionId, (m.get(s.sectionId) ?? 0) + 1);
    return m;
  }, [data?.students]);

  if (!data) return <div className="empty">Loading…</div>;
  const sec = data.sections.find(x => x.id === sectionId) ?? data.sections[1] ?? data.sections[0];
  const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  const bySection = data.sections.map(x => {
    const studs = data.students.filter(s => s.sectionId === x.id);
    let present = 0, early = 0, onTime = 0, late = 0, absent = 0;
    const w = windowsForSection(x, data.settings);
    const earlyC = timeToMin(w.amIn), lateC = timeToMin(w.pmIn);
    for (const st of studs) {
      const inEv = data.attendance.find(e => e.studentId === st.id && e.date === dateStr && e.kind === 'in');
      if (!inEv) { absent++; continue; }
      present++;
      const m = minutesOfDay(inEv.ts);
      if (m < earlyC) { early++; } else if (m <= lateC) { onTime++; } else { late++; }
    }
    return {
      section: x, enrolled: studs.length, present, early, onTime, late, absent,
      rate: studs.length ? Math.round((present / studs.length) * 100) : 0
    };
  });

  const total = bySection.reduce((a, r) => ({
    enrolled: a.enrolled + r.enrolled, present: a.present + r.present,
    early: a.early + r.early, onTime: a.onTime + r.onTime, late: a.late + r.late, absent: a.absent + r.absent
  }), { enrolled: 0, present: 0, early: 0, onTime: 0, late: 0, absent: 0 });

  const maxBucket = Math.max(1, ...buckets.map(b => b.count));

  // Per-section schedule (from the class program) for the section detail view.
  const dow = now.getDay();
  const todaySlots = data.slots
    .filter(s => s.sectionId === sec.id && s.days.includes(dow))
    .sort((a, b) => a.start.localeCompare(b.start));
  const weekSlots = data.slots
    .filter(s => s.sectionId === sec.id)
    .sort((a, b) => a.start.localeCompare(b.start) || a.days[0] - b.days[0]);
  const teacherName = (id: string): string => {
    const t = data.teachers.find(x => x.id === id);
    return t ? `${t.firstName} ${t.lastName}` : 'Unassigned';
  };

  const switchSection = (id: string): void => {
    setSectionId(id);
    setChecked(new Set());   // enrolment tick-boxes belong to the previous section
    setView('section');
  };

  const roster = data.students.filter(s => s.sectionId === sec.id);
  const sorted = [...roster].sort((a, b) => {
    if (sort === 'alpha') return `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`);
    const ta = data.attendance.find(e => e.studentId === a.id && e.date === dateStr && e.kind === 'in')?.ts ?? Infinity;
    const tb = data.attendance.find(e => e.studentId === b.id && e.date === dateStr && e.kind === 'in')?.ts ?? Infinity;
    return ta - tb;
  });
  const males = sorted.filter(s => s.sex === 'M');
  const females = sorted.filter(s => s.sex === 'F');

  // Batch enrol: only students NOT in the selected section are shown.
  const unenrolled = data.students.filter(s => s.sectionId !== sec.id);

  const toggleChecked = (id: string): void => {
    const n = new Set(checked);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    setChecked(n);
  };

  const enrolChecked = async (): Promise<void> => {
    if (checked.size === 0) return;
    const next = data.students.map(s => (checked.has(s.id) ? { ...s, sectionId: sec.id } : s));
    await api.patchData({ students: next });
    setChecked(new Set());
    void refresh();
  };

  const statusPill = (st: Student): React.ReactElement => {
    const inEv = data.attendance.find(e => e.studentId === st.id && e.date === dateStr && e.kind === 'in');
    if (!inEv) return <Pill color="red">Absent</Pill>;
    const m = minutesOfDay(inEv.ts);
    const w = windowsForSection(data.sections.find(x => x.id === st.sectionId), data.settings);
    const earlyC = timeToMin(w.amIn), lateC = timeToMin(w.pmIn);
    if (m < earlyC) return <Pill color="blue">Early</Pill>;
    if (m <= lateC) return <Pill color="green">On time</Pill>;
    return <Pill color="orange">Late</Pill>;
  };

  const rosterTable = (list: Student[]): React.ReactElement => (
    <table className="table">
      <thead>
        <tr><th></th><th>Name</th><th>Arrived</th><th>Status</th><th>Left</th><th>Parent SMS</th></tr>
      </thead>
      <tbody>
        {list.map(st => {
          const inEv = data.attendance.find(e => e.studentId === st.id && e.date === dateStr && e.kind === 'in');
          const outEv = data.attendance.find(e => e.studentId === st.id && e.date === dateStr && e.kind === 'out');
          const sms = data.sms.filter(m => m.studentId === st.id && new Date(m.ts).toDateString() === now.toDateString());
          const sent = sms.some(m => m.status === 'sent');
          return (
            <tr key={st.id}>
              <td style={{ width: 46 }}><StudentFace student={st} size={34} /></td>
              <td><b>{st.lastName}, {st.firstName}</b></td>
              <td>{inEv ? new Date(inEv.ts).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' }) : '—'}</td>
              <td>{statusPill(st)}</td>
              <td>{outEv ? new Date(outEv.ts).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' }) : '—'}</td>
              <td>
                {sent ? (
                  <span style={{ color: '#1c7a4e', fontWeight: 600, fontSize: 13 }}>✓ sent</span>
                ) : sms.length ? (
                  <Pill color="orange">retrying</Pill>
                ) : (
                  '—'
                )}
              </td>
            </tr>
          );
        })}
        {list.length === 0 && <tr><td colSpan={6} className="empty">No students in this section</td></tr>}
      </tbody>
    </table>
  );

  const exportRosterCsv = () => {
    const rows = [
      ['Section', sec.name],
      ['Date', dateStr],
      [],
      ['Sex', 'Last Name', 'First Name', 'Arrival Time', 'Status', 'Departure Time', 'Parent Phone'],
      ...sorted.map(st => {
        const inEv = data.attendance.find(e => e.studentId === st.id && e.date === dateStr && e.kind === 'in');
        const outEv = data.attendance.find(e => e.studentId === st.id && e.date === dateStr && e.kind === 'out');
        const m = inEv ? minutesOfDay(inEv.ts) : 0;
        const w = windowsForSection(data.sections.find(x => x.id === st.sectionId), data.settings);
        const status = !inEv ? 'Absent' : m < timeToMin(w.amIn) ? 'Early' : m <= timeToMin(w.pmIn) ? 'On time' : 'Late';
        return [
          st.sex === 'M' ? 'Male' : 'Female',
          st.lastName,
          st.firstName,
          inEv ? new Date(inEv.ts).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' }) : '',
          status,
          outEv ? new Date(outEv.ts).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' }) : '',
          st.number
        ];
      })
    ];
    const csvContent = 'data:text/csv;charset=utf-8,' + rows.map(e => e.join(',')).join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `Roster_${sec.name.replace(/\s+/g, '_')}_${dateStr}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">Sections</h1>
          <div className="page-sub">Enrol students, then follow attendance by section and by arrival time</div>
        </div>
      </div>

      {/* Section switcher: searchable dropdown so long section lists stay usable */}
      <div className="card" style={{ padding: '12px 16px', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span className="toolbar-label" style={{ marginRight: 2 }}>Section</span>
          <SectionPicker
            sections={data.sections}
            selectedId={sec.id}
            countsById={countsById}
            onSelect={switchSection}
          />
          <div className="spacer" />
          <button
            className={`btn small ${view === 'stats' ? 'primary' : 'ghost'}`}
            onClick={() => setView('stats')}
          >
            ▤ All sections
          </button>
          <button className="btn ghost small" title="Add, rename or edit sections" onClick={() => setManageOpen(true)}>
            ⚙
          </button>
          <button
            className="btn ghost small"
            title="Import a student masterlist (CSV) and enrol rows into the selected section"
            onClick={() => setImportOpen(true)}
          >
            ⬆ Import masterlist
          </button>
        </div>
      </div>

      {view === 'section' && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
            <div>
              <h3 style={{ margin: 0 }}>{sec.name}</h3>
              <span style={{ color: 'var(--muted)', fontSize: 13 }}>
                {sec.grade} · {roster.length} students · {males.length} male / {females.length} female
              </span>
            </div>
            <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
              <div><div style={{ fontSize: 22, fontWeight: 800 }}>{bySection.find(r => r.section.id === sec.id)?.present ?? 0}</div><div style={{ fontSize: 12, color: 'var(--muted)' }}>present today</div></div>
              <div><div style={{ fontSize: 22, fontWeight: 800, color: 'var(--orange)' }}>{bySection.find(r => r.section.id === sec.id)?.late ?? 0}</div><div style={{ fontSize: 12, color: 'var(--muted)' }}>late</div></div>
              <div><div style={{ fontSize: 22, fontWeight: 800, color: 'var(--red)' }}>{bySection.find(r => r.section.id === sec.id)?.absent ?? 0}</div><div style={{ fontSize: 12, color: 'var(--muted)' }}>absent</div></div>
              <div><div style={{ fontSize: 22, fontWeight: 800 }}>{bySection.find(r => r.section.id === sec.id)?.rate ?? 0}%</div><div style={{ fontSize: 12, color: 'var(--muted)' }}>attendance rate</div></div>
            </div>
          </div>
          <div style={{ borderTop: '1px solid var(--line)', marginTop: 14, paddingTop: 12 }}>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 8 }}>
              Today's schedule ({DAY_NAMES[dow]})
            </div>
            {todaySlots.length === 0 && <span className="card-note">No classes scheduled for this section today.</span>}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {todaySlots.map(sl => {
                const teacher = data.teachers.find(t => t.id === sl.teacherId);
                const scanned = teacher && data.scans.some(sc => sc.personId === teacher.id && new Date(sc.ts).toDateString() === now.toDateString());
                const st = data.slotStatuses.find(x => x.id === `${sl.id}|${dateStr}`);
                return (
                  <div
                    key={sl.id}
                    style={{
                      border: '1px solid var(--line)', borderRadius: 10, padding: '8px 12px', minWidth: 170,
                      background: st?.reason ? 'var(--red-soft)' : scanned ? 'var(--yellow-soft)' : 'var(--card)'
                    }}
                  >
                    <div style={{ fontWeight: 700, fontSize: 13 }}>{fmt12(sl.start)} – {fmt12(sl.end)}</div>
                    <div style={{ fontSize: 13.5 }}>{sl.subject}</div>
                    <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>
                      {teacherName(sl.teacherId)}
                      {st?.reason ? ' · ' + st.reason.replace('_', ' ') : scanned ? ' · ✓ in' : ''}
                    </div>
                  </div>
                );
              })}
            </div>
            {weekSlots.length > 0 && (
              <div className="card-note" style={{ marginTop: 8 }}>
                {weekSlots.length} periods in the weekly class program · {new Set(weekSlots.map(s => s.teacherId)).size} different teachers
              </div>
            )}
          </div>
        </div>
      )}

      {/* Per-section time rules: AM/PM in/out; blank = follow the global rules from Settings.
          Keyed by section so the editor's draft never leaks from one section to the next. */}
      <TimeRulesCard key={sec.id} section={sec} />

      {/* Top Grid: Enrol Card & Attendance Statistics (09_admin_sections_tab.png) */}
      <div className="grid-1-2" style={view === 'section' ? { display: 'block' } : undefined}>
        {/* Left column */}
        <div className="stack">
          {/* Batch enrol card: only shows students not yet in the selected section */}
          <div className="card">
            <h3>Enrol students</h3>
            <div className="card-note" style={{ marginTop: -4 }}>
              Tick students to enrol them into <b>{sec.name}</b> — only students not yet in this section are listed. New students are added on the Students tab.
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '8px 0 4px' }}>
              <span style={{ fontSize: 13, color: 'var(--muted)' }}>
                {unenrolled.length} not enrolled here
              </span>
              <button
                className="btn ghost small"
                onClick={() => setChecked(checked.size === unenrolled.length ? new Set() : new Set(unenrolled.map(s => s.id)))}
                disabled={unenrolled.length === 0}
              >
                {checked.size === unenrolled.length && unenrolled.length > 0 ? 'Deselect all' : 'Select all'}
              </button>
            </div>
            <div style={{ maxHeight: 260, overflowY: 'auto', border: '1px solid var(--line)', borderRadius: 10, padding: '4px 10px' }}>
              {unenrolled.map(st => (
                <label key={st.id} className="check-row" style={{ cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={checked.has(st.id)}
                    onChange={() => toggleChecked(st.id)}
                  />
                  <StudentFace student={st} size={32} />
                  <span style={{ flex: 1, fontWeight: 600 }}>
                    {st.lastName}, {st.firstName}{' '}
                    <Pill color={st.sex === 'M' ? 'blue' : 'purple'}>{st.sex === 'M' ? 'Male' : 'Female'}</Pill>
                  </span>
                  <span style={{ color: 'var(--muted)', fontSize: 12.5 }}>
                    {st.sectionId ? data.sections.find(s => s.id === st.sectionId)?.name : 'Unassigned'}
                  </span>
                </label>
              ))}
              {unenrolled.length === 0 && (
                <div className="empty">All students are already enrolled in this section!</div>
              )}
            </div>
            <button
              className="btn yellow"
              style={{ width: '100%', marginTop: 12 }}
              disabled={checked.size === 0}
              onClick={() => void enrolChecked()}
            >
              Enrol {checked.size ? `${checked.size} student${checked.size > 1 ? 's' : ''}` : ''} to {sec.name}
            </button>
          </div>

          {/* Arrival cutoffs card */}
          <div className="card">
            <h3>Arrival cutoffs</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ width: 60, fontWeight: 700, fontSize: 13 }}>Early</span>
                <div style={{ flex: 1, height: 10, background: '#1f85b6', borderRadius: 999 }} />
                <span style={{ color: 'var(--muted)', fontSize: 12.5 }}>before {fmt12(data.settings.earlyCutoff)}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ width: 60, fontWeight: 700, fontSize: 13 }}>On time</span>
                <div style={{ flex: 1, height: 10, background: '#279655', borderRadius: 999 }} />
                <span style={{ color: 'var(--muted)', fontSize: 12.5 }}>{fmt12(data.settings.earlyCutoff)} – {fmt12(data.settings.lateAfter)}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ width: 60, fontWeight: 700, fontSize: 13 }}>Late</span>
                <div style={{ flex: 1, height: 10, background: '#d96b27', borderRadius: 999 }} />
                <span style={{ color: 'var(--muted)', fontSize: 12.5 }}>after {fmt12(data.settings.lateAfter)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Right column: Tables & Charts */}
        <div className="stack">
          {/* Attendance by section table */}
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <h3 style={{ margin: 0 }}>Attendance by section</h3>
              <span style={{ color: 'var(--muted)', fontSize: 12.5 }}>
                Today, as of {now.toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' })}
              </span>
            </div>

            <table className="table">
              <thead>
                <tr>
                  <th>Section</th>
                  <th className="num">Enrolled</th>
                  <th className="num">Present</th>
                  <th className="num">Early</th>
                  <th className="num">On time</th>
                  <th className="num">Late</th>
                  <th className="num">Absent</th>
                  <th className="num">Rate</th>
                </tr>
              </thead>
              <tbody>
                {bySection.map(r => (
                  <tr
                    key={r.section.id}
                    className="clickable"
                    style={r.section.id === sec.id && view === 'section' ? { background: 'var(--green-50)' } : undefined}
                    onClick={() => switchSection(r.section.id)}
                  >
                    <td><b>{r.section.name}</b></td>
                    <td className="num">{r.enrolled}</td>
                    <td className="num">{r.present}</td>
                    <td className="num">{r.early}</td>
                    <td className="num">{r.onTime}</td>
                    <td className="num">{r.late}</td>
                    <td className="num">{r.absent}</td>
                    <td className="num">{r.rate}%</td>
                  </tr>
                ))}
                <tr style={{ background: '#fef7d8', fontWeight: 800 }}>
                  <td>All sections</td>
                  <td className="num">{total.enrolled}</td>
                  <td className="num">{total.present}</td>
                  <td className="num">{total.early}</td>
                  <td className="num">{total.onTime}</td>
                  <td className="num">{total.late}</td>
                  <td className="num">{total.absent}</td>
                  <td className="num">{total.enrolled ? Math.round((total.present / total.enrolled) * 100) : 0}%</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Attendance by time chart */}
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0 }}>Attendance by time</h3>
              <span style={{ color: 'var(--muted)', fontSize: 12.5 }}>Arrivals per 15 minutes, all sections</span>
            </div>
            <div className="chart-bars">
              {buckets.map(b => (
                <div key={b.label} className="chart-bar">
                  <div className="cb-count">{b.count}</div>
                  <div
                    className={`cb-rect ${b.tone}`}
                    style={{
                      height: `${(b.count / maxBucket) * 100}%`,
                      minHeight: b.count ? 8 : 2
                    }}
                  />
                  <div className="cb-label">{b.label}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Section Roster Card with Sort and Excel Export (09_admin_sections_tab.png) */}
      <div className="card" style={{ marginTop: 18 }}>
        <div className="toolbar" style={{ marginBottom: 12 }}>
          <h3 style={{ margin: 0 }}>{sec.name} roster</h3>
          <div className="spacer" />
          <span className="toolbar-label">Sort by</span>
          <Segmented
            options={[
              { id: 'alpha' as SortKey, label: 'Alphabetical' },
              { id: 'arrival' as SortKey, label: 'Time of arrival' }
            ]}
            value={sort}
            onChange={setSort}
          />
          <button className="btn ghost small" onClick={exportRosterCsv}>
            ⬇ Excel
          </button>
        </div>

        <div className="roster-cols">
          <div>
            <h4>Male · {males.length}</h4>
            {rosterTable(males)}
          </div>
          <div>
            <h4>Female · {females.length}</h4>
            {rosterTable(females)}
          </div>
        </div>
      </div>

      {manageOpen && (
        <ManageSectionsModal
          sections={data.sections}
          onClose={() => setManageOpen(false)}
        />
      )}

      {importOpen && (
        <ImportMasterlistModal
          section={sec}
          onClose={() => setImportOpen(false)}
        />
      )}

    </div>
  );
}

/** Add, rename or edit sections — including the grade level used for time slots. */
function ManageSectionsModal({ sections, onClose }: { sections: Section[]; onClose: () => void }): React.ReactElement {
  const { data, refresh } = useData();
  const [newName, setNewName] = useState('');
  const [newGrade, setNewGrade] = useState('');
  const [edits, setEdits] = useState<Record<string, { name: string; grade: string }>>(
    Object.fromEntries(sections.map(s => [s.id, { name: s.name, grade: s.grade }]))
  );
  if (!data) return <div />;

  const applyEdit = async (id: string): Promise<void> => {
    const e = edits[id];
    if (!e || !e.name.trim()) return;
    const next = data.sections.map(s => (s.id === id ? { ...s, name: e.name.trim(), grade: e.grade.trim() || s.grade } : s));
    await api.patchData({ sections: next });
    void refresh();
  };

  const addSection = async (): Promise<void> => {
    if (!newName.trim()) return;
    const palette = ['#226756', '#1f85b6', '#d96b27', '#5c4e9e', '#4e5ba6', '#b6893b'];
    await api.patchData({
      sections: [...data.sections, {
        id: `sec_${Date.now().toString(36)}`,
        name: newName.trim(),
        grade: newGrade.trim() || newName.trim().split(/\s+/)[0],
        color: palette[data.sections.length % palette.length]
      }]
    });
    setNewName('');
    setNewGrade('');
    void refresh();
  };

  return (
    <Modal title="Manage sections" sub="Rename sections, edit their grade level, or add a new section." onClose={onClose} width={560}>
      <table className="table">
        <thead><tr><th>Section name</th><th>Grade level</th><th></th></tr></thead>
        <tbody>
          {data.sections.map(s => {
            const e = edits[s.id] ?? { name: s.name, grade: s.grade };
            const dirty = e.name !== s.name || e.grade !== s.grade;
            return (
              <tr key={s.id}>
                <td>
                  <input
                    value={e.name}
                    placeholder="G7 • Ilang-Ilang"
                    onChange={ev => setEdits({ ...edits, [s.id]: { ...e, name: ev.target.value } })}
                    style={{ width: '100%' }}
                  />
                </td>
                <td>
                  <input
                    value={e.grade}
                    placeholder="Grade 7"
                    onChange={ev => setEdits({ ...edits, [s.id]: { ...e, grade: ev.target.value } })}
                    style={{ width: 110 }}
                  />
                </td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <button
                    className="btn primary small"
                    disabled={!dirty || !e.name.trim()}
                    onClick={() => void applyEdit(s.id)}
                  >
                    Save
                  </button>{' '}
                  <button
                    className="btn ghost small"
                    title="Set the standard time slots for this grade in the class program"
                    onClick={() => void (async () => {
                      const grade = e.grade.trim() || s.grade;
                      const periods = gradePeriodsFor(grade);
                      const mine = data.slots.filter(x => x.sectionId === s.id);
                      const matched = new Set<string>();
                      const updated = data.slots.map(x => {
                        if (x.sectionId !== s.id) return x;
                        const p = periods.find(pp => pp.start === x.start);
                        if (p) { matched.add(x.id); return { ...x, end: p.end }; }
                        return x;
                      });
                      const missing = periods.filter(p => !mine.some(m => m.start === p.start));
                      const subjects = mine.map(m => m.subject);
                      const added = missing.map((p, i) => ({
                        id: `slot_${Date.now().toString(36)}_${i}`,
                        sectionId: s.id,
                        subject: subjects[i % Math.max(1, subjects.length)] || 'Subject',
                        departmentId: mine[i % Math.max(1, mine.length)]?.departmentId || data.departments[0]?.id || '',
                        teacherId: mine[i % Math.max(1, mine.length)]?.teacherId || data.teachers[0]?.id || '',
                        start: p.start,
                        end: p.end,
                        days: [1, 2, 3, 4, 5]
                      }));
                      await api.patchData({ slots: [...updated, ...added] });
                      void refresh();
                    })()}
                  >
                    🕐 Time slots
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div style={{ borderTop: '1px solid var(--line)', marginTop: 14, paddingTop: 12 }}>
        <div className="form-row">
          <div className="field">
            <label>New section name (e.g. "G7 • Ilang-Ilang")</label>
            <input value={newName} placeholder="G7 • Ilang-Ilang" onChange={e => setNewName(e.target.value)} />
          </div>
          <div className="field">
            <label>Grade level</label>
            <input value={newGrade} placeholder="Grade 7" onChange={e => setNewGrade(e.target.value)} />
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button className="btn primary" disabled={!newName.trim()} onClick={() => void addSection()}>Add section</button>
        </div>
        <div className="card-note">
          Time slots differ per grade level — use 🕐 to apply the standard periods for the grade to this section's class program.
        </div>
      </div>
    </Modal>
  );
}

/** Import a student masterlist CSV into the selected section (optionally into Guardians too). */
function ImportMasterlistModal({ section, onClose }: { section: Section; onClose: () => void }): React.ReactElement {
  const { data, refresh } = useData();
  const [preview, setPreview] = useState<{ sex: 'M' | 'F'; last: string; first: string; guardian?: string; number?: string; email?: string }[]>([]);
  const [alsoGuardians, setAlsoGuardians] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!data) return <div />;

  const readFile = (file: File | undefined): void => {
    if (!file) return;
    setErr(null);
    const reader = new FileReader();
    reader.onload = () => {
      const rows = parseCsvTable(String(reader.result));
      const get = (r: Record<string, string>, keys: string[]): string => {
        for (const k of keys) if (r[k]) return r[k];
        return '';
      };
      const parsed = rows.map(r => {
        const last = get(r, ['lastname', 'surname', 'last']);
        const first = get(r, ['firstname', 'givenname', 'first', 'middlename']) || get(r, ['name']);
        const rawSex = (get(r, ['sex', 'gender']) || 'M').toUpperCase();
        return {
          sex: (rawSex.startsWith('F') ? 'F' : 'M') as 'M' | 'F',
          last: last || first,
          first: last ? first : first.split(/\s+/).slice(-1)[0] || first,
          guardian: get(r, ['guardian', 'parent', 'parentguardian', 'nameofparentguardian']) || undefined,
          number: get(r, ['number', 'mobile', 'contactnumber', 'mobilenumber', 'phone']) || undefined,
          email: get(r, ['email', 'emailaddress']) || undefined
        };
      }).filter(r => r.last || r.first);
      if (parsed.length === 0) setErr('No rows found. Expected columns like Last Name, First Name, Sex.');
      setPreview(parsed);
    };
    reader.readAsText(file);
  };

  const doImport = async (): Promise<void> => {
    const students = [...data.students];
    const guardians = [...data.guardians];
    for (const r of preview) {
      let guardianId: string | null = null;
      if (alsoGuardians) {
        const parts = (r.guardian || '').trim().split(/\s+/);
        const gFirst = parts[0] || ''; const gLast = parts.slice(1).join(' ') || r.last;
        let g = guardians.find(x => x.firstName.toLowerCase() === gFirst.toLowerCase() && x.lastName.toLowerCase() === gLast.toLowerCase());
        if (!g) {
          g = {
            id: `g_${Date.now().toString(36)}_${guardians.length}`,
            lastName: gLast,
            firstName: gFirst || 'Guardian',
            number: r.number || '',
            address: '',
            ...(r.email ? { email: r.email } : {})
          };
          guardians.push(g);
        }
        guardianId = g.id;
      }
      let n = students.length + 420;
      let qr: string;
      do { qr = `S-2026-${String(n++).padStart(5, '0')}`; }
      while (students.some(s => s.qr === qr) && n < 100000);
      students.push({
        id: `s_${Date.now().toString(36)}_${students.length}`,
        qr,
        lastName: r.last,
        firstName: r.first,
        middleName: '',
        sex: r.sex,
        number: r.number || '',
        sectionId: section.id,
        guardianId
      });
    }
    await api.patchData(alsoGuardians ? { students, guardians } : { students });
    void refresh();
    onClose();
  };

  return (
    <Modal title={`Import masterlist into ${section.name}`} sub="Pick a CSV file exported from Excel — columns are matched by name." onClose={onClose} width={560}>
      <div className="field">
        <label>CSV file</label>
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={e => { readFile(e.target.files?.[0]); e.target.value = ''; }}
        />
        <div className="card-note" style={{ marginTop: 4 }}>
          Accepted columns: Last Name, First Name, Sex, Guardian, Mobile Number, Email Address. In Excel choose File → Save As → CSV.
        </div>
      </div>

      <label className="check-row" style={{ cursor: 'pointer', marginTop: 6 }}>
        <input type="checkbox" checked={alsoGuardians} onChange={e => setAlsoGuardians(e.target.checked)} />
        <span style={{ fontWeight: 600 }}>Also create Guardians from the Guardian / Mobile columns</span>
      </label>

      {err && <div className="notice error" style={{ marginTop: 10 }}>⚠ {err}</div>}

      {preview.length > 0 && (
        <>
          <div style={{ marginTop: 12, fontWeight: 700 }}>{preview.length} rows found — first 5:</div>
          <table className="table">
            <thead><tr><th>Sex</th><th>Last name</th><th>First name</th><th>Guardian</th><th>Mobile</th></tr></thead>
            <tbody>
              {preview.slice(0, 5).map((r, i) => (
                <tr key={i}>
                  <td>{r.sex === 'M' ? 'Male' : 'Female'}</td>
                  <td>{r.last}</td>
                  <td>{r.first}</td>
                  <td>{r.guardian || '—'}</td>
                  <td>{r.number || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <div className="modal-actions">
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn primary" disabled={preview.length === 0} onClick={() => void doImport()}>
          Import {preview.length || ''} student{preview.length === 1 ? '' : 's'}
        </button>
      </div>
    </Modal>
  );
}

/**
 * Per-section time rules: AM time in / AM time out / PM time in / PM time out.
 * A section that sets its own times uses them for scan classification (early /
 * on time / late and the dismissal windows); blank fields follow the global
 * time rules on the Settings page.
 */
function TimeRulesCard({ section }: { section: Section }): React.ReactElement {
  const { data, refresh } = useData();
  const [draft, setDraft] = useState<Partial<SlotTimeWindows>>(section.slotTimes ?? {});
  const [savedFlash, setSavedFlash] = useState(false);
  if (!data) return <div />;

  const w = windowsForSection(section, data.settings);
  const rows: Array<{ key: keyof SlotTimeWindows; label: string; hint: string }> = [
    { key: 'amIn', label: 'AM time in', hint: 'Scans before this are “early”; after the PM time in they are “late”' },
    { key: 'amOut', label: 'AM time out', hint: 'Morning departure window opens at this time' },
    { key: 'pmIn', label: 'PM time in', hint: 'Scans after this count as late for this section' },
    { key: 'pmOut', label: 'PM time out', hint: 'Afternoon departure window opens at this time' }
  ];

  const save = async (next: Partial<SlotTimeWindows>): Promise<void> => {
    const clean = Object.fromEntries(Object.entries(next).filter(([, v]) => !!v)) as Partial<SlotTimeWindows>;
    const isEmpty = Object.keys(clean).length === 0;
    const sections = data.sections.map(x => {
      if (x.id !== section.id) return x;
      const { slotTimes, ...rest } = x;
      return isEmpty ? rest : { ...rest, slotTimes: clean };
    });
    await api.patchData({ sections });
    setDraft(clean);
    void refresh();
    setSavedFlash(true);
    window.setTimeout(() => setSavedFlash(false), 2600);
  };

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 6 }}>
        <h3 style={{ margin: 0 }}>Time rules — {section.name}</h3>
        <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>
          Leave a time empty to follow the global rules from Settings.
        </span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12, marginTop: 12 }}>
        {rows.map(r => (
          <div className="field" key={r.key} style={{ margin: 0 }}>
            <label>{r.label}</label>
            <input
              type="time"
              value={draft[r.key] ?? ''}
              placeholder={fmt12(w[r.key])}
              onChange={e => {
                const next = { ...draft, [r.key]: e.target.value || undefined };
                setDraft(next);
                void save(next);
              }}
            />
            <div className="card-note">
              {draft[r.key] ? `This section: ${fmt12(draft[r.key]!)}` : `Global: ${fmt12(w[r.key])}`}
              {' · '}{r.hint}
            </div>
          </div>
        ))}
      </div>
      <div className="card-note" style={{ marginTop: 10 }}>
        Changes save immediately for <b>{section.name}</b> only — other sections keep the global rules.
        {' '}{savedFlash && <span style={{ color: 'var(--green-700)', fontWeight: 700 }}>✓ Saved</span>}
        {' '}Dismissal scans count between the time-out windows; {minToTime(timeToMin(w.amOut) + 90)}–{minToTime(timeToMin(w.pmIn))} scans keep the student checked in.
      </div>
    </div>
  );
}

const PICKER_VISIBLE = 60; // options rendered at once — keeps the dropdown fast with hundreds of sections

/**
 * Searchable section dropdown: type to filter, ↑/↓ + Enter or click to choose.
 * Works for hundreds of sections — filtering is plain string search and only
 * the first PICKER_VISIBLE matches are rendered.
 */
function SectionPicker({ sections, selectedId, countsById, onSelect }: {
  sections: Section[];
  selectedId: string;
  countsById: Map<string, number>;
  onSelect: (id: string) => void;
}): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);

  const selected = sections.find(s => s.id === selectedId);
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return sections
      .filter(s => !q || s.name.toLowerCase().includes(q) || s.grade.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [sections, query]);
  const visible = matches.slice(0, PICKER_VISIBLE);

  React.useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent): void => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const choose = (id: string): void => {
    onSelect(id);
    setQuery('');
    setOpen(false);
  };

  return (
    <div ref={boxRef} style={{ position: 'relative', minWidth: 240 }}>
      <button
        className="btn ghost"
        style={{ width: '100%', justifyContent: 'space-between', display: 'flex', gap: 8 }}
        onClick={() => { setOpen(o => !o); setQuery(''); setActive(0); }}
        title="Search sections"
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {selected ? selected.name : 'All sections'}
        </span>
        <span style={{ opacity: 0.6 }}>▾</span>
      </button>
      {open && (
        <div className="popover-card" style={{ position: 'absolute', top: 'calc(100% + 6px)', left: 0, minWidth: 280, zIndex: 30 }}>
          <input
            className="manual-search"
            autoFocus
            value={query}
            placeholder="Type to search sections…"
            onChange={e => { setQuery(e.target.value); setActive(0); }}
            onKeyDown={e => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, visible.length - 1)); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)); }
              else if (e.key === 'Enter') { e.preventDefault(); if (visible[active]) choose(visible[active].id); }
              else if (e.key === 'Escape') setOpen(false);
            }}
          />
          <div style={{ maxHeight: 300, overflowY: 'auto', marginTop: 6 }}>
            {visible.map((s, i) => (
              <button
                key={s.id}
                className={`popover-check ${i === active ? 'active' : ''}`}
                style={{
                  display: 'flex', width: '100%', textAlign: 'left', gap: 8,
                  background: i === active ? 'var(--green-50)' : undefined
                }}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(s.id)}
              >
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 600 }}>{s.name}</span>
                <span style={{ color: 'var(--muted)', fontSize: 12.5 }}>{countsById.get(s.id) ?? 0} students</span>
              </button>
            ))}
            {visible.length === 0 && <div className="empty">No section named “{query.trim()}”.</div>}
            {matches.length > PICKER_VISIBLE && (
              <div className="card-note" style={{ marginTop: 6 }}>
                Showing {PICKER_VISIBLE} of {matches.length} — keep typing to narrow down.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
