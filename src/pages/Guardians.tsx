import React, { useState } from 'react';
import { useData } from '../store';
import { api } from '../api';
import { Modal, Segmented } from '../ui';
import { parseCsvTable } from './Sections';

function csvGet(r: Record<string, string>, keys: string[]): string {
  for (const k of keys) if (r[k]) return r[k];
  return '';
}

export default function Guardians(): React.ReactElement {
  const { data, refresh } = useData();
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<'alpha' | 'section'>('alpha');
  if (!data) return <div className="empty">Loading…</div>;

  const sectionName = (id: string | null): string =>
    id ? data.sections.find(s => s.id === id)?.name ?? '' : '';

  const withKids = data.guardians
    .map(g => {
      const kids = data.students
        .filter(s => s.guardianId === g.id)
        .sort((a, b) => `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`));
      return { g, kids };
    });

  const sortedAll = [...withKids].sort((a, b) => {
    if (sort === 'section') {
      const sa = a.kids[0] ? sectionName(a.kids[0].sectionId) : '￿';
      const sb = b.kids[0] ? sectionName(b.kids[0].sectionId) : '￿';
      return sa.localeCompare(sb) || `${a.g.lastName} ${a.g.firstName}`.localeCompare(`${b.g.lastName} ${b.g.firstName}`);
    }
    return `${a.g.lastName} ${a.g.firstName}`.localeCompare(`${b.g.lastName} ${b.g.firstName}`);
  });

  const q = search.trim().toLowerCase();
  const list = sortedAll
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
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn ghost" onClick={() => setImporting(true)}>⬆ Import masterlist</button>
          <button className="btn yellow" onClick={() => setAdding(true)}>＋ Add guardian</button>
        </div>
      </div>

      <div className="card">
        <div className="toolbar" style={{ marginBottom: 14 }}>
          <h3 style={{ margin: 0 }}>
            {list.length} {list.length === 1 ? 'guardian' : 'guardians'}
            <span style={{ fontSize: 13, color: 'var(--muted)', fontWeight: 500 }}> (Total: {data.guardians.length})</span>
          </h3>
          <div className="spacer" />
          <span className="toolbar-label">Sort by</span>
          <Segmented
            options={[
              { id: 'alpha' as const, label: 'Alphabetical' },
              { id: 'section' as const, label: 'Section' }
            ]}
            value={sort}
            onChange={setSort}
          />
          <input
            value={search}
            placeholder="Search guardian, child, number…"
            onChange={e => setSearch(e.target.value)}
            style={{ width: 220, padding: '7px 11px', borderRadius: 8, border: '1px solid var(--line)' }}
          />
        </div>
        <table className="table">
          <thead>
            <tr>
              <th>Name of Parent/Guardian</th>
              <th>Mobile Number</th>
              <th>Email Address</th>
              <th>Children</th>
              <th>Section</th>
            </tr>
          </thead>
          <tbody>
            {list.map(({ g, kids }) => (
              <tr key={g.id}>
                <td><b>{g.lastName}, {g.firstName}</b></td>
                <td>{g.number || <span style={{ color: 'var(--muted)' }}>—</span>}</td>
                <td>{g.email || <span style={{ color: 'var(--muted)' }}>—</span>}</td>
                <td>{kids.length ? kids.map(k => `${k.firstName} ${k.lastName}`).join(', ') : '—'}</td>
                <td>{kids[0] ? sectionName(kids[0].sectionId) || <span style={{ color: 'var(--muted)' }}>—</span> : <span style={{ color: 'var(--muted)' }}>—</span>}</td>
              </tr>
            ))}
            {list.length === 0 && data.guardians.length > 0 && (
              <tr><td colSpan={5} className="empty">No guardians match “{search.trim()}”</td></tr>
            )}
            {data.guardians.length === 0 && <tr><td colSpan={5} className="empty">No guardians yet</td></tr>}
          </tbody>
        </table>
      </div>

      {importing && <ImportGuardiansModal onClose={() => setImporting(false)} />}

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

