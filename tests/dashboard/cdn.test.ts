import { fluxerAvatarUrl, fluxerEmojiUrl, fluxerIconUrl, setFluxerMediaBase } from '../../dashboard/src/lib/cdn';

describe('fluxer CDN still frames', () => {
  afterEach(() => {
    setFluxerMediaBase('https://fluxerusercontent.com');
  });

  test('asks the CDN for a still first frame instead of an animation sprite sheet', () => {
    expect(fluxerIconUrl('1517509871442866176', 'a_b4bbfd81', 96)).toBe(
      'https://fluxerusercontent.com/icons/1517509871442866176/a_b4bbfd81.webp?animated=false&size=96',
    );
    expect(fluxerAvatarUrl('2', 'd644ac0b', 48)).toBe(
      'https://fluxerusercontent.com/avatars/2/d644ac0b.webp?animated=false&size=48',
    );
    expect(fluxerEmojiUrl('9', true)).toBe(
      'https://fluxerusercontent.com/emojis/9.webp?animated=true&size=32&quality=lossless',
    );
    expect(fluxerIconUrl('1', null)).toBeNull();
    expect(fluxerAvatarUrl('2', null)).toBeNull();
  });

  test('uses a custom instance media host', () => {
    setFluxerMediaBase('https://cdn.my-fluxer.example/');
    expect(fluxerIconUrl('1', 'abc', 64)).toBe('https://cdn.my-fluxer.example/icons/1/abc.webp?animated=false&size=64');
  });
});
