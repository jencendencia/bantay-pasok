import React, { useState } from 'react';
import { useData } from '../store';
import { api } from '../api';
import { Modal } from '../ui';
import { visibleAnnouncements, pickRotating } from '../shared/announce';

import type { Announcement } from '../shared/types';

export default function StandbyTab(): React.ReactElement {
  const { data, refresh } = useData();
  const [adding, setAdding] = useState(false);
  if (!data) return <div className="empty">Loading…</div>;

  const s = data.settings;

  const toggle = async (a: Announcement): Promise<void> => {
    const next = { ...a, enabled: !a.enabled };
    await api.patchData({
      announcements: data.announcements.map(x => (x.id === a.id ? next : x))
    });
    void refresh();
  };

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">Standby screen</h1>
          <div className="page-sub">Set what the scanner display shows between scans</div>
        </div>
        <button className="btn primary" onClick={() => void api.openScanner()}>
          ▶ Open scanner display
        </button>
      </div>

      <div className="grid-2">
        <div className="stack">
          <div className="card">
            <h3>Greeting</h3>
            <label style={{ display: 'flex', gap: 10, alignItems: 'center', fontWeight: 600, fontSize: 14 }}>
              <input
                type="checkbox"
                checked={s.greetingAuto !== false}
                onChange={async e => {
                  await api.patchData({ settings: { ...s, greetingAuto: e.target.checked } });
                  void refresh();
                }}
              />
              Show "Happy [Day]!" automatically
            </label>
            <div className="field" style={{ marginTop: 10 }}>
              <label>Greeting pattern</label>
              <input
                value={s.greetingPattern ?? 'Happy {day}!'}
                onChange={async e => {
                  await api.patchData({ settings: { ...s, greetingPattern: e.target.value } });
                  void refresh();
                }}
              />
              <div className="card-note">On holidays, type a special greeting for that date, like "Happy Independence Day!"</div>
            </div>
            <div className="field">
              <label>Holiday greeting (used when today is a holiday)</label>
              <input
                value={s.holidayGreeting ?? ''}
                placeholder="Happy Independence Day!"
                onChange={async e => {
                  await api.patchData({ settings: { ...s, holidayGreeting: e.target.value } });
                  void refresh();
                }}
              />
            </div>
          </div>

        </div>

        <div className="stack">
          <PreviewCard />
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <h3 style={{ margin: 0 }}>Announcement queue</h3>
              <button className="btn yellow small" onClick={() => setAdding(true)}>＋ New</button>
            </div>
            {data.announcements.length === 0 && <div className="empty">No announcements yet</div>}
            {data.announcements.map(a => (
              <div key={a.id} className="check-row">
                <Pillish a={a} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{a.title}</div>
                  <div style={{ color: 'var(--muted)', fontSize: 12.5 }}>{a.from} → {a.to}</div>
                </div>
                <input type="checkbox" checked={a.enabled} onChange={() => void toggle(a)} />
                <button className="btn ghost small" onClick={async () => {
                  await api.patchData({ announcements: data.announcements.filter(x => x.id !== a.id) });
                  void refresh();
                }}>✕</button>
              </div>
            ))}
            <div className="toolbar" style={{ marginTop: 12 }}>
              <span className="toolbar-label">Rotate every</span>
              {[5, 10, 15, 30].map(v => (
                <button
                  key={v}
                  className={`btn small ${(s.rotateSeconds ?? 10) === v ? 'primary' : 'ghost'}`}
                  onClick={async () => {
                    await api.patchData({ settings: { ...s, rotateSeconds: v } });
                    void refresh();
                  }}
                >{v}s</button>
              ))}
              <span className="toolbar-label">Scanning always interrupts the standby screen.</span>
            </div>
          </div>
        </div>
      </div>

      {adding && (
        <NewAnnouncement
          onClose={() => setAdding(false)}
          onAdd={async a => {
            await api.patchData({ announcements: [...data.announcements, a] });
            void refresh();
            setAdding(false);
          }}
        />
      )}
    </div>
  );
}

