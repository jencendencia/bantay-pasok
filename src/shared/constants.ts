import type { Settings } from './types';

export const DEPARTMENTS = [
  { id: 'dep_math', name: 'Mathematics' },
  { id: 'dep_science', name: 'Science' },
  { id: 'dep_english', name: 'English' },
  { id: 'dep_filipino', name: 'Filipino' },
  { id: 'dep_ap', name: 'Araling Panlipunan' },
  { id: 'dep_mapeh', name: 'MAPEH' },
  { id: 'dep_tle', name: 'TLE' },
  { id: 'dep_esp', name: 'ESP' }
] as const;

export const SUBJECTS = [
  { name: 'Math', dept: 'dep_math' },
  { name: 'Science', dept: 'dep_science' },
  { name: 'English', dept: 'dep_english' },
  { name: 'Filipino', dept: 'dep_filipino' },
  { name: 'Araling Panlipunan', dept: 'dep_ap' },
  { name: 'MAPEH', dept: 'dep_mapeh' },
  { name: 'TLE', dept: 'dep_tle' },
  { name: 'ESP', dept: 'dep_esp' }
] as const;

export const ABSENCE_REASONS = [
  { id: 'on_leave', label: 'On leave', hint: 'Filed leave or sick' },
  { id: 'in_meeting', label: 'In a meeting', hint: 'Called by admin' },
  { id: 'unknown', label: 'Unknown reason', hint: 'Follow up needed' },
  { id: 'others', label: 'Others', hint: 'Type a note below' }
] as const;

export const DEFAULT_SETTINGS: Settings = {
  schoolName: 'Mabuhay National High School',
  earlyCutoff: '07:00',
  lateAfter: '07:30',
  graceMinutes: 5,
  smsEnabled: true,
  gsmPort: '',
  gsmSimulated: true,
  gsmBaud: 115200,
  countryDialCode: '+63',
  holidayDates: [],
  schoolYear: '2026 - 2027',
  emailEnabled: true,
  smtpHost: 'smtp.gmail.com',
  smtpPort: 465,
  smtpSecure: true,
  smtpUser: '',
  smtpPass: '',
  emailFromName: 'Bantay Pasok',
  terms: [
    { name: 'Term 1', start: '2026-08-03', end: '2026-09-11' },
    { name: 'Term 2', start: '2026-09-14', end: '2026-10-23' },
    { name: 'Term 3', start: '2026-11-09', end: '2027-01-15' },
    { name: 'Term 4', start: '2027-01-25', end: '2027-03-26' }
  ]
};

/** 'Mabuhay National High School' -> 'MN' (used for badges and ID cards). */
export function monogramOf(schoolName: string): string {
  const letters = (schoolName || '')
    .split(/\s+/)
    .filter(w => /[A-Za-z]/.test(w))
    .slice(0, 2)
    .map(w => w[0].toUpperCase())
    .join('');
  return letters || 'BP';
}

export function timeToMin(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + (m || 0);
}

export function minToTime(min: number): string {
  const h = Math.floor(min / 60) % 24;
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function fmt12(t: string): string {
  const [h, m] = t.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${hh}:${String(m).padStart(2, '0')} ${ampm}`;
}

export function nameOf(lastName: string, firstName: string, middleName?: string): string {
  return middleName ? `${firstName} ${middleName}`.trim() + ` ${lastName}` : `${firstName} ${lastName}`.trim();
}

export function fullName(last: string, first: string, middle?: string): string {
  return middle ? `${first} ${middle} ${last}` : `${first} ${last}`;
}

export function titleFor(prefix: string, last: string, first: string): string {
  const n = `${first} ${last}`.trim();
  return `${prefix} ${n}`;
}
