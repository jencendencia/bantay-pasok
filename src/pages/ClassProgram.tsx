import React, { useMemo, useState } from 'react';
import { useData } from '../store';
import { api } from '../api';
import { Modal, Pill } from '../ui';
import { SUBJECTS, fmt12 } from '../shared/constants';
import type { Slot } from '../shared/types';

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

function timeOptions(): string[] {
  const out: string[] = [];
  for (let m = 6 * 60; m <= 18 * 60; m += 10) {
    const h = Math.floor(m / 60), mm = m % 60;
    out.push(`${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`);
  }
  return out;
}

export default function ClassProgram(): React.ReactElement {
  const { data, refresh } = useData();
  const [sectionId, setSectionId] = useState<string | null>(null);
  const [copyModalOpen, setCopyModalOpen] = useState(false);
  const [editingSlot, setEditingSlot] = useState<Slot | null>(null);

  // Form state on the left card (08_admin_class_program_tab.png)
  const [form, setForm] = useState<{
    start: string;
    end: string;
    days: number[];
    subject: string;
    departmentId: string;
    teacherId: string;
  }>({
    start: '10:20',
    end: '11:10',
    days: [1, 2, 3, 4, 5],
    subject: SUBJECTS[4].name, // TLE
    departmentId: SUBJECTS[4].dept,
    teacherId: ''
  });
  const [err, setErr] = useState<string | null>(null);

  // NOTE: must stay before any early return (rules of hooks).
  const conflict = useMemo(() => {
    if (!data) return null;
    const sec = data.sections.find(x => x.id === sectionId) ?? data.sections[1] ?? data.sections[0];
    if (!sec) return null;
    const teacherAssignedId = form.teacherId || (data.teachers[0] ? data.teachers[0].id : '');
    if (!teacherAssignedId) return null;
    for (const s of data.slots) {
      if (s.sectionId === sec.id && s.start === form.start) continue; // editing or same slot
      if (s.teacherId !== teacherAssignedId) continue;
      if (!s.days.some(d => form.days.includes(d))) continue;

      const overlap = form.start < s.end && s.start < form.end;
      if (overlap) {
        const t = data.teachers.find(x => x.id === teacherAssignedId);
        const otherSec = data.sections.find(x => x.id === s.sectionId);
        const dayNames = s.days.filter(d => form.days.includes(d)).map(d => DAY_LABELS[d - 1]).join(', ');
        return `${t?.firstName} ${t?.lastName} already teaches ${otherSec?.name} at ${fmt12(s.start)} on ${dayNames}. Choose another teacher or time.`;
      }
    }
    return null;
  }, [data, sectionId, form.teacherId, form.start, form.end, form.days]);

  if (!data) return <div className="empty">Loading…</div>;
  const sec = data.sections.find(x => x.id === sectionId) ?? data.sections[1] ?? data.sections[0];
  const slots = data.slots.filter(s => s.sectionId === sec.id).sort((a, b) => a.start.localeCompare(b.start));

  const teacherAssignedId = form.teacherId || (data.teachers[0] ? data.teachers[0].id : '');

  const handleAddSlot = async () => {
    setErr(null);
    if (!teacherAssignedId) { setErr('Please choose a teacher'); return; }
    if (form.start >= form.end) { setErr('End time must be after start time'); return; }
    if (form.days.length === 0) { setErr('Select at least one day'); return; }

    const newSlot: Slot = {
      id: `slot_${Date.now().toString(36)}`,
      sectionId: sec.id,
      subject: form.subject,
      departmentId: form.departmentId,
      teacherId: teacherAssignedId,
      start: form.start,
      end: form.end,
      days: form.days
    };

    await api.patchData({ slots: [...data.slots, newSlot] });
    void refresh();
  };

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">Class program</h1>
          <div className="page-sub">Enrol subjects, times and assigned teachers for each section</div>
        </div>
      </div>

      {/* Main Grid matching 08_admin_class_program_tab.png */}
      <div className="grid-1-2">
        {/* Left Card: Add a class slot inline form */}
        <div className="card" style={{ alignSelf: 'start' }}>
          <h3>Add a class slot</h3>

          <div className="field">
            <label>Section</label>
            <select value={sec.id} onChange={e => setSectionId(e.target.value)}>
              {data.sections.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>

          <div className="form-row">
            <div className="field">
              <label>Start</label>
              <select value={form.start} onChange={e => setForm({ ...form, start: e.target.value })}>
                {timeOptions().map(t => <option key={t} value={t}>{fmt12(t)}</option>)}
              </select>
            </div>
            <div className="field">
              <label>End</label>
              <select value={form.end} onChange={e => setForm({ ...form, end: e.target.value })}>
                {timeOptions().map(t => <option key={t} value={t}>{fmt12(t)}</option>)}
              </select>
            </div>
          </div>

          <div className="field">
            <label>Days</label>
            <div style={{ display: 'flex', gap: 5 }}>
              {DAY_LABELS.map((lbl, i) => {
                const d = i + 1;
                const on = form.days.includes(d);
                return (
                  <button
                    key={lbl}
                    type="button"
                    className={`btn small ${on ? 'primary' : 'ghost'}`}
                    style={{ flex: 1, padding: '7px 0' }}
                    onClick={() => {
                      const next = on ? form.days.filter(x => x !== d) : [...form.days, d];
                      setForm({ ...form, days: next });
                    }}
                  >
                    {lbl}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="field">
            <label>Subject and department</label>
            <select
              value={form.subject}
              onChange={e => {
                const sub = SUBJECTS.find(s => s.name === e.target.value);
                setForm({
                  ...form,
                  subject: e.target.value,
                  departmentId: sub ? sub.dept : form.departmentId
                });
              }}
            >
              {SUBJECTS.map(s => (
                <option key={s.name} value={s.name}>
                  {s.name} · {data.departments.find(d => d.id === s.dept)?.name || s.dept}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label>Teacher assigned</label>
            <select
              value={teacherAssignedId}
              onChange={e => setForm({ ...form, teacherId: e.target.value })}
            >
              {data.teachers.map(t => (
                <option key={t.id} value={t.id}>
                  {t.firstName} {t.lastName}
                </option>
              ))}
            </select>
          </div>

          {/* Double-booking warning banner (08_admin_class_program_tab.png) */}
          {conflict && (
            <div className="notice" style={{ marginTop: 8, marginBottom: 12 }}>
              <span>⚠</span>
              <div>{conflict}</div>
            </div>
          )}

          {err && <div className="notice error" style={{ marginBottom: 12 }}>⚠ {err}</div>}

          <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
            <button
              className="btn yellow"
              style={{ flex: 1 }}
              onClick={() => void handleAddSlot()}
            >
              ＋ Add slot
            </button>
            <button
              className="btn ghost"
              onClick={() => setCopyModalOpen(true)}
              title="Copy this section's schedule to another section"
            >
              Copy to another section
            </button>
          </div>

          <div className="card-note" style={{ marginTop: 14 }}>
            New teachers get a QR code the moment they are added. Print it from the Teachers tab.
          </div>
        </div>

        {/* Right Card: Class Program Table (08_admin_class_program_tab.png) */}
        <div className="card">
          <div className="toolbar" style={{ marginBottom: 14 }}>
            <h3 style={{ margin: 0 }}>Class program</h3>
            <div className="spacer" />
            <div className="tabbar">
              {data.sections.map(x => (
                <button
                  key={x.id}
                  className={x.id === sec.id ? 'active' : ''}
                  onClick={() => setSectionId(x.id)}
                >
                  {x.name}
                </button>
              ))}
            </div>
          </div>

          <table className="table">
            <thead>
              <tr>
                <th>Period</th>
                <th>Time</th>
                <th>Subject</th>
                <th>Department</th>
                <th>Teacher</th>
                <th>Days</th>
                <th>Teacher QR</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {slots.map((s, i) => {
                const t = data.teachers.find(x => x.id === s.teacherId);
                const dep = data.departments.find(x => x.id === s.departmentId);
                return (
                  <tr key={s.id}>
                    <td><b>P{i + 1}</b></td>
                    <td>{fmt12(s.start)} – {fmt12(s.end)}</td>
                    <td><b>{s.subject}</b></td>
                    <td>{dep?.name ?? ''}</td>
                    <td>{t ? `${t.firstName} ${t.lastName}` : '—'}</td>
                    <td style={{ fontSize: 13, color: '#3d5248' }}>Mon – Fri</td>
                    <td>
                      <span className="pill green" style={{ fontSize: 11.5 }}>QR issued</span>
                    </td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button
                        className="btn ghost small"
                        style={{ padding: '4px 8px' }}
                        onClick={() => setEditingSlot(s)}
                        title="Edit slot"
                      >
                        ✎
                      </button>{' '}
                      <button
                        className="btn ghost small"
                        style={{ padding: '4px 8px' }}
                        onClick={async () => {
                          if (!window.confirm(`Delete the ${s.subject} slot (${fmt12(s.start)}–${fmt12(s.end)})? This cannot be undone.`)) return;
                          await api.patchData({ slots: data.slots.filter(x => x.id !== s.id) });
                          void refresh();
                        }}
                        title="Delete slot"
                      >
                        🗑
                      </button>
                    </td>
                  </tr>
                );
              })}
              {slots.length === 0 && (
                <tr><td colSpan={8} className="empty">No class slots enrolled for this section yet</td></tr>
              )}
            </tbody>
          </table>

          <div className="card-note" style={{ marginTop: 16 }}>
            Late marks for teachers use the start time in this table, with a grace period of {data.settings.graceMinutes} minutes (set by admin).
          </div>
        </div>
      </div>

      {/* Edit Slot Modal */}
      {editingSlot && (
        <EditSlotModal
          slot={editingSlot}
          onClose={() => setEditingSlot(null)}
        />
      )}

      {/* Copy Schedule to Another Section Modal */}
      {copyModalOpen && (
        <CopyScheduleModal
          fromSection={sec}
          onClose={() => setCopyModalOpen(false)}
        />
      )}
    </div>
  );
}

function EditSlotModal({ slot, onClose }: { slot: Slot; onClose: () => void }): React.ReactElement {
  const { data, refresh } = useData();
  const [form, setForm] = useState({
    subject: slot.subject,
    departmentId: slot.departmentId,
    teacherId: slot.teacherId,
    start: slot.start,
    end: slot.end,
    days: slot.days
  });
  if (!data) return <div />;

  return (
    <Modal title="Edit class slot" onClose={onClose} width={500}>
      <div className="form-row">
        <div className="field">
          <label>Start</label>
          <select value={form.start} onChange={e => setForm({ ...form, start: e.target.value })}>
            {timeOptions().map(t => <option key={t} value={t}>{fmt12(t)}</option>)}
          </select>
        </div>
        <div className="field">
          <label>End</label>
          <select value={form.end} onChange={e => setForm({ ...form, end: e.target.value })}>
            {timeOptions().map(t => <option key={t} value={t}>{fmt12(t)}</option>)}
          </select>
        </div>
      </div>
      <div className="field">
        <label>Subject</label>
        <input value={form.subject} onChange={e => setForm({ ...form, subject: e.target.value })} />
      </div>
      <div className="field">
        <label>Teacher</label>
        <select value={form.teacherId} onChange={e => setForm({ ...form, teacherId: e.target.value })}>
          {data.teachers.map(t => <option key={t.id} value={t.id}>{t.firstName} {t.lastName}</option>)}
        </select>
      </div>
      <div className="modal-actions">
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button
          className="btn primary"
          onClick={async () => {
            const next = data.slots.map(s => s.id === slot.id ? { ...s, ...form } : s);
            await api.patchData({ slots: next });
            void refresh();
            onClose();
          }}
        >
          Save changes
        </button>
      </div>
    </Modal>
  );
}

function CopyScheduleModal({
  fromSection,
  onClose
}: {
  fromSection: { id: string; name: string };
  onClose: () => void;
}): React.ReactElement {
  const { data, refresh } = useData();
  const [targetId, setTargetId] = useState(
    data?.sections.find(s => s.id !== fromSection.id)?.id || ''
  );
  if (!data) return <div />;

  const handleCopy = async () => {
    const sourceSlots = data.slots.filter(s => s.sectionId === fromSection.id);
    const newSlots = sourceSlots.map(s => ({
      ...s,
      id: `slot_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      sectionId: targetId
    }));
    // Remove existing slots in target and replace with copied
    const otherSlots = data.slots.filter(s => s.sectionId !== targetId);
    await api.patchData({ slots: [...otherSlots, ...newSlots] });
    void refresh();
    onClose();
  };

  return (
    <Modal title="Copy schedule to another section" onClose={onClose} width={480}>
      <p style={{ color: 'var(--muted)', fontSize: 14, marginTop: 0 }}>
        Copy all slots from <b>{fromSection.name}</b> to another section.
      </p>
      <div className="field">
        <label>Select Target Section</label>
        <select value={targetId} onChange={e => setTargetId(e.target.value)}>
          {data.sections.filter(s => s.id !== fromSection.id).map(s => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      </div>
      <div className="modal-actions">
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn primary" onClick={() => void handleCopy()}>
          Copy schedule
        </button>
      </div>
    </Modal>
  );
}
