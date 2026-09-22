// Seed data: four sections, demo teachers and students matching the mockups.
import type { AppData, Announcement } from './types';
import { DEFAULT_SETTINGS } from './constants';

let counter = 0;
function uid(prefix: string): string {
  counter += 1;
  return `${prefix}_${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function hashPassword(pw: string): string {
  // Simple deterministic hash for local kiosk use (not security-critical).
  let h = 5381;
  for (let i = 0; i < pw.length; i++) h = ((h << 5) + h + pw.charCodeAt(i)) | 0;
  return `h${(h >>> 0).toString(16)}`;
}

const SECTIONS = [
  { id: 'sec_g7', name: 'G7 • Sampaguita', grade: 'Grade 7', color: '#0e3a2f' },
  { id: 'sec_g8', name: 'G8 • Narra', grade: 'Grade 8', color: '#0e3a2f' },
  { id: 'sec_g9', name: 'G9 • Molave', grade: 'Grade 9', color: '#0e3a2f' },
  { id: 'sec_g10', name: 'G10 • Acacia', grade: 'Grade 10', color: '#0e3a2f' }
];

const TEACHERS = [
  { last: 'Santos', first: 'Ma. Luisa', dept: 'dep_filipino', code: 'T-0031' },
  { last: 'Dela Cruz', first: 'Ronaldo', dept: 'dep_math', code: 'T-0032' },
  { last: 'Bautista', first: 'Angelica', dept: 'dep_english', code: 'T-0033' },
  { last: 'Mercado', first: 'Joel', dept: 'dep_science', code: 'T-0034' },
  { last: 'Villanueva', first: 'Cristina', dept: 'dep_english', code: 'T-0035' },
  { last: 'Aquino', first: 'Jocelyn', dept: 'dep_filipino', code: 'T-0036' },
  { last: 'Pascual', first: 'Ernesto', dept: 'dep_ap', code: 'T-0037' },
  { last: 'Salazar', first: 'Marvin', dept: 'dep_mapeh', code: 'T-0038' },
  { last: 'Manalo', first: 'Liza', dept: 'dep_esp', code: 'T-0039' },
  { last: 'Castillo', first: 'Rowena', dept: 'dep_tle', code: 'T-0040' }
];

const PERIODS = [
  { start: '07:30', end: '08:20' },
  { start: '08:20', end: '09:10' },
  { start: '09:30', end: '10:20' },
  { start: '10:20', end: '11:10' },
  { start: '11:10', end: '12:00' },
  { start: '13:00', end: '13:50' },
  { start: '13:50', end: '14:40' },
  { start: '14:40', end: '15:30' }
];

const SUBJECTS_ROT = [
  ['Math', 'dep_math'], ['English', 'dep_english'], ['Filipino', 'dep_filipino'], ['Science', 'dep_science'],
  ['TLE', 'dep_tle'], ['Araling Panlipunan', 'dep_ap'], ['MAPEH', 'dep_mapeh'], ['ESP', 'dep_esp']
];

const MALE_FIRST = ['Kenneth', 'Nathaniel', 'Juan Miguel', 'Christian', 'Paolo', 'Carlo', 'Miguel', 'Jerome', 'Andres', 'Rafael', 'Diego', 'Marco', 'Felix', 'Ivan', 'Joshua', 'Karl', 'Leo', 'Manuel', 'Nico', 'Oscar', 'Patrick', 'Ramir', 'Sergio', 'Tomas'];
const FEMALE_FIRST = ['Bea', 'Sofia', 'Kristine', 'Trisha', 'Angel', 'Mae', 'Jasmine', 'Kaye', 'Althea', 'Bianca', 'Camille', 'Divina', 'Elena', 'Fatima', 'Grace', 'Hazel', 'Iris', 'Joyce', 'Karla', 'Lorna', 'Marites', 'Nadine', 'Princess', 'Rowena'];
const LASTNAMES = ['Ramos', 'Lim', 'Dela Cruz', 'Aguilar', 'Bernardo', 'Fernandez', 'Soriano', 'Tolentino', 'Garcia', 'Navarro', 'Abad', 'Domingo', 'Cabrera', 'Estrada', 'Padilla', 'Villar', 'Reyes', 'Santos', 'Bautista', 'Ocampo', 'Mendoza', 'Aquino', 'Rivera', 'Castillo'];

// Default school parade SVG illustration matching 01_standby_screen.png
const PARADE_SVG = 'data:image/svg+xml;utf8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 240" width="100%" height="100%">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#93c5d8" />
      <stop offset="100%" stop-color="#bfe0ed" />
    </linearGradient>
  </defs>
  <rect width="400" height="240" fill="url(#sky)" />
  <!-- Sun -->
  <circle cx="340" cy="55" r="24" fill="#fde047" opacity="0.9" />
  <!-- Hills -->
  <path d="M-20 240 Q100 130 220 240 Z" fill="#69a05b" />
  <path d="M160 240 Q290 140 420 240 Z" fill="#588e4c" />
  <!-- Ground -->
  <rect y="195" width="400" height="45" fill="#78ab6a" />
  <!-- Trees -->
  <circle cx="65" cy="180" r="16" fill="#3f6e37" />
  <rect x="62" y="180" width="6" height="20" fill="#6b4423" />
  <circle cx="360" cy="180" r="16" fill="#3f6e37" />
  <rect x="357" y="180" width="6" height="20" fill="#6b4423" />
  <!-- School Building -->
  <polygon points="170,80 270,80 300,120 140,120" fill="#c0392b" />
  <rect x="150" y="120" width="140" height="75" fill="#fcf8e3" />
  <rect x="205" y="145" width="30" height="50" fill="#795548" />
  <!-- Windows -->
  <rect x="165" y="130" width="18" height="18" fill="#81d4fa" stroke="#fff" stroke-width="2" />
  <rect x="185" y="130" width="18" height="18" fill="#81d4fa" stroke="#fff" stroke-width="2" />
  <rect x="237" y="130" width="18" height="18" fill="#81d4fa" stroke="#fff" stroke-width="2" />
  <rect x="257" y="130" width="18" height="18" fill="#81d4fa" stroke="#fff" stroke-width="2" />
  <!-- Flag Pole -->
  <line x1="105" y1="120" x2="105" y2="195" stroke="#455a64" stroke-width="3" />
  <polygon points="105,120 130,132 105,144" fill="#1e88e5" />
  <circle cx="118" cy="132" r="3.5" fill="#fdd835" />
  <!-- Bunting flags string -->
  <path d="M0,50 Q100,75 200,60 T400,65" fill="none" stroke="#e0e0e0" stroke-width="1.5" />
  <polygon points="15,53 25,75 35,55" fill="#f44336" />
  <polygon points="50,58 60,80 70,60" fill="#ff9800" />
  <polygon points="85,63 95,85 105,65" fill="#4caf50" />
  <polygon points="120,66 130,88 140,67" fill="#2196f3" />
  <polygon points="155,65 165,86 175,64" fill="#9c27b0" />
  <polygon points="190,61 200,83 210,61" fill="#f44336" />
  <polygon points="225,62 235,84 245,62" fill="#ff9800" />
  <polygon points="260,63 270,85 280,63" fill="#4caf50" />
  <polygon points="295,64 305,86 315,64" fill="#2196f3" />
  <polygon points="330,65 340,86 350,65" fill="#ffeb3b" />
  <polygon points="365,65 375,85 385,65" fill="#e91e63" />
  <!-- Pathway dots -->
  <circle cx="185" cy="208" r="4" fill="#fff" opacity="0.8" />
  <circle cx="198" cy="212" r="5" fill="#fff" opacity="0.8" />
  <circle cx="212" cy="210" r="4" fill="#fff" opacity="0.8" />
  <circle cx="230" cy="213" r="5" fill="#fff" opacity="0.8" />
  <circle cx="245" cy="212" r="4" fill="#fff" opacity="0.8" />
  <circle cx="258" cy="214" r="4" fill="#fff" opacity="0.8" />
</svg>`);

