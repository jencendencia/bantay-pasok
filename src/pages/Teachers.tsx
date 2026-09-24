import React, { useState } from 'react';
import { useData } from '../store';
import { api } from '../api';
import { Modal, Pill, Segmented, AvatarIcon, printNodes } from '../ui';
import { fmt12, timeToMin, ABSENCE_REASONS } from '../shared/constants';
import { IdCard } from '../components/IdCard';
import type { Teacher, Slot } from '../shared/types';

type SortKey = 'alpha' | 'arrival';

function minutesOfDay(ts: number): number {
  const dt = new Date(ts);
  return dt.getHours() * 60 + dt.getMinutes();
}

export default function Teachers(): React.ReactElement {
  const { data, now, refresh } = useData();
  const [sort, setSort] = useState<SortKey>('arrival');
  const [secFilter, setSecFilter] = useState('all');
  const [depFilter, setDepFilter] = useState('all');
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Teacher | null>(null);
  const [qrTeacher, setQrTeacher] = useState<Teacher | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [reasonSlot, setReasonSlot] = useState<{ slot: Slot; status: { reason: string; note: string } | null } | null>(null);

  if (!data) return <div className="empty">Loading…</div>;
  const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const dow = now.getDay();

  const todaysSlots = data.slots.filter(s => s.days.includes(dow));
  const startedSlots = todaysSlots.filter(s => now.getHours() * 60 + now.getMinutes() >= timeToMin(s.start));

  const bySection = data.sections.map(sec => {
    const mine = startedSlots.filter(s => s.sectionId === sec.id);
    const inCount = mine.filter(s => data.classEvents.some(e => e.slotId === s.id && e.date === dateStr)).length;
    return { sec, total: mine.length, inCount };
  });

  const deps = data.departments;
  const byDept = deps.map(dep => {
    const mine = startedSlots.filter(s => {
      const t = data.teachers.find(x => x.id === s.teacherId);
      return t?.departmentId === dep.id;
    });
    const inCount = mine.filter(s => data.classEvents.some(e => e.slotId === s.id && e.date === dateStr)).length;
    return { dep, total: mine.length, inCount };
  }).filter(r => r.total > 0);

  type LogRow = {
    ts: number | null;
    teacher: Teacher;
    subject: string;
    section: string;
    scheduled: string;
    status: 'in' | 'late' | 'no_scan' | 'excused';
    lateMin: number;
    reason: string;
    slot: Slot;
  };

  const log: LogRow[] = [];
  for (const s of todaysSlots) {
    const t = data.teachers.find(x => x.id === s.teacherId);
    if (!t) continue;
    if (secFilter !== 'all' && s.sectionId !== secFilter) continue;
    const dep = data.departments.find(x => x.id === t.departmentId);
    if (depFilter !== 'all' && t.departmentId !== depFilter) continue;
    const sec = data.sections.find(x => x.id === s.sectionId);
    const ev = data.classEvents.find(e => e.slotId === s.id && e.date === dateStr);
    const st = data.slotStatuses.find(x => x.id === `${s.id}|${dateStr}`);
    const lateMin = ev ? minutesOfDay(ev.ts) - timeToMin(s.start) : 0;
    let status: LogRow['status'] = 'no_scan';
    let reason = '';
    if (ev) status = lateMin > data.settings.graceMinutes ? 'late' : 'in';
    else if (st) { status = 'excused'; reason = st.note || String(st.reason ?? ''); }
    log.push({
      ts: ev?.ts ?? null,
      teacher: t,
      subject: s.subject,
      section: sec?.name.split(' • ')[0] ?? '',
      scheduled: fmt12(s.start),
      status,
      lateMin,
      reason,
      slot: s
    });
  }

  const sorted = [...log].sort((a, b) => {
    if (sort === 'alpha') return a.teacher.lastName.localeCompare(b.teacher.lastName);
    return (a.ts ?? Infinity) - (b.ts ?? Infinity);
  });

  const statusPill = (r: LogRow): React.ReactElement => {
    if (r.status === 'in') return <Pill color="green">On time</Pill>;
    if (r.status === 'late') return <Pill color="orange">Late {r.lateMin} min</Pill>;
    if (r.status === 'excused') {
      const label = r.reason.includes('on_leave') ? 'On leave' : r.reason.includes('in_meeting') ? 'In a meeting' : r.reason || 'Excused';
      return <Pill color="purple">{label}</Pill>;
    }
    return <Pill color="red">No scan yet</Pill>;
  };

  const bar = (label: string, count: number, total: number): React.ReactElement => (
    <div className="bar-row" key={label}>
      <div className="bar-label">{label}</div>
      <div className="bar-track">
        <div
          className={`bar-fill ${total && count / total < 0.7 ? 'orange' : ''}`}
          style={{ width: `${total ? (count / total) * 100 : 0}%` }}
        />
      </div>
      <div className="bar-count">{count}/{total}</div>
    </div>
  );

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">Teachers</h1>
          <div className="page-sub">Class attendance by teacher, based on the class program</div>
        </div>
        <button className="btn yellow" onClick={() => setAdding(true)}>＋ Add teacher</button>
      </div>

      {/* Top Cards: Attendance by section & by department (10_admin_teachers_tab.png) */}
      <div className="grid-2">
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
            <h3 style={{ margin: 0 }}>Attendance by section</h3>
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>Classes started so far today</span>
          </div>
          {bySection.map(r => bar(r.sec.name, r.inCount, r.total))}
        </div>
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
            <h3 style={{ margin: 0 }}>Attendance by department</h3>
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>Classes started so far today</span>
          </div>
          {byDept.map(r => bar(r.dep.name, r.inCount, r.total))}
        </div>
      </div>

      {/* Class Attendance Log (10_admin_teachers_tab.png) */}
      <div className="card" style={{ marginTop: 18 }}>
        <div className="toolbar" style={{ marginBottom: 12 }}>
          <h3 style={{ margin: 0 }}>Class attendance log</h3>
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
          <select
            value={secFilter}
            onChange={e => setSecFilter(e.target.value)}
            style={{ padding: '7px 11px', borderRadius: 8, border: '1px solid var(--line)' }}
          >
            <option value="all">All sections</option>
            {data.sections.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <select
            value={depFilter}
            onChange={e => setDepFilter(e.target.value)}
            style={{ padding: '7px 11px', borderRadius: 8, border: '1px solid var(--line)' }}
          >
            <option value="all">All departments</option>
            {data.departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </div>

        <table className="table">
          <thead>
            <tr>
              <th>Time in</th>
              <th>Teacher</th>
              <th>Subject</th>
              <th>Section</th>
              <th>Scheduled</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r, i) => (
              <tr
                key={`${r.slot.id}-${i}`}
                className={r.status === 'no_scan' || r.status === 'excused' ? 'clickable' : ''}
                onClick={() => {
                  if (r.status === 'no_scan' || r.status === 'excused') {
                    const st = data.slotStatuses.find(x => x.id === `${r.slot.id}|${dateStr}`);
                    setReasonSlot({ slot: r.slot, status: st ? { reason: String(st.reason), note: st.note } : null });
                  }
                }}
                title={r.status === 'no_scan' ? 'Click to record absence reason' : ''}
              >
                <td>{r.ts ? new Date(r.ts).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' }) : '—'}</td>
                <td><b>{r.teacher.firstName} {r.teacher.lastName}</b></td>
                <td>{r.subject}</td>
                <td>{r.section}</td>
                <td>{r.scheduled}</td>
                <td>{statusPill(r)}</td>
              </tr>
            ))}
            {sorted.length === 0 && (
              <tr><td colSpan={6} className="empty">No classes scheduled today matching filters</td></tr>
            )}
          </tbody>
        </table>

        <div className="card-note" style={{ marginTop: 14 }}>
          Teachers come from the class program. Late means the scan came more than {data.settings.graceMinutes} minutes after that slot's start time. Click a red or gray row to add or change the reason.
        </div>
      </div>

      {/* Teacher QR Codes Grid (05_id_cards_qr.png) */}
      <div className="card" style={{ marginTop: 18 }}>
        <div className="toolbar" style={{ marginBottom: 12 }}>
          <h3 style={{ margin: 0 }}>Teacher QR codes</h3>
          <div className="spacer" />
          {selected.size > 0 ? (
            <>
              <span className="toolbar-label">{selected.size} selected</span>
              <button
                className="btn danger small"
                onClick={async () => {
                  const picks = data.teachers.filter(t => selected.has(t.id));
                  if (picks.length === 0) { setSelected(new Set()); return; }
                  const slotCount = data.slots.filter(s => picks.some(t => t.id === s.teacherId)).length;
                  const msg = slotCount
                    ? `Delete ${picks.length} teacher${picks.length > 1 ? 's' : ''}? Their ${slotCount} class slot${slotCount > 1 ? 's' : ''} in the class program will also be removed.`
                    : `Delete ${picks.length} teacher${picks.length > 1 ? 's' : ''}?`;
                  if (!window.confirm(msg)) return;
                  await api.patchData({
                    teachers: data.teachers.filter(t => !selected.has(t.id)),
                    slots: data.slots.filter(s => !selected.has(s.teacherId))
                  });
                  setSelected(new Set());
                  void refresh();
                }}
              >
                🗑 Delete selected
              </button>
              <button className="btn ghost small" onClick={() => setSelected(new Set())}>Clear</button>
            </>
          ) : (
            <span className="toolbar-label">Print official ID cards from here</span>
          )}
        </div>

        <div className="qr-grid">
          {data.teachers.map(t => (
            <div key={t.id} className="qr-card" style={{ position: 'relative' }}>
              <label style={{ position: 'absolute', top: 8, right: 8, cursor: 'pointer', zIndex: 1 }} title="Select for deletion">
                <input
                  type="checkbox"
                  checked={selected.has(t.id)}
                  onChange={e => {
                    const next = new Set(selected);
                    if (e.target.checked) next.add(t.id); else next.delete(t.id);
                    setSelected(next);
                  }}
                  onClick={e => e.stopPropagation()}
                />
              </label>
              <QrImg value={t.qr} size={110} />
              <div className="qc-name">{t.firstName} {t.lastName}</div>
              <div className="qc-sub">{data.departments.find(d => d.id === t.departmentId)?.name}</div>
              <div style={{ fontSize: 11.5, color: '#6a7d73', marginTop: 2, fontWeight: 700 }}>{t.qr}</div>
              <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                <button
                  className="btn ghost small"
                  style={{ flex: 1 }}
                  onClick={() => setEditing(t)}
                  title="Edit teacher info"
                >
                  ✎ Edit
                </button>
                <button
                  className="btn ghost small"
                  style={{ flex: 1, color: 'var(--red)' }}
                  title="Remove teacher"
                  onClick={async () => {
                    const slotCount = data.slots.filter(s => s.teacherId === t.id).length;
                    const msg = slotCount
                      ? `Remove ${t.firstName} ${t.lastName}? Their ${slotCount} class slot${slotCount > 1 ? 's' : ''} in the class program will also be removed.`
                      : `Remove ${t.firstName} ${t.lastName}?`;
                    if (!window.confirm(msg)) return;
                    await api.patchData({
                      teachers: data.teachers.filter(x => x.id !== t.id),
                      slots: data.slots.filter(s => s.teacherId !== t.id)
                    });
                    setSelected(prev => { const n = new Set(prev); n.delete(t.id); return n; });
                    void refresh();
                  }}
                >
                  🗑 Remove
                </button>
              </div>
              <button
                className="btn ghost small"
                style={{ marginTop: 6, width: '100%' }}
                onClick={() => setQrTeacher(t)}
              >
                Print ID Card
              </button>
            </div>
          ))}
        </div>
      </div>

      {adding && <AddTeacherModal onClose={() => setAdding(false)} />}
      {editing && <AddTeacherModal existing={editing} onClose={() => setEditing(null)} />}
      {qrTeacher && <PrintTeacherIdModal teacher={qrTeacher} onClose={() => setQrTeacher(null)} />}

      {reasonSlot && (
        <ReasonModal
          slot={reasonSlot.slot}
          existing={reasonSlot.status}
          date={dateStr}
          onClose={() => setReasonSlot(null)}
        />
      )}
    </div>
  );
}

