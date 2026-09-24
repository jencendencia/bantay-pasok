import React, { useMemo, useState } from 'react';
import { useData } from '../store';
import { api } from '../api';
import { Modal, Pill } from '../ui';
import { SUBJECTS, DEPARTMENTS, fmt12 } from '../shared/constants';
import type { Slot } from '../shared/types';

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

/** Accepts "8:33", "08:33", "833", "8.33", "3:33 pm" and normalizes to "08:33". */
export function normalizeTimeInput(raw: string): string | null {
  const s = raw.trim().toLowerCase().replace(/\s*(am|pm)\s*$/, (_m, ap: string) => (ap === 'pm' ? ' pm' : ' am'));
  const isPm = s.endsWith(' pm');
  const isAm = s.endsWith(' am');
  const body = s.replace(/\s*(am|pm)\s*$/, '').replace(/[^0-9:]/g, '');
  let h = -1, m = -1;
  if (body.includes(':')) {
    const [a, b] = body.split(':');
    h = parseInt(a, 10); m = parseInt(b || '0', 10);
  } else if (/^\d{3,4}$/.test(body)) {
    h = parseInt(body.slice(0, body.length - 2), 10); m = parseInt(body.slice(-2), 10);
  } else if (/^\d{1,2}$/.test(body)) {
    h = parseInt(body, 10); m = 0;
  } else {
    return null;
  }
  if (!Number.isFinite(h) || !Number.isFinite(m) || h < 0 || h > 23 || m < 0 || m > 59) return null;
  if (isPm && h < 12) h += 12;
  if (isAm && h === 12) h = 0;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Text input for class times that still shows a dropdown of common times. */
function TimeField({ value, onChange, label, idPrefix }: {
  value: string;
  onChange: (t: string) => void;
  label: string;
  idPrefix: string;
}): React.ReactElement {
  const [draft, setDraft] = useState<string>(value);
  const [bad, setBad] = useState(false);
  React.useEffect(() => { setDraft(value); }, [value]);
  const commit = (raw: string): void => {
    const t = normalizeTimeInput(raw);
    if (t) { setBad(false); onChange(t); } else { setBad(true); }
  };
  const list = `${idPrefix}-time-list`;
  return (
    <div className="field">
      <label>{label}</label>
      <input
        list={list}
        value={draft}
        placeholder="e.g. 8:33"
        style={bad ? { borderColor: 'var(--red)' } : undefined}
        onChange={e => setDraft(e.target.value)}
        onBlur={e => commit(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commit((e.target as HTMLInputElement).value); } }}
      />
      <datalist id={list}>
        {timeOptions().map(t => <option key={t} value={t}>{fmt12(t)}</option>) }
      </datalist>
      {bad && <div style={{ color: 'var(--red)', fontSize: 12, marginTop: 4 }}>Use a time like 8:33</div>}
    </div>
  );
}

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
  const [depManageOpen, setDepManageOpen] = useState(false);

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
    subject: 'T.L.E.',
    departmentId: 'T.L.E.',
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

    // The department field holds a name: resolve it, enrolling a new department on first use.
    const depName = form.departmentId.trim() || 'General';
    let departmentId = data.departments.find(d => d.name.toLowerCase() === depName.toLowerCase())?.id;
    let departments = data.departments;
    if (!departmentId) {
      const base = depName.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || Date.now().toString(36);
      departmentId = `dep_${base}`;
      while (departments.some(d => d.id === departmentId)) departmentId = `${departmentId}_2`;
      departments = [...departments, { id: departmentId, name: depName }];
    }

    const newSlot: Slot = {
      id: `slot_${Date.now().toString(36)}`,
      sectionId: sec.id,
      subject: form.subject,
      departmentId,
      teacherId: teacherAssignedId,
      start: form.start,
      end: form.end,
      days: form.days
    };

    await api.patchData({ departments, slots: [...data.slots, newSlot] });
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
            <TimeField label="Start" value={form.start} onChange={t => setForm({ ...form, start: t })} idPrefix="slot-start" />
            <TimeField label="End" value={form.end} onChange={t => setForm({ ...form, end: t })} idPrefix="slot-end" />
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
            <label>Subject</label>
            <input
              list="subject-options"
              value={form.subject}
              placeholder="e.g. English or Filipino"
              onChange={e => {
                const sub = SUBJECTS.find(s => s.name.toLowerCase() === e.target.value.trim().toLowerCase());
                setForm({
                  ...form,
                  subject: e.target.value,
                  ...(sub ? { departmentId: DEPARTMENTS.find(d => d.id === sub.dept)?.name ?? sub.dept } : {})
                });
              }}
            />
            <datalist id="subject-options">
              {SUBJECTS.map(s => <option key={s.name} value={s.name} />)}
            </datalist>
            <div className="card-note" style={{ marginTop: 4 }}>
              Type any subject — nothing is predefined. Common ones: English, Mathematics, Science, T.L.E.
            </div>
          </div>

          <div className="field">
            <label>Department</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                list="department-options"
                style={{ flex: 1 }}
                value={form.departmentId}
                placeholder="e.g. Mathematics"
                onChange={e => setForm({ ...form, departmentId: e.target.value })}
              />
              <button
                type="button"
                className="btn ghost small"
                title="Rename, add or remove departments"
                onClick={() => setDepManageOpen(true)}
              >
                ⚙ Manage
              </button>
            </div>
            <datalist id="department-options">
              {[...new Set([...data.departments.map(d => d.name), ...DEPARTMENTS.map(d => d.name)])].sort().map(n => (
                <option key={n} value={n} />
              ))}
            </datalist>
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

      {/* Manage departments (rename / add / remove) */}
      {depManageOpen && <ManageDepartmentsModal onClose={() => setDepManageOpen(false)} />}
    </div>
  );
}

