import type { Settings } from './types';

export const DEPARTMENTS = [
  { id: 'dep_math', name: 'Mathematics' },
  { id: 'dep_science', name: 'Science' },
  { id: 'dep_english', name: 'English' },
  { id: 'dep_filipino', name: 'Filipino' },
  { id: 'dep_ap', name: 'Araling Panlipunan' },
  { id: 'dep_mapeh', name: 'MAPEH' },
  { id: 'dep_tle', name: 'T.L.E.' },
  { id: 'dep_esp', name: 'ESP' }
] as const;

export const SUBJECTS = [
  { name: 'Mathematics', dept: 'dep_math' },
  { name: 'Science', dept: 'dep_science' },
  { name: 'English', dept: 'dep_english' },
  { name: 'Filipino', dept: 'dep_filipino' },
  { name: 'Araling Panlipunan', dept: 'dep_ap' },
  { name: 'MAPEH', dept: 'dep_mapeh' },
  { name: 'T.L.E.', dept: 'dep_tle' },
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
    { name: 'Term 1', start: '2026-06-15', end: '2026-08-27' },
    { name: 'Term 2', start: '2026-09-16', end: '2026-12-02' },
    { name: 'Term 3', start: '2027-01-04', end: '2027-03-12' }
  ]
};

/**
 * The school runs exactly three terms (Term 1–3). Older builds saved a fourth;
 * normalize on load so every install shows Terms 1–3 only.
 */
export function normalizeTerms(terms: unknown): Settings['terms'] {
  if (!Array.isArray(terms) || terms.length === 0) return DEFAULT_SETTINGS.terms.map(t => ({ ...t }));
  const raw = terms as Array<{ name?: unknown; start?: unknown; end?: unknown }>;
  const out = raw.slice(0, 3).map((t, i) => ({
    name: `Term ${i + 1}`,
    start: typeof t?.start === 'string' ? t.start : DEFAULT_SETTINGS.terms[i]?.start ?? '',
    end: typeof t?.end === 'string' ? t.end : DEFAULT_SETTINGS.terms[i]?.end ?? ''
  }));
  while (out.length < 3) out.push({ ...DEFAULT_SETTINGS.terms[out.length] });
  return out;
}

/** Standard class periods per grade level — later grades start later (shared rooms). */
export const GRADE_PERIODS: Record<string, { start: string; end: string }[]> = {
  'Grade 7': [
    { start: '07:30', end: '08:20' }, { start: '08:20', end: '09:10' },
    { start: '09:30', end: '10:20' }, { start: '10:20', end: '11:10' }, { start: '11:10', end: '12:00' },
    { start: '13:00', end: '13:50' }, { start: '13:50', end: '14:40' }, { start: '14:40', end: '15:30' }
  ],
  'Grade 8': [
    { start: '07:40', end: '08:30' }, { start: '08:30', end: '09:20' },
    { start: '09:40', end: '10:30' }, { start: '10:30', end: '11:20' }, { start: '11:20', end: '12:10' },
    { start: '13:10', end: '14:00' }, { start: '14:00', end: '14:50' }, { start: '14:50', end: '15:40' }
  ],
  'Grade 9': [
    { start: '07:50', end: '08:40' }, { start: '08:40', end: '09:30' },
    { start: '09:50', end: '10:40' }, { start: '10:40', end: '11:30' }, { start: '11:30', end: '12:20' },
    { start: '13:20', end: '14:10' }, { start: '14:10', end: '15:00' }, { start: '15:00', end: '15:50' }
  ],
  'Grade 10': [
    { start: '08:00', end: '08:50' }, { start: '08:50', end: '09:40' },
    { start: '10:00', end: '10:50' }, { start: '10:50', end: '11:40' }, { start: '11:40', end: '12:30' },
    { start: '13:30', end: '14:20' }, { start: '14:20', end: '15:10' }, { start: '15:10', end: '16:00' }
  ]
};

/** Period template for a grade level, matched by the number in the grade name. */
export function gradePeriodsFor(grade: string): { start: string; end: string }[] {
  const n = /(\d{1,2})/.exec(grade || '')?.[1];
  const key = Object.keys(GRADE_PERIODS).find(k => /\d{1,2}/.exec(k)?.[1] === n);
  return (key && GRADE_PERIODS[key]) || GRADE_PERIODS['Grade 7'];
}

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