function Pillish({ a }: { a: Announcement }): React.ReactElement {
  const label = a.type === 'text' ? 'Text' : a.type === 'video' ? 'Video' : 'Photo';
  const color = a.type === 'text' ? 'blue' : a.type === 'video' ? 'green' : 'purple';
  return <span className={`pill ${color}`}>{label}</span>;
}

function PreviewCard(): React.ReactElement {
  const { data, now } = useData();
  if (!data) return <div className="card">Loading…</div>;
  const s = data.settings;
  const today = isoDay(now);
  const dayName = now.toLocaleDateString('en-PH', { weekday: 'long' });
  const isHoliday = data.holiday.date === today || s.holidayDates.includes(today);
  const greet = (isHoliday && s.holidayGreeting) ? s.holidayGreeting : (s.greetingPattern ?? 'Happy {day}!').replace('{day}', dayName);
  // Exactly what the scanner shows: per-type rotation on the shared clock.
  const rotateSeconds = s.rotateSeconds ?? 10;
  const visible = visibleAnnouncements(data.announcements, today);
  const textAnnounce = pickRotating(visible.filter(a => a.type === 'text'), rotateSeconds, now.getTime());
  const photoAnnounce = pickRotating(visible.filter(a => a.type === 'photo'), rotateSeconds, now.getTime());
  const videoAnnounce = pickRotating(visible.filter(a => a.type === 'video'), rotateSeconds, now.getTime());
  const current = textAnnounce ?? photoAnnounce ?? videoAnnounce;

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
        <h3 style={{ margin: 0 }}>Live preview</h3>
        <span style={{ color: 'var(--muted)', fontSize: 12.5 }}>What the scanner screen shows</span>
      </div>
      <div style={{
        background: 'linear-gradient(160deg, #0f4234, #0e3a2f 55%, #0b2b22)', color: '#fff',
        borderRadius: 14, padding: '26px 24px 56px', textAlign: 'center', position: 'relative'
      }}>
        <div style={{ position: 'absolute', top: 14, right: 18, textAlign: 'right' }}>
          <div style={{ fontWeight: 800, fontSize: 22 }}>{now.toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' })}</div>
          <div style={{ color: '#a8c3b5', fontSize: 11.5 }}>{now.toLocaleDateString('en-PH', { month: 'long', day: 'numeric', year: 'numeric' })}</div>
        </div>
        <div style={{ position: 'absolute', top: 14, left: 18, display: 'flex', gap: 8, alignItems: 'center' }}>
          <div className="brand-badge" style={{ width: 30, height: 30, fontSize: 14 }}>✓</div>
          <div style={{ textAlign: 'left' }}>
            <div style={{ fontWeight: 700, fontSize: 12.5 }}>{s.schoolName}</div>
            <div style={{ color: '#a8c3b5', fontSize: 10.5 }}>Attendance and class monitor</div>
          </div>
        </div>
        <h2 style={{ fontSize: 34, margin: '40px 0 0' }}>{greet}</h2>
        <div style={{ height: 6, background: 'var(--yellow)', borderRadius: 999, width: '40%', margin: '8px auto 0' }} />
        {current?.type === 'text' && (
          <div className="announce-card" style={{ margin: '20px auto 0', maxWidth: 460 }}>
            <h4 style={{ fontSize: 17 }}>{current.title}</h4>
            <p style={{ fontSize: 13 }}>{current.body}</p>
            <div className="posted">Posted by {current.postedBy}</div>
          </div>
        )}
        {current?.type === 'photo' && current.photoData && (
          <img src={current.photoData} alt={current.title} style={{ maxWidth: 320, maxHeight: 150, borderRadius: 10, marginTop: 16 }} />
        )}
        {current?.type === 'video' && current.videoData && (
          <video
            key={current.id}
            src={current.videoData}
            style={{ maxWidth: 340, maxHeight: 170, borderRadius: 10, marginTop: 16, display: 'block', marginLeft: 'auto', marginRight: 'auto', background: '#000' }}
            autoPlay
            loop
            muted
            playsInline
          />
        )}
        {photoAnnounce?.photoData && current?.type !== 'photo' && (
          <img src={photoAnnounce.photoData} alt={photoAnnounce.title} style={{ maxWidth: 200, maxHeight: 96, borderRadius: 8, marginTop: 12, opacity: 0.85 }} />
        )}
        {videoAnnounce?.videoData && current?.type !== 'video' && (
          <video
            key={videoAnnounce.id}
            src={videoAnnounce.videoData}
            style={{ maxWidth: 210, maxHeight: 100, borderRadius: 8, marginTop: 12, display: 'block', marginLeft: 'auto', marginRight: 'auto', background: '#000', opacity: 0.85 }}
            autoPlay
            loop
            muted
            playsInline
          />
        )}
        <div className="scan-banner" style={{ bottom: 14 }}>
          <div className="qr-ico">▦</div>
          <div>
            <div className="t1">Scan your QR code to check in</div>
            <div className="t2">Students and teachers: hold your ID card up to the scanner</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function isoDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function NewAnnouncement({ onClose, onAdd }: { onClose: () => void; onAdd: (a: Announcement) => void }): React.ReactElement {
  const [type, setType] = useState<'text' | 'photo' | 'video'>('text');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [from, setFrom] = useState(isoDay(new Date()));
  const [to, setTo] = useState(isoDay(new Date()));
  const [photo, setPhoto] = useState<string | undefined>();
  const [video, setVideo] = useState<string | undefined>();
  const [videoName, setVideoName] = useState('');
  const [postedBy, setPostedBy] = useState("Principal's Office");

  return (
    <Modal title="New announcement" onClose={onClose} width={560}>
      <div className="segmented" style={{ marginBottom: 14 }}>
        <button className={type === 'text' ? 'active' : ''} onClick={() => setType('text')}>Text</button>
        <button className={type === 'photo' ? 'active' : ''} onClick={() => setType('photo')}>Photo</button>
        <button className={type === 'video' ? 'active' : ''} onClick={() => setType('video')}>Video</button>
      </div>
      <div className="field"><label>Title</label><input value={title} onChange={e => setTitle(e.target.value)} /></div>
      {type === 'text' ? (
        <div className="field"><label>Message</label><textarea rows={4} value={body} onChange={e => setBody(e.target.value)} /></div>
      ) : type === 'video' ? (
        <div className="field">
          <label>Video file (MP4 / WebM — plays with sound on the standby screen)</label>
          <input
            type="file"
            accept="video/*"
            onChange={e => {
              const f = e.target.files?.[0];
              if (!f) return;
              const r = new FileReader();
              r.onload = () => { setVideo(String(r.result)); setVideoName(f.name); };
              r.readAsDataURL(f);
            }}
          />
          {video && <video src={video} controls muted style={{ maxWidth: 260, borderRadius: 8, marginTop: 8, background: '#000' }} />}
        </div>
      ) : (
        <div className="field">
          <label>Photo</label>
          <input type="file" accept="image/*" onChange={e => {
            const f = e.target.files?.[0];
            if (!f) return;
            const r = new FileReader();
            r.onload = () => setPhoto(String(r.result));
            r.readAsDataURL(f);
          }} />
          {photo && <img src={photo} alt="preview" style={{ maxWidth: 240, borderRadius: 8, marginTop: 8 }} />}
        </div>
      )}
      <div className="form-row">
        <div className="field"><label>Show from</label><input type="date" value={from} onChange={e => setFrom(e.target.value)} /></div>
        <div className="field"><label>Until</label><input type="date" value={to} onChange={e => setTo(e.target.value)} /></div>
      </div>
      <div className="field"><label>Posted by</label><input value={postedBy} onChange={e => setPostedBy(e.target.value)} /></div>
      <div className="modal-actions">
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn primary" disabled={!title || (type === 'photo' && !photo) || (type === 'video' && !video)}
          onClick={() => onAdd({
            id: `ann_${Date.now().toString(36)}`,
            type, title, body, photoData: photo, videoData: video, from, to, enabled: true, postedBy
          })}>Add announcement</button>
      </div>
    </Modal>
  );
}
