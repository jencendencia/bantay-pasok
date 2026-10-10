import React, { useEffect, useMemo, useState } from 'react';
import { useData } from '../store';
import { api } from '../api';
import { Segmented } from '../ui';
import { bucketByKey, countMarks, schoolDaysBetween, teacherOccurrences, weekKey } from '../shared/reportStats';

type RType = 'teacher' | 'teacher_individual' | 'student' | 'student_punctuality';
type Freq = 'daily' | 'weekly' | 'monthly' | 'term';

const SHEET_ROWS: Record<RType, [string, string][]> = {
  teacher: [
    ['Summary', 'Totals per teacher with day-by-day marks'],
    ['Daily log', 'Every class: date, section, scheduled time, time in, minutes late, reason'],
    ['By section', 'How often the teacher attended each section']
  ],
  teacher_individual: [
    ['Summary', 'Scheduled, attended, late and absent counts with attendance and punctuality rates'],
    ['Frequency', 'The same counts broken down per week, per month and per term'],
    ['Daily log', 'Every class: date, section, scheduled time, time in, minutes late, reason']
  ],
  student: [
    ['Summary', 'Each student per day: present or absent, with rate'],
    ['By section', 'Section-level totals']
  ],
  student_punctuality: [
    ['Summary', 'Early, on time, late and absent counts with punctuality rate']
  ]
};