function ManageDepartmentsModal({ onClose }: { onClose: () => void }): React.ReactElement {
  const { data, refresh } = useData();
  const [newName, setNewName] = useState('');
  if (!data) return <div />;

  const usedBy = (depId: string): number => data.slots.filter(s => s.departmentId === depId).length;
  const setRenaming = async (id: string, name: string): Promise<void> => {
    const departments = data.departments.map(d => (d.id === id ? { ...d, name } : d));
    await api.patchData({ departments });
    void refresh();
  };

  return (
    <Modal title="Manage departments" sub="Rename, add or remove the departments subjects belong to." onClose={onClose} width={480}>
      <table className="table">
        <thead><tr><th>Department</th><th className="num">Used in slots</th><th></th></tr></thead>
        <tbody>
          {data.departments.map(d => (
            <tr key={d.id}>
              <td>
                <input
                  value={d.name}
                  onChange={e => void setRenaming(d.id, e.target.value)}
                  style={{ width: '100%' }}
                />
              </td>
              <td className="num">{usedBy(d.id)}</td>
              <td style={{ textAlign: 'right' }}>
                <button
                  className="btn ghost small"
                  title={usedBy(d.id) ? 'Cannot remove: slots still use this department' : 'Remove department'}
                  disabled={usedBy(d.id) > 0}
                  onClick={async () => {
                    await api.patchData({ departments: data.departments.filter(x => x.id !== d.id) });
                    void refresh();
                  }}
                >
                  🗑
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="field" style={{ marginTop: 12 }}>
        <label>Add a department</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            style={{ flex: 1 }}
            value={newName}
            placeholder="e.g. Mathematics, English, T.L.E."
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') e.preventDefault(); }}
          />
          <button
            className="btn primary small"
            disabled={!newName.trim() || data.departments.some(d => d.name.toLowerCase() === newName.trim().toLowerCase())}
            onClick={async () => {
              const name = newName.trim();
              const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || Date.now().toString(36);
              let id = `dep_${base}`;
              while (data.departments.some(d => d.id === id)) id = `${id}_2`;
              await api.patchData({ departments: [...data.departments, { id, name }] });
              setNewName('');
              void refresh();
            }}
          >
            Add
          </button>
        </div>
      </div>
    </Modal>
  );
}

function EditSlotModal({ slot, onClose }: { slot: Slot; onClose: () => void }): React.ReactElement {
  const { data, refresh } = useData();
  const [form, setForm] = useState({
    subject: slot.subject,
    departmentName: data?.departments.find(d => d.id === slot.departmentId)?.name ?? slot.departmentId,
    teacherId: slot.teacherId,
    start: slot.start,
    end: slot.end,
    days: slot.days
  });
  if (!data) return <div />;

  return (
    <Modal title="Edit class slot" onClose={onClose} width={500}>
      <div className="form-row">
        <TimeField label="Start" value={form.start} onChange={t => setForm({ ...form, start: t })} idPrefix="edit-start" />
        <TimeField label="End" value={form.end} onChange={t => setForm({ ...form, end: t })} idPrefix="edit-end" />
      </div>
      <div className="field">
        <label>Subject</label>
        <input
          list="edit-subject-options"
          value={form.subject}
          onChange={e => setForm({ ...form, subject: e.target.value })}
        />
        <datalist id="edit-subject-options">
          {SUBJECTS.map(s => <option key={s.name} value={s.name} />)}
        </datalist>
      </div>
      <div className="field">
        <label>Department</label>
        <input
          list="edit-department-options"
          value={form.departmentName}
          onChange={e => setForm({ ...form, departmentName: e.target.value })}
        />
        <datalist id="edit-department-options">
          {[...new Set([...data.departments.map(d => d.name), ...DEPARTMENTS.map(d => d.name)])].sort().map(n => (
            <option key={n} value={n} />
          ))}
        </datalist>
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
            // Resolve the department name to an id, enrolling it on first use.
            const depName = form.departmentName.trim() || 'General';
            let departmentId = data.departments.find(d => d.name.toLowerCase() === depName.toLowerCase())?.id;
            let departments = data.departments;
            if (!departmentId) {
              const base = depName.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || Date.now().toString(36);
              departmentId = `dep_${base}`;
              while (departments.some(d => d.id === departmentId)) departmentId = `${departmentId}_2`;
              departments = [...departments, { id: departmentId, name: depName }];
            }
            const { departmentName, ...rest } = form;
            const next = data.slots.map(s => s.id === slot.id ? { ...s, ...rest, departmentId } : s);
            await api.patchData({ departments, slots: next });
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
