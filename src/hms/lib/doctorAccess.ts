type AuthUserLike = {
  uid?: string | null;
  email?: string | null;
};

type UserProfileLike = {
  id?: string;
  name?: string;
  username?: string;
  email?: string;
};

type StaffLike = {
  id: string;
  userId?: string;
  name?: string;
  username?: string;
  email?: string;
  role?: string;
  status?: string;
};

function clean(value?: string | null): string {
  return String(value || '').trim().toLowerCase();
}

function usernameFromEmail(value?: string | null): string {
  const normalized = clean(value);
  return normalized.includes('@') ? normalized.split('@')[0] : normalized;
}

export function normalizeRole(role?: string | null): string {
  return clean(role);
}

export function findCurrentDoctorStaff(
  staff: StaffLike[],
  userProfile: UserProfileLike | null,
  authUser: AuthUserLike | null | undefined,
): StaffLike | null {
  const uid = clean(authUser?.uid);
  const identifiers = new Set(
    [
      userProfile?.username,
      userProfile?.email,
      usernameFromEmail(userProfile?.email),
      authUser?.email,
      usernameFromEmail(authUser?.email),
    ].map(clean).filter(Boolean)
  );
  const profileName = clean(userProfile?.name);

  const doctors = staff.filter(s => clean(s.role) === 'doctor' && clean(s.status) !== 'inactive');
  return doctors.find(s => uid && clean(s.userId) === uid)
    || doctors.find(s => identifiers.has(clean(s.email)) || identifiers.has(clean(s.username)))
    || doctors.find(s => profileName && clean(s.name) === profileName)
    || null;
}

export function filterDoctorRecords<T extends Record<string, any>>(
  records: T[],
  roleLoaded: boolean,
  role: string,
  doctorStaffId: string | null,
  doctorIdKey: keyof T = 'doctorId',
): T[] {
  if (!roleLoaded) return [];
  if (normalizeRole(role) !== 'doctor') return records;
  if (!doctorStaffId) return [];
  return records.filter(record => record[doctorIdKey] === doctorStaffId);
}
