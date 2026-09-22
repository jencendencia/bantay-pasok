import React, { useState } from 'react';
import { useData } from '../store';
import { api } from '../api';
import { Modal } from '../ui';

export default function Guardians(): React.ReactElement {
  const { data, refresh } = useData();
  const [adding, setAdding] = useState(false);
  const [search, setSearch] = useState('');
  if (!data) return <div className="empty">Loading…</div>;

  const q = search.trim().toLowerCase();
  const list = data.guardians
    .map(g => {
      const kids = data.students.filter(s => s.guardianId === g.id);
      return { g, kids };
    })
    .filter(({ g, kids }) =>
      !q ||
      `${g.firstName} ${g.lastName}`.toLowerCase().includes(q) ||
      `${g.lastName} ${g.firstName}`.toLowerCase().includes(q) ||
      (g.number || '').toLowerCase().includes(q) ||
      (g.email || '').toLowerCase().includes(q) ||
      (g.address || '').toLowerCase().includes(q) ||
      kids.some(k => `${k.firstName} ${k.lastName}`.toLowerCase().includes(q))
    );

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">Guardians</h1>
          <div className="page-sub">Enrol guardians who receive the SMS notifications</div>
        </div>
        <button className="btn yellow" onClick={() => setAdding(true)}>＋ Add guardian</button>
      </div>

      <div className="card">
        <div className="toolbar" style={{ marginBottom: 14 }}>
          <h3 style={{ margin: 0 }}>
            {list.length} {list.length === 1 ? 'guardian' : 'guardians'}
            <span style={{ fontSize: 13, color: 'var(--muted)', fontWeight: 500 }}> (Total: {data.guardians.length})</span>
          </h3>
          <div className="spacer" />
          <input
            value={search}
            placeholder="Search guardian, child, number…"
            onChange={e => setSearch(e.target.value)}
            style={{ width: 240, padding: '7px 11px', borderRadius: 8, border: '1px solid var(--line)' }}
          />
        </div>
        <table className="table">
          <thead><tr><th>Name</th><th>Mobile number</th><th>Email</th><th>Address</th><th>Children</th></tr></thead>
          <tbody>
            {list.map(({ g, kids }) => (
              <tr key={g.id}>
                <td><b>{g.lastName}, {g.firstName}</b></td>
                <td>{g.number}</td>
                <td>{g.email || <span style={{ color: 'var(--muted)' }}>—</span>}</td>
                <td>{g.address}</td>
                <td>{kids.length ? kids.map(k => `${k.firstName} ${k.lastName}`).join(', ') : '—'}</td>
              </tr>
            ))}
            {list.length === 0 && data.guardians.length > 0 && (
              <tr><td colSpan={5} className="empty">No guardians match “{search.trim()}”</td></tr>
            )}
            {data.guardians.length === 0 && <tr><td colSpan={5} className="empty">No guardians yet</td></tr>}
          </tbody>
        </table>
      </div>

      {adding && (
        <Modal title="Add a guardian" onClose={() => setAdding(false)} width={500}>
          <GuardianForm
            students={data.students}
            sections={data.sections}
            onDone={async (g, childIds) => {
              const students = data.students.map(s => childIds.includes(s.id) ? { ...s, guardianId: g.id } : s);
              await api.patchData({ guardians: [...data.guardians, g], students });
              void refresh();
              setAdding(false);
            }}
          />
        </Modal>
      )}
    </div>
  );
}

function GuardianForm({
  onDone,
  students,
  sections
}: {
  onDone: (g: { id: string; lastName: string; firstName: string; number: string; address: string; email?: string }, childIds: string[]) => void;
  students: { id: string; qr: string; lastName: string; firstName: string; sex: string; sectionId: string | null }[];
  sections: { id: string; name: string }[];
}): React.ReactElement {
  const [f, setF] = useState({ lastName: '', firstName: '', number: '', address: '', email: '' });
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<{ id: string; label: string }[]>([]);

  const matches = query.trim().length >= 1
    ? students
        .filter(s => !picked.some(p => p.id === s.id))
        .filter(s => `${s.firstName} ${s.lastName}`.toLowerCase().includes(query.trim().toLowerCase()))
        .slice(0, 6)
    : [];

  const add = (s: typeof students[number]): void => {
    setPicked(p => [...p, { id: s.id, label: `${s.firstName} ${s.lastName}` }]);
    setQuery('');
  };

  return (
    <>
      <div className="form-row">
        <div className="field"><label>First name</label><input value={f.firstName} onChange={e => setF({ ...f, firstName: e.target.value })} /></div>
        <div className="field"><label>Last name</label><input value={f.lastName} onChange={e => setF({ ...f, lastName: e.target.value })} /></div>
      </div>
      <div className="field"><label>Mobile number <span style={{ color: 'var(--muted)', fontWeight: 400 }}>(optional – for SMS alerts)</span></label><input value={f.number} placeholder="+63 917 555 0142" onChange={e => setF({ ...f, number: e.target.value })} /></div>
      <div className="field"><label>Address</label><input value={f.address} onChange={e => setF({ ...f, address: e.target.value })} /></div>
      <div className="field">
        <label>Email address <span style={{ color: 'var(--muted)', fontWeight: 400 }}>(optional – receives arrival and departure notices)</span></label>
        <input type="email" value={f.email} placeholder="parent@gmail.com" onChange={e => setF({ ...f, email: e.target.value })} />
      </div>

      <div className="field">
        <label>Children (search by name, add as many as needed)</label>
        <input
          value={query}
          placeholder="Type a student's name…"
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && matches.length > 0) { e.preventDefault(); add(matches[0]); }
          }}
        />
        {matches.length > 0 && (
          <div className="child-search-results">
            {matches.map(s => (
              <button type="button" key={s.id} className="child-search-item" onClick={() => add(s)}>
                <b>{s.lastName}, {s.firstName}</b>
                <span>{sections.find(x => x.id === s.sectionId)?.name ?? 'No section'} · {s.qr}</span>
              </button>
            ))}
          </div>
        )}
        {picked.length > 0 && (
          <div className="picked-children">
            {picked.map(p => (
              <span key={p.id} className="pill blue" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
                {p.label}
                <button
                  type="button"
                  onClick={() => setPicked(list => list.filter(x => x.id !== p.id))}
                  style={{ border: 'none', background: 'none', cursor: 'pointer', padding: 0, fontWeight: 700 }}
                  title="Remove"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="modal-actions">
        <button className="btn primary" disabled={!f.lastName || !f.firstName}
          onClick={() => onDone({ id: `g_${Date.now().toString(36)}`, ...f }, picked.map(p => p.id))}>Save guardian</button>
      </div>
    </>
  );
}
