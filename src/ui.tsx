import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { api } from './api';

/**
 * Prints the given React nodes as the ONLY content on the page.
 * Mounts them into the hidden #print-root, prints, then cleans up.
 */
export function printNodes(nodes: React.ReactNode): void {
  const rootEl = document.getElementById('print-root');
  if (!rootEl) { window.print(); return; }
  const holder = document.createElement('div');
  rootEl.appendChild(holder);
  const r = createRoot(holder);
  r.render(nodes);
  // Give React a tick to render (QR images load async and refine when ready).
  setTimeout(() => {
    window.print();
    setTimeout(() => {
      r.unmount();
      holder.remove();
    }, 100);
  }, 300);
}

/**
 * Frameless-window title bar with our own window controls.
 * Purely visual in a plain browser (buttons are hidden there).
 */
export function TitleBar({ title, theme = 'light', target }: { title: string; theme?: 'light' | 'dark'; target?: 'admin' | 'scanner' }): React.ReactElement {
  const [maximized, setMaximized] = useState(false);
  const [inElectron, setInElectron] = useState(false);

  useEffect(() => {
    setInElectron(typeof window !== 'undefined' && !!window.api?.winClose);
    const off = window.api?.onWinState?.((s: { maximized: boolean }) => setMaximized(s.maximized));
    return () => { off?.(); };
  }, []);

  const cls = theme === 'dark' ? 'titlebar dark' : 'titlebar';
  return (
    <div className={cls} style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}>
      <div className="titlebar-title">{title}</div>
      {inElectron && (
        <div className="titlebar-controls" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <button className="tb-btn" title="Minimize" onClick={() => void api.winMinimize()}>
            <svg width="10" height="10" viewBox="0 0 10 10"><path d="M0 5h10" stroke="currentColor" strokeWidth="1.2" /></svg>
          </button>
          <button
            className="tb-btn"
            title={maximized ? 'Restore' : 'Maximize'}
            onClick={() => void api.winMaximize(target)}
          >
            <svg width="10" height="10" viewBox="0 0 10 10">
              {maximized
                ? <><rect x="0.5" y="2.5" width="7" height="7" fill="none" stroke="currentColor" strokeWidth="1.2" /><path d="M2.5 2.5v-2h7v7h-2" fill="none" stroke="currentColor" strokeWidth="1.2" /></>
                : <rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="1.2" />}
            </svg>
            </button>
          <button className="tb-btn tb-close" title="Close" onClick={() => void api.winClose(target)}>
            <svg width="10" height="10" viewBox="0 0 10 10"><path d="M0 0l10 10M10 0L0 10" stroke="currentColor" strokeWidth="1.2" /></svg>
          </button>
        </div>
      )}
    </div>
  );
}

export function Modal({ title, sub, onClose, children, width }: {
  title: string; sub?: string; onClose: () => void; children: React.ReactNode; width?: number;
}): React.ReactElement {
  return (
    <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" style={width ? { width: `min(${width}px, 92vw)` } : undefined}>
        <h2>{title}</h2>
        {sub && <div className="modal-sub">{sub}</div>}
        {children}
      </div>
    </div>
  );
}

export function Pill({ color, children }: { color: string; children: React.ReactNode }): React.ReactElement {
  return <span className={`pill ${color}`}>{children}</span>;
}

export function Segmented<T extends string>({ options, value, onChange }: {
  options: { id: T; label: string }[]; value: T; onChange: (v: T) => void;
}): React.ReactElement {
  return (
    <div className="segmented">
      {options.map(o => (
        <button key={o.id} className={value === o.id ? 'active' : ''} onClick={() => onChange(o.id)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Notice({ kind = 'info', children }: { kind?: 'info' | 'warn' | 'error'; children: React.ReactNode }): React.ReactElement {
  return <div className={`notice ${kind === 'info' ? 'info' : kind === 'error' ? 'error' : ''}`}>{children}</div>;
}

export function EmptyState({ text }: { text: string }): React.ReactElement {
  return <div className="empty">{text}</div>;
}

export function WavyFlourish(): React.ReactElement {
  return (
    <svg className="wavy-underline" width="380" height="18" viewBox="0 0 380 18" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M4 9C60 1 120 17 190 9C260 1 320 17 376 9" stroke="#F3C74C" strokeWidth="4" strokeLinecap="round" />
    </svg>
  );
}

export function AvatarIcon({
  role = 'student',
  sex = 'M',
  size = 120
}: {
  role?: 'teacher' | 'student';
  sex?: 'M' | 'F';
  size?: number;
}): React.ReactElement {
  const isTeacher = role === 'teacher';
  const isFemale = sex === 'F' || isTeacher;

  return (
    <svg width={size} height={size} viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Background circle */}
      <circle cx="60" cy="60" r="56" fill={isTeacher ? '#faf0d2' : '#e2f0ea'} />
      {/* Neck */}
      <rect x="52" y="74" width="16" height="18" fill="#d29671" />
      {/* Shirt */}
      <path d="M22 116 C22 92 40 86 60 86 C80 86 98 92 98 116 Z" fill="#ffffff" />
      <polygon points="60,86 52,98 68,98" fill="#0e3a2f" />
      {/* Head */}
      <circle cx="60" cy="56" r="26" fill="#e5aa82" />
      {/* Eyes */}
      <circle cx="51" cy="56" r="2.8" fill="#2b1d14" />
      <circle cx="69" cy="56" r="2.8" fill="#2b1d14" />
      {/* Smile */}
      <path d="M54 65 Q60 70 66 65" stroke="#2b1d14" strokeWidth="2.2" strokeLinecap="round" fill="none" />
      {/* Cheeks */}
      <circle cx="47" cy="61" r="3.5" fill="#f09b85" opacity="0.5" />
      <circle cx="73" cy="61" r="3.5" fill="#f09b85" opacity="0.5" />
      {/* Hair */}
      {isFemale ? (
        <>
          <path d="M34 54 C34 38 42 32 60 32 C78 32 86 38 86 54 C86 58 84 64 83 72 C81 64 80 50 78 48 C72 44 64 42 60 42 C56 42 48 44 42 48 C40 50 39 64 37 72 C36 64 34 58 34 54 Z" fill="#3b2219" />
          <path d="M42 46 C50 40 70 40 78 46 C76 43 68 40 60 40 C52 40 44 43 42 46 Z" fill="#2b170e" />
        </>
      ) : (
        <path d="M34 52 C34 38 45 32 60 32 C75 32 86 38 86 52 C82 46 76 42 60 42 C44 42 38 46 34 52 Z" fill="#2b1d14" />
      )}
    </svg>
  );
}
