import { describe, expect, it } from 'vitest';
import { profileFromUserDocument } from './offlineAuth';

describe('offline authentication profile safety', () => {
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
