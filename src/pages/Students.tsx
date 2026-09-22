import React, { useState } from 'react';
import { useData } from '../store';
import { api } from '../api';
import { Modal, Pill, AvatarIcon, printNodes } from '../ui';
import { QrImg } from './Teachers';
import { IdCard } from '../components/IdCard';
import type { Student } from '../shared/types';

export default function Students(): React.ReactElement {
  const { data, refresh } = useData();
  const [adding, setAdding] = useState(false);
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
        </div>

        <table className="table">
          <thead>
            <tr>
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
                <td><b>{s.lastName}, {s.firstName}</b></td>
                <td><Pill color={s.sex === 'M' ? 'blue' : 'purple'}>{s.sex === 'M' ? 'Male' : 'Female'}</Pill></td>
                <td>{data.sections.find(x => x.id === s.sectionId)?.name ?? '—'}</td>
                <td>{s.number || '—'}</td>
                <td style={{ fontSize: 13, fontWeight: 700, color: 'var(--green-900)' }}>{s.qr}</td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
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
              <tr><td colSpan={6} className="empty">No students found matching filters</td></tr>
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
              <QrImg value={s.qr} size={110} />
              <div className="qc-name">{s.firstName} {s.lastName}</div>
              <div className="qc-sub">{data.sections.find(x => x.id === s.sectionId)?.name ?? 'No section'}</div>
              <div style={{ fontSize: 11.5, color: '#6a7d73', marginTop: 2, fontWeight: 700 }}>{s.qr}</div>
            </div>
          ))}
        </div>
      </div>

      {adding && <EnrollStudentModal onClose={() => setAdding(false)} />}
      {qrStudent && <PrintStudentIdModal student={qrStudent} onClose={() => setQrStudent(null)} />}
    </div>
  );
}

function EnrollStudentModal({ onClose }: { onClose: () => void }): React.ReactElement {
  const { data, refresh } = useData();
  const [form, setForm] = useState({
    lastName: '',
    firstName: '',
    middleName: '',
    sex: 'M' as 'M' | 'F',
    sectionId: data?.sections[0]?.id ?? ''
  });
  if (!data) return <div />;

  return (
    <Modal title="Enrol a student" onClose={onClose} width={520}>
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

      <div className="modal-actions">
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button
          className="btn yellow"
          disabled={!form.lastName || !form.firstName}
          onClick={async () => {
            const st: Student = {
              id: `s_${Date.now().toString(36)}`,
              qr: `S-2026-${String(data.students.length + 420).padStart(5, '0')}`,
              lastName: form.lastName,
              firstName: form.firstName,
              middleName: form.middleName,
              sex: form.sex,
              number: '',
              sectionId: form.sectionId,
              guardianId: null
            };
            await api.patchData({ students: [...data.students, st] });
            void refresh();
            onClose();
          }}
        >
          Enrol and create QR
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
