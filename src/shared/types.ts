export type Role = 'admin' | 'teacher';

export interface User {
  id: string;
  username: string;
  passwordHash: string;
  role: Role;
  displayName: string;
}

export interface Section {
  id: string;
  name: string;
  grade: string;
  color: string;
}

export interface Department {
  id: string;
  name: string;
}

export interface Teacher {
  id: string;
  qr: string;
  lastName: string;
  firstName: string;
  middleName: string;
  departmentId: string;
  number?: string;
}

export interface Guardian {
  id: string;
  lastName: string;
  firstName: string;
  number: string;
  address: string;
  email?: string;
}

export interface Student {
  id: string;
  qr: string;
  lastName: string;
  firstName: string;
  middleName: string;
  sex: 'M' | 'F';
  number: string;
  sectionId: string | null;
  guardianId: string | null;
}

export interface Slot {
  id: string;
  sectionId: string;
  subject: string;
  departmentId: string;
  teacherId: string;
  start: string;   // "07:30"
  end: string;     // "08:20"
  days: number[];  // 0=Sun..6=Sat
}

export type AbsenceReason = 'on_leave' | 'in_meeting' | 'unknown' | 'others';

export interface SlotStatus {
  id: string;
  reason: AbsenceReason | null;
  note: string;
  date: string;
}

export interface ScanRecord {
  id: string;
  personId: string;     // teacher or student id
  role: 'teacher' | 'student';
  ts: number;
  kind: 'in' | 'out';
}

export interface ClassScan {
  id: string;
  slotId: string;
  teacherId: string;
  date: string;
  ts: number;
}

export type SmsStatus = 'pending' | 'sent' | 'failed' | 'retrying';

export type EmailStatus = 'pending' | 'sent' | 'failed' | 'retrying';

export interface EmailMessage {
  id: string;
  ts: number;
  to: string;
  subject: string;
  body: string;
  studentId: string;
  kind: 'arrival' | 'departure';
  status: EmailStatus;
  attempts: number;
  lastError?: string;
  sentTs?: number;
  nextRetryTs?: number;
}

export interface SmsMessage {
  id: string;
  ts: number;
  to: string;
  body: string;
  studentId: string;
  kind: 'arrival' | 'departure';
  status: SmsStatus;
  attempts: number;
  lastError?: string;
  sentTs?: number;
  nextRetryTs?: number;
}

export interface Settings {
  schoolName: string;
  earlyCutoff: string;      // "07:00"
  lateAfter: string;        // "07:30"
  graceMinutes: number;     // teacher slot grace
  greetingAuto?: boolean;
  greetingPattern?: string;
  holidayGreeting?: string;
  rotateSeconds?: number;
  smsEnabled: boolean;
  gsmPort: string;
  gsmSimulated: boolean;
  gsmBaud: number;
  countryDialCode: string;
  holidayDates: string[];
  schoolYear: string;
  terms: { name: string; start: string; end: string }[];
  lastSectionSeed?: string;
  emailEnabled: boolean;      // send email to parents on scan
  smtpHost: string;           // e.g. smtp.gmail.com
  smtpPort: number;           // 465 (SSL) or 587 (STARTTLS)
  smtpSecure: boolean;        // true for 465
  smtpUser: string;           // gmail address
  smtpPass: string;           // gmail app password (not the login password)
  emailFromName: string;      // display name on outgoing mail
}

export type UpdateState = 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error';

export interface UpdateEvent {
  state: UpdateState;
  progress: number;          // 0-100 while downloading
  version?: string;          // new version on available/downloaded
  error?: string | null;
}

export interface UpdateStatusInfo extends UpdateEvent {
  currentVersion: string;
  downloadedVersion: string | null;
}

export interface Announcement {
  id: string;
  type: 'text' | 'photo' | 'video';
  title: string;
  body: string;
  photoPath?: string;
  photoData?: string; // data URL
  videoData?: string; // data URL (video announcement with audio)
  from: string;
  to: string;
  enabled: boolean;
  postedBy: string;
}

export interface BorrowedState {
  sections: string[]; // section ids, [] = none; special 'all'
}

export interface Student {
  id: string;
  qr: string;
  lastName: string;
  firstName: string;
  middleName: string;
  sex: 'M' | 'F';
  number: string;
  sectionId: string | null;
  guardianId: string | null;
  kind?: undefined;
}

export interface AttendanceEvent {
  id: string;
  studentId: string;
  date: string;
  ts: number;
  kind: 'in' | 'out';
}

export interface ClassEvent {
  id: string;
  slotId: string;
  teacherId: string;
  date: string;
  ts: number;
}

export interface AppData {
  users: User[];
  sections: Section[];
  departments: Department[];
  teachers: Teacher[];
  guardians: Guardian[];
  students: Student[];
  slots: Slot[];
  slotStatuses: SlotStatus[];
  scans: ScanRecord[];
  attendance: AttendanceEvent[];
  classEvents: ClassEvent[];
  sms: SmsMessage[];
  emails: EmailMessage[];
  settings: Settings;
  announcements: Announcement[];
  borrowed: BorrowedState;
  holiday: { date: string | null };
}

export interface ScanResult {
  ok: boolean;
  message: string;
  kind: 'teacher' | 'student_in' | 'student_out' | 'unknown' | 'duplicate';
  personId?: string;
  name?: string;
  detail?: string;
  statusCategory?: 'early' | 'on_time' | 'late' | 'departure' | 'teacher' | 'error';
  qr?: string;
  subDetail?: string;
}

export interface ReportParams {
  type: 'teacher' | 'teacher_individual' | 'student' | 'student_punctuality';
  from: string;
  to: string;
  teacherId?: string;
  sectionId?: string;
}

export interface IpcResult<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
}
