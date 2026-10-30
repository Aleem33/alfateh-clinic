import { describe, expect, it } from 'vitest';
import { profileFromUserDocument } from './offlineAuth';

describe('offline authentication profile safety', () => {
  it.each([{}, { role: 'unknown' }, { role: 'admin', active: false }, { role: 'admin', disabled: true }])('rejects invalid or disabled profiles: %j', data => {
    expect(profileFromUserDocument('user-1', 'user@example.test', data).active).toBe(false);
  });
  it('treats a recoverably deleted account as disabled', () => {
    expect(profileFromUserDocument('user-1', 'cashier@example.test', {
      username: 'cashier',
      role: 'cashier',
      active: true,
      deleted: true,
    })).toMatchObject({
      uid: 'user-1',
      role: 'cashier',
      active: false,
    });
  });
});
