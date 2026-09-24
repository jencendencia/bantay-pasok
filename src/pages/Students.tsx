import React, { useState } from 'react';
import { useData } from '../store';
import { api } from '../api';
import { Modal, Pill, AvatarIcon, printNodes } from '../ui';
import { IdCard } from '../components/IdCard';
import { StudentFace } from '../components/StudentFace';
import type { Student } from '../shared/types';

export default function Students(): React.ReactElement {
  const { data, refresh } = useData();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Student | null>(null);
  const [filter, setFilter] = useState<'all' | 'M' | 'F'>('all');
  const [sectionFilter, setSectionFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [qrStudent, setQrStudent] = useState<Student | null>(null);

  if (!data) return <div className="empty">Loading…</div>;

  const q = search.trim().toLowerCase();
  const list = [...data.students]
    .filter(s => (filter === 'all' || s.sex === filter) && (sectionFilter === 'all' || s.sectionId === sectionFilter))
    .filter(s =>
      !q ||
      `${s.firstName} ${s.lastName}`.toLowerCase().includes(q) ||
      `${s.lastName} ${s.firstName}`.toLowerCase().includes(q) ||
      (s.qr || '').toLowerCase().includes(q)
    )
    .sort((a, b) => `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`));

  const maleCount = data.students.filter(s => s.sex === 'M').length;
  const femaleCount = data.students.filter(s => s.sex === 'F').length;

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">Students</h1>
          <div className="page-sub">
            Enrol students by male and female · print official QR ID cards
          </div>
        </div>
        <button className="btn yellow" onClick={() => setAdding(true)}>＋ Enrol student</button>
      </div>

      {/* Main Student Directory Card */}
      <div className="card">
        <div className="toolbar" style={{ marginBottom: 14 }}>
          <h3 style={{ margin: 0 }}>
            {list.length} students <span style={{ fontSize: 13, color: 'var(--muted)', fontWeight: 500 }}>(Total: {data.students.length} · Male: {maleCount}, Female: {femaleCount})</span>
          </h3>
          <div className="spacer" />
          <input
            value={search}
            placeholder="Search name or QR…"
            onChange={e => setSearch(e.target.value)}
            style={{ width: 200, padding: '7px 11px', borderRadius: 8, border: '1px solid var(--line)' }}
          />
          <div className="segmented">
            <button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>All</button>
            <button className={filter === 'M' ? 'active' : ''} onClick={() => setFilter('M')}>Male ({maleCount})</button>
            <button className={filter === 'F' ? 'active' : ''} onClick={() => setFilter('F')}>Female ({femaleCount})</button>
          </div>
          <select
            value={sectionFilter}
            onChange={e => setSectionFilter(e.target.value)}
            style={{ padding: '7px 11px', borderRadius: 8, border: '1px solid var(--line)' }}
          >
            <option value="all">All sections</option>
            {data.sections.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          {sectionFilter !== 'all' && (
            <button
              className="btn primary small"
              onClick={() => {
                const sec = data.sections.find(x => x.id === sectionFilter);
                const studs = data.students
                  .filter(s => s.sectionId === sectionFilter)
                  .sort((a, b) => `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`));
                if (!studs.length) { window.alert(`No students in ${sec?.name} yet.`); return; }
                printNodes(studs.map(s => {
                  const sc = data.sections.find(x => x.id === s.sectionId);
                  const sub = sc?.grade ? `${sc.grade} • ${sc.name.split(' • ')[1] || sc.name}` : sc?.name || 'Student';
                  return (
                    <IdCard
                      key={s.id}
                      variant="student"
                      schoolName={data.settings.schoolName}
                      subLabel={`School Year ${data.settings.schoolYear}`}
                      name={`${s.firstName} ${s.lastName}`}
                      sub={sub}
                      sex={s.sex}
                      qr={s.qr}
                      photoData={s.photoData}
                    />
                  );
                }));
              }}
              title="Print ID cards for every student in the selected section"
            >
              🖨 Print section ID cards ({data.students.filter(s => s.sectionId === sectionFilter).length})
            </button>
          )}
        </div>

        <table className="table">
          <thead>
            <tr>
              <th></th>
              <th>Name</th>
              <th>Sex</th>
              <th>Section</th>
              <th>Parent / Guardian number</th>
              <th>QR Code</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {list.map(s => (
              <tr key={s.id}>
                <td style={{ width: 52 }}><StudentFace student={s} size={40} /></td>
                <td><b>{s.lastName}, {s.firstName}</b></td>
                <td><Pill color={s.sex === 'M' ? 'blue' : 'purple'}>{s.sex === 'M' ? 'Male' : 'Female'}</Pill></td>
                <td>{data.sections.find(x => x.id === s.sectionId)?.name ?? '—'}</td>
                <td>{s.number || '—'}</td>
                <td style={{ fontSize: 13, fontWeight: 700, color: 'var(--green-900)' }}>{s.qr}</td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <button
                    className="btn ghost small"
                    onClick={() => setEditing(s)}
                    title="Edit student details"
                  >
                    ✎
                  </button>{' '}
                  <button
                    className="btn ghost small"
                    onClick={() => setQrStudent(s)}
                    title="Print ID card"
                  >
                    ID Card
                  </button>{' '}
                  <button
                    className="btn ghost small"
                    onClick={async () => {
                      if (!window.confirm(`Delete ${s.firstName} ${s.lastName} from the student list? Their attendance history will remain but the ID card will stop working.`)) return;
                      await api.patchData({ students: data.students.filter(x => x.id !== s.id) });
                      void refresh();
                    }}
                    title="Delete student"
                  >
                    🗑
                  </button>
                </td>
              </tr>
            ))}
            {list.length === 0 && (
              <tr><td colSpan={7} className="empty">No students found matching filters</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* QR ID Cards Grid */}
      <div className="card" style={{ marginTop: 18 }}>
        <div className="toolbar" style={{ marginBottom: 12 }}>
          <h3 style={{ margin: 0 }}>Student ID Cards</h3>
          <div className="spacer" />
          <span className="toolbar-label">Click any card to print</span>
        </div>
        <div className="qr-grid">
          {list.slice(0, 48).map(s => (
            <div key={s.id} className="qr-card clickable" onClick={() => setQrStudent(s)}>
              <div style={{ display: 'grid', placeItems: 'center', height: 110 }}>
                <StudentFace student={s} size={84} />
              </div>
              <div className="qc-name">{s.firstName} {s.lastName}</div>
              <div className="qc-sub">{data.sections.find(x => x.id === s.sectionId)?.name ?? 'No section'}</div>
              <div style={{ fontSize: 11.5, color: '#6a7d73', marginTop: 2, fontWeight: 700 }}>{s.qr}</div>
            </div>
          ))}
        </div>
      </div>

      {adding && <StudentFormModal onClose={() => setAdding(false)} />}
      {editing && <StudentFormModal existing={editing} onClose={() => setEditing(null)} />}
      {qrStudent && <PrintStudentIdModal student={qrStudent} onClose={() => setQrStudent(null)} />}
    </div>
  );
}

