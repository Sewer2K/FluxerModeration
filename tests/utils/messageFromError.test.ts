import { messageFromError } from '@/utils/messageFromError';

describe('messageFromError', () => {
  test('returns the message of a plain error', () => {
    expect(messageFromError(new Error('boom'))).toBe('boom');
  });

  test('falls back for non-error values', () => {
    expect(messageFromError(null, 'fallback')).toBe('fallback');
    expect(messageFromError('str')).toBe('str');
  });

  test('appends Fluxer field errors to the message', () => {
    const err = {
      message: 'Invalid form body.',
      code: 'INVALID_FORM_BODY',
      statusCode: 400,
      errors: [{ path: 'user_id', message: 'USER_IS_NOT_BANNED', code: 'USER_IS_NOT_BANNED' }],
    };
    expect(messageFromError(err)).toBe('Invalid form body. [user_id: USER_IS_NOT_BANNED]');
  });

  test('joins multiple field errors', () => {
    const err = {
      message: 'Invalid form body.',
      errors: [
        { path: 'a', code: 'X' },
        { path: 'b', message: 'Y' },
      ],
    };
    expect(messageFromError(err)).toBe('Invalid form body. [a: X, b: Y]');
  });

  test('prefers the field code over the message', () => {
    const err = {
      message: 'Invalid form body.',
      errors: [{ path: 'user_id', message: 'That user is not banned.', code: 'USER_IS_NOT_BANNED' }],
    };
    expect(messageFromError(err)).toBe('Invalid form body. [user_id: USER_IS_NOT_BANNED]');
  });

  test('ignores empty or malformed errors arrays', () => {
    expect(messageFromError({ message: 'nope', errors: [] })).toBe('nope');
    expect(messageFromError({ message: 'nope', errors: 'junk' })).toBe('nope');
    expect(messageFromError({ message: 'nope', errors: [null, 5] })).toBe('nope');
  });
});
