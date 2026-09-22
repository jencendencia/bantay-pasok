import React, { useMemo } from 'react';
import { DataProvider, useData, useHashRoute } from './store';
import { api } from './api';
import { TitleBar } from './ui';
import Dashboard from './pages/Dashboard';
import StandbyTab from './pages/StandbyTab';
import ClassProgram from './pages/ClassProgram';
import Sections from './pages/Sections';
import Teachers from './pages/Teachers';
import Reports from './pages/Reports';
import Students from './pages/Students';
import Guardians from './pages/Guardians';
import SettingsPage from './pages/SettingsPage';

const PAGES = [
  { id: 'dashboard', label: 'Dashboard', icon: '▦' },
  { id: 'standby', label: 'Standby Screen', icon: '▶' },
  { id: 'classprog', label: 'Class Program', icon: '▤' },
  { id: 'sections', label: 'Sections', icon: '⚙' },
  { id: 'teachers', label: 'Teachers', icon: '✎' },
  { id: 'reports', label: 'Reports', icon: '⎘' },
  { id: 'students', label: 'Students', icon: '☰' },
  { id: 'guardians', label: 'Guardian', icon: '☎' },
  { id: 'settings', label: 'Settings', icon: '✲' }
];

function Shell(): React.ReactElement {
  const { data, now } = useData();
  const [route, nav] = useHashRoute();

  const smsPending = useMemo(
    () => (data ? data.sms.filter(m => m.status === 'retrying' || m.status === 'failed').length : 0),
    [data]
  );

  const page = (() => {
    switch (route) {
      case 'standby': return <StandbyTab />;
      case 'classprog': return <ClassProgram />;
      case 'sections': return <Sections />;
      case 'teachers': return <Teachers />;
      case 'reports': return <Reports />;
      case 'students': return <Students />;
      case 'guardians': return <Guardians />;
      case 'settings': return <SettingsPage />;
      default: return <Dashboard />;
    }
  })();

  return (
    <div style={{ height: '100vh', position: 'relative', overflow: 'hidden' }}>
      <TitleBar title={data ? data.settings.schoolName : 'Bantay Pasok'} theme="light" target="admin" />
      <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-badge">✓</div>
          <div>
            <div className="brand-title">Bantay<br />Pasok</div>
            <div className="brand-sub">Attendance and class monitor</div>
          </div>
        </div>
        <nav className="nav">
          {PAGES.map(p => (
            <button key={p.id} className={route === p.id ? 'active' : ''} onClick={() => nav(p.id)}>
              <span>{p.icon}</span> {p.label}
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div className="status-row"><span className="dot" /> QR scanner online</div>
          <div className="status-row">
            <span className={`dot ${data?.settings.gsmSimulated ? 'warn' : ''}`} />
            GSM modem {data?.settings.gsmSimulated ? '· simulated' : data?.settings.gsmPort ? `· ${data.settings.gsmPort}` : '· not set'}
          </div>
          <div className="status-row">
            {smsPending > 0
              ? <><span className="dot warn" /> {smsPending} SMS waiting to retry</>
              : <><span className="dot" /> SMS queue clear</>}
          </div>
          <div className="school-name">{data?.settings.schoolName}</div>
        </div>
      </aside>
      <main className="main">
        <div className="page">
          <div className="page-head">
            <div>{/* title rendered by pages */}</div>
            <div className="clock">
              <div className="clock-time">{now.toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' })}</div>
              <div className="clock-date">
                {now.toLocaleDateString('en-PH', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
              </div>
            </div>
          </div>
          {page}
        </div>
      </main>
      </div>
    </div>
  );
}

export default function App(): React.ReactElement {
  return (
    <DataProvider>
      <Shell />
    </DataProvider>
  );
}
