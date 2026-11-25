import resolveTicketUserId from '@/utils/resolveTicketUserId';

describe('resolveTicketUserId', () => {
  test('uses the structured mention when present', () => {
    expect(resolveTicketUserId([{ id: '1472055467356586113' }], '@someone')).toBe('1472055467356586113');
  });

  test('falls back to a mention token in the argument', () => {
    expect(resolveTicketUserId([], '<@1472055467356586113>')).toBe('1472055467356586113');
  });

  test('falls back to a raw user ID', () => {
    expect(resolveTicketUserId(undefined, '1472055467356586113')).toBe('1472055467356586113');
  });

  test('finds a mention in the full message content', () => {
    expect(resolveTicketUserId([], '@someone', 'f!ticket add <@1472055467356586113>')).toBe('1472055467356586113');
  });

  test('returns null when nothing can be resolved', () => {
    expect(resolveTicketUserId([], '@someone', 'f!ticket add @someone')).toBeNull();
  });
});
