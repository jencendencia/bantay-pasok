import React from 'react';
import { QrImg } from '../pages/Teachers';
import { AvatarIcon } from '../ui';
import { monogramOf } from '../shared/constants';

/**
 * The ID card visual shared by the student and teacher modals
 * and by the hidden print root (the only thing that prints).
 * A student photo (data URL) replaces the cartoon avatar when provided.
 */
export function IdCard({ variant, schoolName, subLabel, name, sub, sex, qr, photoData }: {
  variant: 'student' | 'teacher';
  schoolName: string;
  subLabel: string;
  name: string;
  sub: string;
  sex: 'M' | 'F';
  qr: string;
  photoData?: string;
}): React.ReactElement {
  const monogram = monogramOf(schoolName);

  return (
    <div className="id-card-render">
      <div className="id-card-top">
        <div className="id-card-monogram">{monogram}</div>
        <div>
          <div className="id-card-school">{schoolName}</div>
          <div className="id-card-school-sub">{subLabel}</div>
        </div>
      </div>

      <div className={`id-card-role-bar ${variant}`}>
        {variant.toUpperCase()}
      </div>

      <div className="id-card-body">
        {photoData ? (
          <div className="id-card-photo">
            <img src={photoData} alt={name} />
          </div>
        ) : (
          <div className="id-card-avatar">
            <AvatarIcon role={variant} sex={sex} size={100} />
          </div>
        )}

        <div className="id-card-name">{name}</div>
        <div className="id-card-section">{sub}</div>

        <div className="id-card-qr-box">
          <QrImg value={qr} size={150} />
        </div>

        <div className="id-card-code-str">{qr}</div>
      </div>
    </div>
  );
}
