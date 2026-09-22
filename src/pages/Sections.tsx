import React, { useMemo, useState } from 'react';
import { useData } from '../store';
import { api } from '../api';
import { Modal, Pill, Segmented } from '../ui';
import { fmt12, timeToMin } from '../shared/constants';
import type { Student } from '../shared/types';

type SortKey = 'alpha' | 'arrival';
type View = 'stats' | 'section';

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
  const [newName, setNewName] = useState('');
  const [newGrade, setNewGrade] = useState('');

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

  if (!data) return <div className="empty">Loading…</div>;
  const sec = data.sections.find(x => x.id === sectionId) ?? data.sections[1] ?? data.sections[0];
  const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  const bySection = data.sections.map(x => {
    const studs = data.students.filter(s => s.sectionId === x.id);
    let present = 0, early = 0, onTime = 0, late = 0, absent = 0;
    const earlyC = timeToMin(data.settings.earlyCutoff), lateC = timeToMin(data.settings.lateAfter);
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
    setManageOpen(false);
    void refresh();
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
    const earlyC = timeToMin(data.settings.earlyCutoff), lateC = timeToMin(data.settings.lateAfter);
    if (m < earlyC) return <Pill color="blue">Early</Pill>;
    if (m <= lateC) return <Pill color="green">On time</Pill>;
    return <Pill color="orange">Late</Pill>;
  };

  const rosterTable = (list: Student[]): React.ReactElement => (
    <table className="table">
      <thead>
        <tr><th>Name</th><th>Arrived</th><th>Status</th><th>Left</th><th>Parent SMS</th></tr>
      </thead>
      <tbody>
        {list.map(st => {
          const inEv = data.attendance.find(e => e.studentId === st.id && e.date === dateStr && e.kind === 'in');
          const outEv = data.attendance.find(e => e.studentId === st.id && e.date === dateStr && e.kind === 'out');
          const sms = data.sms.filter(m => m.studentId === st.id && new Date(m.ts).toDateString() === now.toDateString());
          const sent = sms.some(m => m.status === 'sent');
          return (
            <tr key={st.id}>
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
        {list.length === 0 && <tr><td colSpan={5} className="empty">No students in this section</td></tr>}
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
        const status = !inEv ? 'Absent' : m < timeToMin(data.settings.earlyCutoff) ? 'Early' : m <= timeToMin(data.settings.lateAfter) ? 'On time' : 'Late';
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

      {/* Section switcher: jump straight into a section's students, schedule and attendance */}
      <div className="card" style={{ padding: '12px 16px', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span className="toolbar-label" style={{ marginRight: 2 }}>Section</span>
          {data.sections.map(s => (
            <button
              key={s.id}
              className={`btn small ${s.id === sec.id && view === 'section' ? 'primary' : 'ghost'}`}
              onClick={() => switchSection(s.id)}
            >
              {s.name}
              <span style={{ opacity: 0.65, fontWeight: 500 }}> · {data.students.filter(x => x.sectionId === s.id).length}</span>
            </button>
          ))}
          <div className="spacer" />
          <button
            className={`btn small ${view === 'stats' ? 'primary' : 'ghost'}`}
            onClick={() => setView('stats')}
          >
            ▤ All sections
          </button>
          <button className="btn ghost small" title="Add or rename sections" onClick={() => setManageOpen(true)}>
            ⚙
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
        <Modal title="Add a section" sub="New sections appear in the switcher above and in the class program." onClose={() => setManageOpen(false)} width={420}>
          <div className="field">
            <label>Section name (e.g. "G7 • Ilang-Ilang")</label>
            <input value={newName} placeholder="G7 • Ilang-Ilang" onChange={e => setNewName(e.target.value)} />
          </div>
          <div className="field">
            <label>Grade level</label>
            <input value={newGrade} placeholder="Grade 7" onChange={e => setNewGrade(e.target.value)} />
          </div>
          <div className="modal-actions">
            <button className="btn ghost" onClick={() => setManageOpen(false)}>Cancel</button>
            <button className="btn primary" disabled={!newName.trim()} onClick={() => void addSection()}>Add section</button>
          </div>
        </Modal>
      )}

    </div>
  );
}
