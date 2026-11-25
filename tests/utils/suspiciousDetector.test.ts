jest.mock('@/config', () => ({
  __esModule: true,
  default: {
    ownerId: null,
    branding: { publicName: 'ClaudeCityMod' },
  },
}));

jest.mock('@/i18n', () => ({
  t: () => 'test',
}));

jest.mock('@/utils/sendUserDm', () => ({
  sendUserDm: jest.fn(),
}));

import { PublicUserFlags } from '@fluxerjs/types';
import {
  assessMember,
  areSuspiciousNamesSimilar,
  clearSuspicionState,
  normalizeSuspiciousText,
  observeMessage,
  recordMemberJoin,
  scoreMember,
  scoreMessageContent,
  scoreProfile,
} from '@/utils/suspiciousDetector';

const FLUXER_EPOCH = 1_420_070_400_000n;

function idForAge(days: number): string {
  const createdMs = BigInt(Date.now() - days * 86_400_000);
  return (((createdMs - FLUXER_EPOCH) << 22n) + 1n).toString();
}

function memberFor(user: Record<string, unknown>): any {
  return { id: user.id, user };
}

describe('suspiciousDetector', () => {
  afterEach(() => {
    clearSuspicionState('guild-1');
    clearSuspicionState('guild-profile');
  });

  test('normalizes common Unicode confusables for comparisons', () => {
    expect(normalizeSuspiciousText('Ｆｌｕｘｅｒ ѕupport')).toBe('fluxer support');
    expect(areSuspiciousNamesSimilar('FluxSupport', 'Flux_Support123')).toBe(true);
  });

  test('does not heavily score a normal name with a default avatar', () => {
    const result = scoreMember(
      memberFor({
        id: idForAge(365),
        username: 'John_Smith',
        globalName: 'John Smith',
        avatar: null,
        flags: 0,
        bot: false,
        system: false,
      }),
    );

    expect(result.score).toBeLessThan(10);
  });

  test('recognizes Fluxer-specific plutonium promotion in a profile bio', () => {
    const result = scoreProfile({ bio: 'free plutonium on fluxer btw https://example.test/claim' });

    expect(result.score).toBeGreaterThanOrEqual(30);
    expect(result.reasons).toEqual(
      expect.arrayContaining([
        'Free plutonium promotion (+18)',
        'Promotional/support language paired with a link (+8)',
      ]),
    );
  });

  test('reads the Fluxer profile wrapper when assessing a member', async () => {
    const fetchWithProfile = jest.fn().mockResolvedValue({
      globalProfile: { userProfile: { bio: 'free plutonium https://example.test/claim' } },
      serverProfile: null,
    });
    const member = memberFor({
      id: idForAge(365),
      username: 'normal-user',
      globalName: 'Normal User',
      avatar: 'avatar-hash',
      flags: 0,
      bot: false,
      system: false,
    });

    const result = await assessMember({ users: { fetchWithProfile } } as any, { id: 'guild-profile' } as any, member);

    expect(fetchWithProfile).toHaveBeenCalledWith(member.user.id, { guildId: 'guild-profile' });
    expect(result.profileFetched).toBe(true);
    expect(result.reasons).toContain('Free plutonium promotion (+18)');
  });

  test('recognizes suspicious early message content and attachments', () => {
    const result = scoreMessageContent({
      content: 'free plutonium https://example.test/claim @everyone',
      hasAttachment: true,
    });

    expect(result.score).toBeGreaterThanOrEqual(30);
    expect(result.reasons).toEqual(
      expect.arrayContaining(['Mass mention in message (+8)', 'Attachment from a monitored account (+3)']),
    );
  });

  test('uses Fluxer spam flags as a high-confidence signal', () => {
    const result = scoreMember(
      memberFor({
        id: idForAge(365),
        username: 'ordinary-user',
        globalName: 'Ordinary User',
        avatar: 'avatar-hash',
        flags: PublicUserFlags.Spammer,
        bot: false,
        system: false,
      }),
    );

    expect(result.score).toBeGreaterThanOrEqual(60);
    expect(result.reasons).toContain('Fluxer marks the account as a spammer (+60)');
  });

  test('links repeated messages from recently joined users into the suspicion signal', () => {
    recordMemberJoin('guild-1', 'user-1');
    recordMemberJoin('guild-1', 'user-2');

    const first = observeMessage('guild-1', 'user-1', { content: 'free plutonium https://example.test/claim' });
    const second = observeMessage('guild-1', 'user-2', { content: 'free plutonium https://example.test/claim' });

    expect(first.reasons).toContain('Message sent soon after joining (+6)');
    expect(second.reasons).toContain('Message matches 1 recent user(s) (+8)');
  });
});