/**
 * Shared add/edit student modal. Pass `existing` to edit a student;
 * omit it to enrol a new one (QR is generated automatically).
 */
function StudentFormModal({ existing, onClose }: { existing?: Student; onClose: () => void }): React.ReactElement {
  const { data, refresh } = useData();
  const [form, setForm] = useState({
    lastName: existing?.lastName ?? '',
    firstName: existing?.firstName ?? '',
    middleName: existing?.middleName ?? '',
    sex: existing?.sex ?? ('M' as 'M' | 'F'),
    number: existing?.number ?? '',
    sectionId: existing?.sectionId ?? data?.sections[0]?.id ?? '',
    guardianId: existing?.guardianId ?? ''
  });
  const [photo, setPhoto] = useState<string | null>(existing?.photoData ?? null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [regenQr, setRegenQr] = useState(false);
  const isEdit = !!existing;
  if (!data) return <div />;

  const guardians = [...data.guardians].sort((a, b) => `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`));

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

  const nextQr = (): string => {
    let n = data.students.length + 420;
    let candidate: string;
    do { candidate = `S-2026-${String(n++).padStart(5, '0')}`; }
    while (data.students.some(s => s.qr === candidate) && n < 100000);
    return candidate;
  };

  const save = async (): Promise<void> => {
    if (isEdit && existing) {
      const qr = regenQr ? nextQr() : existing.qr;
      const updated: Student = {
        ...existing,
        lastName: form.lastName,
        firstName: form.firstName,
        middleName: form.middleName,
        sex: form.sex,
        number: form.number,
        sectionId: form.sectionId,
        guardianId: form.guardianId || null,
        ...(photo ? { photoData: photo } : { photoData: undefined })
      };
      await api.patchData({ students: data.students.map(s => (s.id === existing.id ? { ...updated, qr } : s)) });
    } else {
      const st: Student = {
        id: `s_${Date.now().toString(36)}`,
        qr: nextQr(),
        lastName: form.lastName,
        firstName: form.firstName,
        middleName: form.middleName,
        sex: form.sex,
        number: form.number,
        sectionId: form.sectionId,
        guardianId: form.guardianId || null,
        ...(photo ? { photoData: photo } : {})
      };
      await api.patchData({ students: [...data.students, st] });
    }
    void refresh();
    onClose();
  };

  return (
    <Modal title={isEdit ? `Edit ${existing!.firstName} ${existing!.lastName}` : 'Enrol a student'} onClose={onClose} width={540}>
      <div className="form-row" style={{ alignItems: 'flex-start' }}>
        <div className="field" style={{ maxWidth: 150 }}>
          <label>Student picture</label>
          <div
            style={{
              width: 120, height: 120, borderRadius: '50%', border: '3px solid var(--yellow)',
              overflow: 'hidden', background: 'var(--green-50)', display: 'grid', placeItems: 'center', cursor: 'pointer'
            }}
            title="Choose a picture"
            onClick={() => document.getElementById('student-photo-input')?.click()}
          >
            {photo
              ? <img src={photo} alt="Student" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              : <AvatarIcon role="student" sex={form.sex} size={110} />}
          </div>
          <input
            id="student-photo-input"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            style={{ display: 'none' }}
            onChange={e => { pickPhoto(e.target.files?.[0]); e.target.value = ''; }}
          />
          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
            <button type="button" className="btn ghost small" disabled={photoBusy} onClick={() => document.getElementById('student-photo-input')?.click()}>
              {photoBusy ? 'Reading…' : 'Choose file'}
            </button>
            {photo && <button type="button" className="btn ghost small" onClick={() => setPhoto(null)}>Remove</button>}
          </div>
          <div className="card-note" style={{ fontSize: 11.5 }}>Optional — JPEG/PNG. Shows on the ID card.</div>
        </div>
        <div style={{ flex: 1 }}>
          <div className="field">
            <label>Sex</label>
            <div className="segmented">
              <button
                type="button"
                className={form.sex === 'M' ? 'active' : ''}
                onClick={() => setForm({ ...form, sex: 'M' })}
              >
                Male
              </button>
              <button
                type="button"
                className={form.sex === 'F' ? 'active' : ''}
                onClick={() => setForm({ ...form, sex: 'F' })}
              >
                Female
              </button>
            </div>
          </div>

          <div className="form-row">
            <div className="field">
              <label>Last name</label>
              <input
                value={form.lastName}
                placeholder="Dela Cruz"
                onChange={e => setForm({ ...form, lastName: e.target.value })}
              />
            </div>
            <div className="field">
              <label>First name and M.I.</label>
              <input
                value={form.firstName}
                placeholder="Juan Miguel"
                onChange={e => setForm({ ...form, firstName: e.target.value })}
              />
            </div>
          </div>

          <div className="field">
            <label>Section</label>
            <select value={form.sectionId} onChange={e => setForm({ ...form, sectionId: e.target.value })}>
              {data.sections.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
        </div>
      </div>

      <div className="form-row">
        <div className="field">
          <label>Guardian mobile number (fallback for SMS)</label>
          <input
            value={form.number}
            placeholder="+63 917 000 0000"
            onChange={e => setForm({ ...form, number: e.target.value })}
          />
        </div>
        <div className="field">
          <label>Linked guardian (parent record)</label>
          <select value={form.guardianId ?? ''} onChange={e => setForm({ ...form, guardianId: e.target.value })}>
            <option value="">— No guardian linked —</option>
            {guardians.map(g => (
              <option key={g.id} value={g.id}>{g.lastName}, {g.firstName}{g.number ? ` · ${g.number}` : ''}</option>
            ))}
          </select>
        </div>
      </div>

      {isEdit && (
        <label style={{ display: 'flex', gap: 10, alignItems: 'center', fontWeight: 600, fontSize: 14, marginTop: 4 }}>
          <input type="checkbox" checked={regenQr} onChange={e => setRegenQr(e.target.checked)} />
          Regenerate QR code (old ID card stops working)
        </label>
      )}

      <div className="modal-actions">
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button
          className="btn yellow"
          disabled={!form.lastName || !form.firstName}
          onClick={() => void save()}
        >
          {isEdit ? 'Save changes' : 'Enrol and create QR'}
        </button>
      </div>
    </Modal>
  );
}

// Student ID Card Modal matching 05_id_cards_qr.png
function PrintStudentIdModal({ student, onClose }: { student: Student; onClose: () => void }): React.ReactElement {
  const { data } = useData();
  if (!data) return <div />;
  const sec = data.sections.find(s => s.id === student.sectionId);
  const sub = sec?.grade ? `${sec.grade} • ${sec.name.split(' • ')[1] || sec.name}` : sec?.name || 'Student';

  const printCard = (): void => {
    printNodes(
      <IdCard
        variant="student"
        schoolName={data.settings.schoolName}
        subLabel={`School Year ${data.settings.schoolYear}`}
        name={`${student.firstName} ${student.lastName}`}
        sub={sub}
        sex={student.sex}
        qr={student.qr}
        photoData={student.photoData}
      />
    );
  };

  return (
    <Modal title="Student ID card" onClose={onClose} width={420}>
      <div style={{ display: 'grid', placeItems: 'center', padding: '10px 0' }}>
        <IdCard
          variant="student"
          schoolName={data.settings.schoolName}
          subLabel={`School Year ${data.settings.schoolYear}`}
          name={`${student.firstName} ${student.lastName}`}
          sub={sub}
          sex={student.sex}
          qr={student.qr}
          photoData={student.photoData}
        />
      </div>

      <div className="modal-actions">
        <button className="btn ghost" onClick={onClose}>Close</button>
        <button className="btn primary" onClick={printCard}>
          Print ID Card
        </button>
      </div>
    </Modal>
  );
}
