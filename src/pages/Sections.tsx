import React, { useMemo, useState } from 'react';
import { useData } from '../store';
import { api } from '../api';
import { Modal, Pill, Segmented } from '../ui';
import { fmt12, timeToMin } from '../shared/constants';
import type { Student } from '../shared/types';

type SortKey = 'alpha' | 'arrival';

function minutesOfDay(ts: number): number {
  const dt = new Date(ts);
  return dt.getHours() * 60 + dt.getMinutes();
}

export default function Sections(): React.ReactElement {
  const { data, now, refresh } = useData();
  const [sectionId, setSectionId] = useState<string | null>(null);
  const [sort, setSort] = useState<SortKey>('arrival');
  const [enrollBatchOpen, setEnrollBatchOpen] = useState(false);
  const [singleStudentForm, setSingleStudentForm] = useState({
    lastName: '',
    firstName: '',
    sex: 'M' as 'M' | 'F',
    sectionId: ''
  });

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

  const roster = data.students.filter(s => s.sectionId === sec.id);
  const sorted = [...roster].sort((a, b) => {
    if (sort === 'alpha') return `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`);
    const ta = data.attendance.find(e => e.studentId === a.id && e.date === dateStr && e.kind === 'in')?.ts ?? Infinity;
    const tb = data.attendance.find(e => e.studentId === b.id && e.date === dateStr && e.kind === 'in')?.ts ?? Infinity;
    return ta - tb;
  });
  const males = sorted.filter(s => s.sex === 'M');
  const females = sorted.filter(s => s.sex === 'F');

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

  const handleEnrollSingle = async () => {
    if (!singleStudentForm.lastName || !singleStudentForm.firstName) return;
    const targetSec = singleStudentForm.sectionId || sec.id;
    const sId = `s_${Date.now().toString(36)}`;
    const newStudent: Student = {
      id: sId,
      qr: `S-2026-${String(data.students.length + 420).padStart(5, '0')}`,
      lastName: singleStudentForm.lastName,
      firstName: singleStudentForm.firstName,
      middleName: '',
      sex: singleStudentForm.sex,
      number: '',
      sectionId: targetSec,
      guardianId: null
    };
    await api.patchData({ students: [...data.students, newStudent] });
    setSingleStudentForm({ lastName: '', firstName: '', sex: 'M', sectionId: targetSec });
    void refresh();
  };

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

      {/* Top Grid: Enrol Card & Attendance Statistics (09_admin_sections_tab.png) */}
      <div className="grid-1-2">
        {/* Left column */}
        <div className="stack">
          {/* Enrol a student form card */}
          <div className="card">
            <h3>Enrol a student</h3>
            <div className="field">
              <label>Section</label>
              <select
                value={singleStudentForm.sectionId || sec.id}
                onChange={e => setSingleStudentForm({ ...singleStudentForm, sectionId: e.target.value })}
              >
                {data.sections.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>

            <div className="field">
              <label>Sex</label>
              <div className="segmented">
                <button
                  className={singleStudentForm.sex === 'M' ? 'active' : ''}
                  onClick={() => setSingleStudentForm({ ...singleStudentForm, sex: 'M' })}
                >
                  Male
                </button>
                <button
                  className={singleStudentForm.sex === 'F' ? 'active' : ''}
                  onClick={() => setSingleStudentForm({ ...singleStudentForm, sex: 'F' })}
                >
                  Female
                </button>
              </div>
            </div>

            <div className="form-row">
              <div className="field">
                <label>Last name</label>
                <input
                  value={singleStudentForm.lastName}
                  placeholder="Tolentino"
                  onChange={e => setSingleStudentForm({ ...singleStudentForm, lastName: e.target.value })}
                />
              </div>
              <div className="field">
                <label>First name and M.I.</label>
                <input
                  value={singleStudentForm.firstName}
                  placeholder="Jerome A."
                  onChange={e => setSingleStudentForm({ ...singleStudentForm, firstName: e.target.value })}
                />
              </div>
            </div>

            <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
              <button
                className="btn yellow"
                style={{ flex: 1 }}
                disabled={!singleStudentForm.lastName || !singleStudentForm.firstName}
                onClick={() => void handleEnrollSingle()}
              >
                ＋ Enrol and create QR
              </button>
              <button
                className="btn ghost"
                title="Enrol existing students in batch"
                onClick={() => setEnrollBatchOpen(true)}
              >
                ☑ Batch
              </button>
            </div>
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
                    style={r.section.id === sec.id ? { background: 'var(--green-50)' } : undefined}
                    onClick={() => setSectionId(r.section.id)}
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
          <button className="btn primary small" onClick={() => setEnrollBatchOpen(true)}>
            ☑ Enrol students
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

      {/* Batch Enrol Students Modal */}
      {enrollBatchOpen && (
        <EnrollBatchModal
          sectionId={sec.id}
          onClose={() => setEnrollBatchOpen(false)}
        />
      )}
    </div>
  );
}

function EnrollBatchModal({
  sectionId,
  onClose
}: {
  sectionId: string;
  onClose: () => void;
}): React.ReactElement {
  const { data, refresh } = useData();
  const [target, setTarget] = useState(sectionId);
  const [checked, setChecked] = useState<Set<string>>(new Set());

  if (!data) return <div />;

  // Students not currently in this section
  const unenrolled = data.students.filter(s => s.sectionId !== target);

  const toggleAll = () => {
    if (checked.size === unenrolled.length) {
      setChecked(new Set());
    } else {
      setChecked(new Set(unenrolled.map(s => s.id)));
    }
  };

  const toggle = (id: string) => {
    const n = new Set(checked);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    setChecked(n);
  };

  const targetSec = data.sections.find(s => s.id === target);

  return (
    <Modal
      title="Enrol students"
      sub="Tick students to enrol them into the selected section."
      onClose={onClose}
      width={640}
    >
      <div className="field">
        <label>Select Target Section</label>
        <select
          value={target}
          onChange={e => {
            setTarget(e.target.value);
            setChecked(new Set());
          }}
        >
          {data.sections.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '8px 0' }}>
        <span style={{ fontSize: 13, color: 'var(--muted)' }}>
          {unenrolled.length} students not yet enrolled in {targetSec?.name}
        </span>
        <button className="btn ghost small" onClick={toggleAll}>
          {checked.size === unenrolled.length && unenrolled.length > 0 ? 'Deselect all' : 'Select all'}
        </button>
      </div>

      <div style={{ maxHeight: 320, overflowY: 'auto', border: '1px solid var(--line)', borderRadius: 10, padding: '4px 10px' }}>
        {unenrolled.map(st => (
          <label key={st.id} className="check-row" style={{ cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={checked.has(st.id)}
              onChange={() => toggle(st.id)}
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

      <div className="modal-actions">
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button
          className="btn primary"
          disabled={checked.size === 0}
          onClick={async () => {
            const next = data.students.map(s => (checked.has(s.id) ? { ...s, sectionId: target } : s));
            await api.patchData({ students: next });
            void refresh();
            onClose();
          }}
        >
          Enrol {checked.size ? `${checked.size} student${checked.size > 1 ? 's' : ''}` : ''} to {targetSec?.name}
        </button>
      </div>
    </Modal>
  );
}
