import { includeMessageLogLinks, messageJumpLinkField, messageJumpUrl } from '@/utils/messageLogLinks';

describe('messageLogLinks', () => {
  test('builds fluxer jump urls', () => {
    expect(messageJumpUrl('1', '2', '3')).toBe('https://fluxer.app/channels/1/2/3');
  });

  test('defaults message log links to enabled', () => {
    expect(includeMessageLogLinks(null)).toBe(true);
    expect(includeMessageLogLinks({})).toBe(true);
    expect(includeMessageLogLinks({ messageLogIncludeLinks: true })).toBe(true);
    expect(includeMessageLogLinks({ messageLogIncludeLinks: false })).toBe(false);
  });

  test('formats embed field', () => {
    expect(messageJumpLinkField('g', 'c', 'm')).toEqual({
      name: 'Message Link',
      value: '[Open message](https://fluxer.app/channels/g/c/m)',
      inline: true,
    });
  });
});