/** Import a guardian masterlist CSV and link each row's child by name. */
function ImportGuardiansModal({ onClose }: { onClose: () => void }): React.ReactElement {
  const { data, refresh } = useData();
  const [preview, setPreview] = useState<{ name: string; number: string; email: string; child: string }[]>([]);
  const [err, setErr] = useState<string | null>(null);
  if (!data) return <div />;

  const readFile = (file: File | undefined): void => {
    if (!file) return;
    setErr(null);
    const reader = new FileReader();
    reader.onload = () => {
      const rows = parseCsvTable(String(reader.result));
      const parsed = rows.map(r => ({
        name: csvGet(r, ['nameofparentguardian', 'parentguardian', 'guardian', 'parent', 'name']),
        number: csvGet(r, ['mobilenumber', 'mobile', 'contactnumber', 'number', 'phone']),
        email: csvGet(r, ['emailaddress', 'email']),
        child: csvGet(r, ['nameofchild', 'child', 'student', 'studentname'])
      })).filter(r => r.name || r.child);
      if (parsed.length === 0) setErr('No rows found. Expected columns like Name of Parent/Guardian, Mobile Number, Email Address, Name of child.');
      setPreview(parsed);
    };
    reader.readAsText(file);
  };

  const doImport = async (): Promise<void> => {
    const guardians = [...data.guardians];
    const students = [...data.students];
    let linked = 0;
    for (const r of preview) {
      if (!r.name) continue;
      // "Dela Cruz, Maria" -> last=Dela Cruz first=Maria; otherwise "First Last"
      let gLast: string, gFirst: string;
      if (r.name.includes(',')) {
        const [a, b] = r.name.split(',');
        gLast = a.trim(); gFirst = (b || '').trim();
      } else {
        const parts = r.name.trim().split(/\s+/);
        gFirst = parts[0] || '';
        gLast = parts.slice(1).join(' ') || parts[0] || '';
      }
      let g = guardians.find(x =>
        x.firstName.toLowerCase() === gFirst.toLowerCase() &&
        x.lastName.toLowerCase() === gLast.toLowerCase());
      if (!g) {
        g = {
          id: `g_${Date.now().toString(36)}_${guardians.length}`,
          lastName: gLast,
          firstName: gFirst || 'Guardian',
          number: r.number,
          address: '',
          ...(r.email ? { email: r.email } : {})
        };
        guardians.push(g);
      }
      if (r.child) {
        const c = r.child.trim().toLowerCase();
        const kid = students.find(s =>
          `${s.firstName} ${s.lastName}`.toLowerCase() === c ||
          `${s.lastName} ${s.firstName}`.toLowerCase() === c);
        if (kid) {
          kid.guardianId = g.id;
          linked++;
        }
      }
    }
    await api.patchData({ guardians, students });
    window.alert(`Imported ${preview.filter(r => r.name).length} guardians, linked ${linked} child${linked === 1 ? '' : 'ren'} by name.`);
    void refresh();
    onClose();
  };

  return (
    <Modal title="Import guardian masterlist" sub="Pick a CSV file exported from Excel — children are linked by name." onClose={onClose} width={560}>
      <div className="field">
        <label>CSV file</label>
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={e => { readFile(e.target.files?.[0]); e.target.value = ''; }}
        />
        <div className="card-note" style={{ marginTop: 4 }}>
          Accepted columns: Name of Parent/Guardian, Mobile Number, Email Address, Name of child. In Excel choose File → Save As → CSV.
        </div>
      </div>

      {err && <div className="notice error" style={{ marginTop: 10 }}>⚠ {err}</div>}

      {preview.length > 0 && (
        <>
          <div style={{ marginTop: 12, fontWeight: 700 }}>{preview.length} rows found — first 5:</div>
          <table className="table">
            <thead><tr><th>Name of Parent/Guardian</th><th>Mobile Number</th><th>Email Address</th><th>Name of child</th></tr></thead>
            <tbody>
              {preview.slice(0, 5).map((r, i) => (
                <tr key={i}>
                  <td>{r.name || '—'}</td>
                  <td>{r.number || '—'}</td>
                  <td>{r.email || '—'}</td>
                  <td>{r.child || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <div className="modal-actions">
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn primary" disabled={preview.length === 0} onClick={() => void doImport()}>
          Import {preview.length || ''} guardian{preview.length === 1 ? '' : 's'}
        </button>
      </div>
    </Modal>
  );
}