export function buildSeedData(): AppData {
  const teachers = TEACHERS.map((t, idx) => ({
    id: uid('t'),
    qr: t.code || `T-${String(31 + idx).padStart(4, '0')}`,
    lastName: t.last,
    firstName: t.first,
    middleName: '',
    departmentId: t.dept
  }));

  const students = [];
  let ln = 0;
  let sCodeNum = 418; // 417 is reserved for Juan Miguel Dela Cruz below (mockup ID)
  for (const sec of SECTIONS) {
    for (let i = 0; i < 20; i++) {
      const sex = i % 2 === 0 ? 'M' : 'F';
      const first = (sex === 'M' ? MALE_FIRST : FEMALE_FIRST)[i % 24];
      const last = LASTNAMES[ln % LASTNAMES.length];
      ln++;
      const sQr = `S-2026-${String(sCodeNum++).padStart(5, '0')}`;
      students.push({
        id: uid('s'),
        qr: sQr,
        lastName: last,
        firstName: first,
        middleName: '',
        sex: sex as 'M' | 'F',
        number: `+63 917 ${String(5550000 + students.length).slice(-7)}`,
        sectionId: sec.id as string | null,
        guardianId: null as string | null
      });
    }
  }

  // Ensure Juan Miguel Dela Cruz exists in G8 Narra as in the mockups!
  const g8Narra = SECTIONS[1];
  const jm = students.find(s => s.sectionId === g8Narra.id && s.sex === 'M');
  if (jm) {
    jm.firstName = 'Juan Miguel';
    jm.lastName = 'Dela Cruz';
    jm.qr = 'S-2026-00417';
    jm.number = '+63 917 555 0142';
  }

  // Assign one guardian per 4 students (demo)
  const guardians = [];
  for (let i = 0; i < students.length; i += 4) {
    const g = {
      id: uid('g'),
      lastName: students[i].lastName,
      firstName: ['Maria', 'Jose', 'Ana', 'Pedro'][i % 4],
      number: students[i].number,
      address: 'Poblacion, Mabuhay'
    };
    guardians.push(g);
    for (let j = i; j < Math.min(i + 4, students.length); j++) students[j].guardianId = g.id;
  }

  // Class program: assign teachers to slots without double-booking.
  const slots = [];
  const busy: Record<string, number[]> = {}; // teacherIdx -> occupied period indices
  let tIdx = 0;
  for (const sec of SECTIONS) {
    for (let p = 0; p < PERIODS.length; p++) {
      const [subject, dept] = SUBJECTS_ROT[(p + SECTIONS.indexOf(sec)) % SUBJECTS_ROT.length];
      let tries = 0;
      while (busy[tIdx]?.includes(p) && tries < TEACHERS.length) { tIdx = (tIdx + 1) % TEACHERS.length; tries++; }
      const teacher = teachers[tIdx];
      (busy[tIdx] ||= []).push(p);
      tIdx = (tIdx + 1) % TEACHERS.length;
      slots.push({
        id: uid('slot'),
        sectionId: sec.id,
        subject,
        departmentId: dept,
        teacherId: teacher.id,
        start: PERIODS[p].start,
        end: PERIODS[p].end,
        days: [1, 2, 3, 4, 5]
      });
    }
  }

  const today = new Date().toISOString().slice(0, 10);
  const future = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);

  const announcements: Announcement[] = [
    {
      id: 'ann_rehearsal',
      type: 'text',
      title: 'Foundation Day rehearsal today',
      body: 'All Grade 7 to 10 students go to the covered court at 1:00 PM. Wear your PE uniform and bring a water bottle. Regular classes resume at 3:00 PM.',
      from: today,
      to: future,
      enabled: true,
      postedBy: "the Principal's Office"
    },
    {
      id: 'ann_parade',
      type: 'photo',
      title: 'Foundation Day Parade',
      body: 'Friday, September 25 · 7:00 AM · Main gate',
      photoData: PARADE_SVG,
      from: today,
      to: future,
      enabled: true,
      postedBy: 'Administration'
    },
    {
      id: 'ann_uniform',
      type: 'text',
      title: 'Wear PE uniform on Wednesday',
      body: 'Campus-wide physical fitness and sports activities start after Period 4.',
      from: today,
      to: future,
      enabled: false,
      postedBy: 'MAPEH Department'
    }
  ];

  return {
    users: [
      { id: uid('u'), username: 'admin', passwordHash: hashPassword('admin123'), role: 'admin', displayName: 'Administrator' },
      { id: uid('u'), username: 'principal', passwordHash: hashPassword('principal123'), role: 'admin', displayName: 'Principal' }
    ],
    sections: SECTIONS.map(s => ({ ...s })),
    departments: Object.values({
      dep_math: 'Mathematics', dep_science: 'Science', dep_english: 'English', dep_filipino: 'Filipino',
      dep_ap: 'Araling Panlipunan', dep_mapeh: 'MAPEH', dep_tle: 'TLE', dep_esp: 'ESP'
    }).map((name) => ({ id: `dep_${name.toLowerCase().replace(/\s+/g, '_')}`, name: name as string })),
    teachers,
    guardians,
    students,
    slots,
    slotStatuses: [],
    scans: [],
    attendance: [],
    classEvents: [],
    sms: [],
    emails: [],
    settings: { ...DEFAULT_SETTINGS },
    announcements,
    borrowed: { sections: [] },
    holiday: { date: null }
  };
}
