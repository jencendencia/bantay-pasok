import React from 'react';
import { AvatarIcon } from '../ui';
import type { Student } from '../shared/types';

/**
 * A student's photo (or the male/female avatar used at enrolment when they
 * have none). Shared by the Students page, the Sections page, and anywhere
 * else a small round student identity is shown.
 */
export function StudentFace({ student, size = 36 }: { student: Student; size?: number }): React.ReactElement {
  if (student.photoData) {
    return (
      <img
        src={student.photoData}
        alt={`${student.firstName} ${student.lastName}`}
        style={{
          width: size, height: size, borderRadius: '50%', objectFit: 'cover',
          border: '2px solid var(--yellow)', flex: 'none', background: 'var(--green-50)'
        }}
      />
    );
  }
  return (
    <span
      style={{
        width: size, height: size, borderRadius: '50%', overflow: 'hidden',
        border: '2px solid var(--yellow)', flex: 'none', display: 'inline-block', background: '#e2f0ea'
      }}
    >
      <AvatarIcon role="student" sex={student.sex} size={size} />
    </span>
  );
}