export default function Reports(): React.ReactElement {
  const { data, now } = useData();
  const [type, setType] = useState<RType>('teacher');
  const [freq, setFreq] = useState<Freq>('weekly');
  const [teacherId, setTeacherId] = useState('');
  const [from, setFrom] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 7);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });
  const [to, setTo] = useState(() => `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // A real range is two valid dates with From <= To; anything else would
  // silently build an empty (or NaN-dated) workbook.
  const rangeOk = /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to) && from <= to;

  // A download message is only about the settings that produced it.
  useEffect(() => { setMsg(null); }, [type, from, to, teacherId]);

  // NOTE: must stay before any early return (rules of hooks).
  const preview = useMemo(() => {
    if (!data || type !== 'teacher_individual' || !teacherId) return null;
    const t = data.teachers.find(x => x.id === teacherId);
    if (!t) return null;
    // Real numbers from the same shared rules the Excel file uses.
    const occs = teacherOccurrences(data, from, to, teacherId);
    const totals = countMarks(occs);
    const weekMap = bucketByKey(occs, o => weekKey(o.date));
    const weeks = [...weekMap].map(([label, c]) => ({ label: label.replace('Week of ', ''), s: c.scheduled, a: c.attended }));
    // Group into at most 8 bars so a long term still fits the card.
    const per = Math.ceil(weeks.length / 8) || 1;
    const bars: { label: string; pct: number }[] = [];
    for (let i = 0; i < weeks.length; i += per) {
      const grp = weeks.slice(i, i + per);
      const s = grp.reduce((a, b) => a + b.s, 0);
      const a = grp.reduce((a, b) => a + b.a, 0);
      bars.push({ label: grp[0].label, pct: s ? Math.round((a / s) * 100) : 0 });
    }
    return { t, totals, bars };
  }, [data, type, teacherId, from, to]);

  if (!data) return <div className="empty">Loading…</div>;

  const terms = data.settings.terms;
  const activeTerm = terms.find(t => to >= t.start && to <= t.end);
  // A weekend-only or holiday-only range would silently produce an empty file.
  const noSchoolDays = rangeOk && schoolDaysBetween(data, from, to).length === 0;

  const applyFreq = (f: Freq): void => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(to)) return; // no valid anchor date to preset from
    const t = new Date(to + 'T00:00:00');
    const iso = (d: Date): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    let nf = from, nt = to;
    if (f === 'daily') { nf = iso(t); nt = iso(t); }
    if (f === 'weekly') { const s = new Date(t); s.setDate(t.getDate() - ((t.getDay() + 6) % 7)); const e = new Date(s); e.setDate(s.getDate() + 4); nf = iso(s); nt = iso(e); }
    if (f === 'monthly') { nf = iso(new Date(t.getFullYear(), t.getMonth(), 1)); nt = iso(new Date(t.getFullYear(), t.getMonth() + 1, 0)); }
    if (f === 'term') { if (!activeTerm) return; nf = activeTerm.start; nt = activeTerm.end; }
    setFreq(f); setFrom(nf); setTo(nt);
  };

  const download = async (): Promise<void> => {
    if (!rangeOk || noSchoolDays || busy) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await api.buildReport({
        type,
        from,
        to,
        teacherId: type === 'teacher_individual' ? teacherId : undefined
      });
      setMsg(res.ok
        ? (res.data?.saved ? `Saved: ${res.data.filename}` : 'Cancelled')
        : `Error: ${res.error}`);
    } catch (err) {
      setMsg(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  const fname = (() => {
    const base = type === 'teacher' ? 'Attendance_Teachers' : type === 'student' ? 'Attendance_Students'
      : type === 'student_punctuality' ? 'Punctuality_Students' : `Attendance_${data.teachers.find(t => t.id === teacherId)?.lastName.replace(/\s+/g, '') ?? 'Teacher'}`;
    return `${base}_${from}_${to}.xlsx`;
  })();

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">Reports</h1>
          <div className="page-sub">Excel reports for teachers and students, ready to download</div>
        </div>
      </div>

      <div className="grid-1-2">
        <div className="stack">
          <div className="card">
            <h3>1. What do you need?</h3>
            <div className="grid-2" style={{ gap: 10 }}>
              {([
                ['teacher', 'Teacher class attendance', 'All teachers, all sections'],
                ['teacher_individual', 'Individual teacher', 'Attendance to class, one person'],
                ['student', 'Student attendance', 'Present and absent by section'],
                ['student_punctuality', 'Student punctuality', 'Early, on time and late']
              ] as [RType, string, string][]).map(([id, title, sub]) => (
                <button
                  key={id}
                  className="reason-card"
                  style={{ flexDirection: 'column', alignItems: 'flex-start', borderColor: type === id ? 'var(--green-900)' : 'var(--line)', background: type === id ? 'var(--green-50)' : '#fff' }}
                  onClick={() => setType(id)}
                >
                  <span className="rc-title">{title}</span>
                  <span className="rc-hint">{sub}</span>
                </button>
              ))}
            </div>
            {type === 'teacher_individual' && (
              <div className="field" style={{ marginTop: 12 }}>
                <label>Teacher</label>
                <select value={teacherId} onChange={e => setTeacherId(e.target.value)}>
                  <option value="">Choose a teacher…</option>
                  {data.teachers.map(t => {
                    const dep = data.departments.find(x => x.id === t.departmentId)?.name;
                    return (
                      <option key={t.id} value={t.id}>
                        {t.firstName} {t.lastName}{dep ? ` · ${dep}` : ''}
                      </option>
                    );
                  })}
                </select>
              </div>
            )}
          </div>

          <div className="card">
            <h3>2. How often?</h3>
            <Segmented
              options={[{ id: 'daily' as Freq, label: 'Daily' }, { id: 'weekly' as Freq, label: 'Weekly' }, { id: 'monthly' as Freq, label: 'Monthly' }, { id: 'term' as Freq, label: 'By term' }]}
              value={freq} onChange={applyFreq}
            />
            <div className="form-row" style={{ marginTop: 12 }}>
              <div className="field"><label>From</label><input type="date" value={from} onChange={e => setFrom(e.target.value)} /></div>
              <div className="field"><label>To</label><input type="date" value={to} onChange={e => setTo(e.target.value)} /></div>
            </div>
            <div className="field">
              <label>Or pick a term</label>
              <div className="toolbar">
                {terms.map(t => (
                  <button key={t.name} className={`btn small ${activeTerm?.name === t.name ? 'primary' : 'ghost'}`}
                    onClick={() => { setFrom(t.start); setTo(t.end); setFreq('term'); }}>{t.name}</button>
                ))}
              </div>
            </div>
          </div>

          <div className="card">
            <h3>3. Download</h3>
            <div className="toolbar">
              <button className="btn primary" disabled={busy || !rangeOk || noSchoolDays || (type === 'teacher_individual' && !teacherId)} onClick={() => void download()}>
                ⬇ Download Excel (.xlsx)
              </button>
            </div>
            <div className="card-note">File name: {fname}</div>
            {!rangeOk && <div className="notice error" style={{ marginTop: 10 }}>Pick a valid range: From and To must be real dates, with To on or after From.</div>}
            {rangeOk && noSchoolDays && <div className="notice error" style={{ marginTop: 10 }}>No school days in this range (weekend or holiday) — there would be nothing to report.</div>}
            {msg && <div className="notice info" style={{ marginTop: 10 }}>{msg}</div>}
          </div>
        </div>

        <div className="stack">
          <div className="card">
            <h3>
              Preview{preview ? ` · ${preview.t.firstName} ${preview.t.lastName}, ${freq} frequency` : ''}
            </h3>
            {type === 'teacher_individual' && preview ? (
              preview.totals.scheduled === 0 ? (
                <div className="card-note">No classes scheduled for this teacher in the chosen range.</div>
              ) : (
                <>
                  <div className="grid-2" style={{ gap: 10, marginBottom: 12 }}>
                    <div className="card" style={{ background: '#f4f6f5' }}><div style={{ color: 'var(--muted)', fontSize: 12.5 }}>Classes scheduled</div><div style={{ fontSize: 26, fontWeight: 800 }}>{preview.totals.scheduled}</div></div>
                    <div className="card" style={{ background: 'var(--green-100)' }}><div style={{ color: 'var(--muted)', fontSize: 12.5 }}>Attended</div><div style={{ fontSize: 26, fontWeight: 800 }}>{preview.totals.attended}</div></div>
                  </div>
                  <div style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 6 }}>Attendance to class per week</div>
                  <div className="chart-bars">
                    {preview.bars.map(b => (
                      <div key={b.label} className="chart-bar">
                        <div className="cb-count">{b.pct}%</div>
                        <div className={`cb-rect ${b.pct < 90 ? 'orange' : ''}`} style={{ height: `${b.pct}%` }} />
                        <div className="cb-label">{b.label}</div>
                      </div>
                    ))}
                  </div>
                </>
              )
            ) : (
              <div>
                <table className="table">
                  <thead><tr><th>Sheet</th><th>What it shows</th></tr></thead>
                  <tbody>
                    {SHEET_ROWS[type].map(([a, b]) => (
                      <tr key={a}><td><b>{a}</b></td><td>{b}</td></tr>
                    ))}
                  </tbody>
                </table>
                <div className="card-note">Excused leave (on leave / in a meeting) is excluded from the attendance rate.</div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
