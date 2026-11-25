import { signAppealToken, verifyAppealToken } from '@/utils/appealToken';

const payload = { guildId: '123456789012345678', userId: '223456789012345678', exp: 2_000_000_000 };

describe('appeal tokens', () => {
  test('signs and verifies a token bound to a guild and user', () => {
    const token = signAppealToken(payload, 'test-secret');

    expect(verifyAppealToken(token, 'test-secret', 1_900_000_000)).toEqual(payload);
    expect(verifyAppealToken(token, 'wrong-secret', 1_900_000_000)).toBeNull();
  });

  test('rejects expired tokens', () => {
    const token = signAppealToken(payload, 'test-secret');
    expect(verifyAppealToken(token, 'test-secret', payload.exp)).toBeNull();
  });
});