export function QrImg({ value, size = 120 }: { value: string; size?: number }): React.ReactElement {
  const [src, setSrc] = useState<string>('');
  React.useEffect(() => {
    let mounted = true;
    import('qrcode').then(QR => {
      QR.toDataURL(value, { width: size * 2, margin: 1 }).then(url => {
        if (mounted) setSrc(url);
      });
    }).catch(() => {});
    return () => { mounted = false; };
  }, [value, size]);

  return src ? (
    <img src={src} width={size} height={size} alt="QR Code" style={{ display: 'inline-block' }} />
  ) : (
    <div style={{ width: size, height: size, background: '#eef2ef', borderRadius: 8, display: 'inline-block' }} />
  );
}

function AddTeacherModal({ existing, onClose }: { existing?: Teacher; onClose: () => void }): React.ReactElement {
  const { data, refresh } = useData();
  const [form, setForm] = useState({
    lastName: existing?.lastName ?? '',
    firstName: existing?.firstName ?? '',
    departmentId: existing?.departmentId ?? data?.departments[0]?.id ?? ''
  });
  const [photo, setPhoto] = useState<string | null>(existing?.photoData ?? null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const isEdit = !!existing;
  if (!data) return <div />;

  // Reads the chosen picture and downscales it to max 320px (keeps data.json and SQLite light).
  const pickPhoto = (file: File | undefined): void => {
    if (!file) return;
    setPhotoBusy(true);
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const max = 320;
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d')!.drawImage(img, 0, 0, w, h);
        setPhoto(canvas.toDataURL('image/jpeg', 0.85));
        setPhotoBusy(false);
      };
      img.onerror = () => { setPhoto(null); setPhotoBusy(false); };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  };

  return (
    <Modal title={isEdit ? `Edit ${existing!.firstName} ${existing!.lastName}` : 'Add a teacher'} onClose={onClose} width={540}>
      <div className="form-row" style={{ alignItems: 'flex-start' }}>
        <div className="field" style={{ maxWidth: 150 }}>
          <label>Teacher picture</label>
          <div
            style={{
              width: 120, height: 120, borderRadius: '50%', border: '3px solid var(--yellow)',
              overflow: 'hidden', background: 'var(--green-50)', display: 'grid', placeItems: 'center', cursor: 'pointer'
            }}
            title="Choose a picture"
            onClick={() => document.getElementById('teacher-photo-input')?.click()}
          >
            {photo
              ? <img src={photo} alt="Teacher" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              : <AvatarIcon role="teacher" sex="F" size={110} />}
          </div>
          <input
            id="teacher-photo-input"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            style={{ display: 'none' }}
            onChange={e => { pickPhoto(e.target.files?.[0]); e.target.value = ''; }}
          />
          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
            <button type="button" className="btn ghost small" disabled={photoBusy} onClick={() => document.getElementById('teacher-photo-input')?.click()}>
              {photoBusy ? 'Reading…' : 'Choose file'}
            </button>
            {photo && <button type="button" className="btn ghost small" onClick={() => setPhoto(null)}>Remove</button>}
          </div>
          <div className="card-note" style={{ fontSize: 11.5 }}>Optional — JPEG/PNG. Shows on the ID card.</div>
        </div>
        <div style={{ flex: 1 }}>
          <div className="form-row">
            <div className="field">
              <label>First name</label>
              <input value={form.firstName} onChange={e => setForm({ ...form, firstName: e.target.value })} />
            </div>
            <div className="field">
              <label>Last name</label>
              <input value={form.lastName} onChange={e => setForm({ ...form, lastName: e.target.value })} />
            </div>
          </div>
          <div className="field">
            <label>Department</label>
            <select value={form.departmentId} onChange={e => setForm({ ...form, departmentId: e.target.value })}>
              {data.departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
          {isEdit && (
            <div className="card-note" style={{ marginTop: 4 }}>
              QR code stays the same when editing — the printed ID card keeps working.
            </div>
          )}
        </div>
      </div>
      <div className="modal-actions">
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button
          className="btn yellow"
          disabled={!form.firstName || !form.lastName}
          onClick={async () => {
            if (isEdit && existing) {
              const updated: Teacher = {
                ...existing,
                lastName: form.lastName,
                firstName: form.firstName,
                departmentId: form.departmentId,
                ...(photo ? { photoData: photo } : { photoData: undefined })
              };
              await api.patchData({ teachers: data.teachers.map(t => (t.id === existing.id ? updated : t)) });
            } else {
              const t: Teacher = {
                id: `t_${Date.now().toString(36)}`,
                qr: `T-${String(data.teachers.length + 31).padStart(4, '0')}`,
                lastName: form.lastName,
                firstName: form.firstName,
                middleName: '',
                departmentId: form.departmentId,
                ...(photo ? { photoData: photo } : {})
              };
              await api.patchData({ teachers: [...data.teachers, t] });
            }
            void refresh();
            onClose();
          }}
        >
          {isEdit ? 'Save changes' : 'Add and create QR'}
        </button>
      </div>
    </Modal>
  );
}

// Teacher ID Card Modal matching 05_id_cards_qr.png
function PrintTeacherIdModal({ teacher, onClose }: { teacher: Teacher; onClose: () => void }): React.ReactElement {
  const { data } = useData();
  if (!data) return <div />;
  const dep = data.departments.find(d => d.id === teacher.departmentId);

  return (
    <Modal title="Teacher ID card" onClose={onClose} width={420}>
      <div style={{ display: 'grid', placeItems: 'center', padding: '10px 0' }}>
        <IdCard
          variant="teacher"
          schoolName={data.settings.schoolName}
          subLabel="Faculty and staff"
          name={`${teacher.firstName} ${teacher.lastName}`}
          sub={dep?.name ? `${dep.name} Department` : 'Faculty Member'}
          sex="F"
          qr={teacher.qr}
          photoData={teacher.photoData}
        />
      </div>

      <div className="modal-actions">
        <button className="btn ghost" onClick={onClose}>Close</button>
        <button className="btn primary" onClick={() => printNodes(
          <IdCard
            variant="teacher"
            schoolName={data.settings.schoolName}
            subLabel="Faculty and staff"
            name={`${teacher.firstName} ${teacher.lastName}`}
            sub={dep?.name ? `${dep.name} Department` : 'Faculty Member'}
            sex="F"
            qr={teacher.qr}
          />
        )}>
          Print ID Card
        </button>
      </div>
    </Modal>
  );
}

function ReasonModal({
  slot,
  existing,
  date,
  onClose
}: {
  slot: Slot;
  existing: { reason: string; note: string } | null;
  date: string;
  onClose: () => void;
}): React.ReactElement {
  const { data, refresh } = useData();
  const [reason, setReason] = useState<string>(existing?.reason ?? 'in_meeting');
  const [note, setNote] = useState(existing?.note ?? '');
  const teacher = data?.teachers.find(t => t.id === slot.teacherId);
  const sec = data?.sections.find(s => s.id === slot.sectionId);

  return (
    <Modal title="Reason for absence" sub="This slot has no teacher scan." onClose={onClose} width={580}>
      <div className="card" style={{ background: 'var(--green-50)', marginBottom: 14 }}>
        <div style={{ fontWeight: 800, fontSize: 16 }}>
          {teacher ? `Ma'am/Sir ${teacher.firstName} ${teacher.lastName}` : 'Unassigned Teacher'}
        </div>
        <div style={{ color: 'var(--muted)', fontSize: 13.5, marginTop: 2 }}>
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
