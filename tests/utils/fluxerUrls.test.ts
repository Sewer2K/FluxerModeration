jest.mock('@/config', () => ({
  __esModule: true,
  default: {
    instance: {
      api: 'https://api.my-fluxer.example/',
      gateway: 'wss://gateway.my-fluxer.example',
      web: 'https://web.my-fluxer.example/',
      media: 'https://cdn.my-fluxer.example/',
    },
    fluxerOAuth: {
      clientId: 'custom-client-id',
    },
  },
}));

import {
  fluxerApiBaseUrl,
  fluxerApiOrigin,
  fluxerApiUrl,
  fluxerAppUrl,
  fluxerClientInstanceOptions,
  fluxerAvatarAssetUrl,
  fluxerBotInviteUrl,
  fluxerInstanceHosts,
  fluxerMediaBaseUrl,
  fluxerMediaOrigin,
  fluxerPublicInstance,
  fluxerWebBaseUrl,
  fluxerWebUrl,
} from '@/utils/fluxerUrls';

describe('fluxerUrls', () => {
  test('uses configured instance endpoints', () => {
    expect(fluxerApiBaseUrl()).toBe('https://api.my-fluxer.example');
    expect(fluxerApiOrigin()).toBe('https://api.my-fluxer.example');
    expect(fluxerApiUrl('/users/@me')).toBe('https://api.my-fluxer.example/users/@me');
    expect(fluxerWebBaseUrl()).toBe('https://web.my-fluxer.example');
    expect(fluxerWebUrl('/oauth2/authorize')).toBe('https://web.my-fluxer.example/oauth2/authorize');
    expect(fluxerAppUrl('/channels/g/c/m')).toBe('https://web.my-fluxer.example/channels/g/c/m');
    expect(fluxerMediaBaseUrl()).toBe('https://cdn.my-fluxer.example');
    expect(fluxerMediaOrigin()).toBe('https://cdn.my-fluxer.example');
    expect(fluxerAvatarAssetUrl('2', 'ab')).toBe(
      'https://cdn.my-fluxer.example/avatars/2/ab.webp?animated=false&size=64',
    );
    expect(fluxerInstanceHosts()).toEqual(
      expect.arrayContaining([
        'api.my-fluxer.example',
        'web.my-fluxer.example',
        'cdn.my-fluxer.example',
        'gateway.my-fluxer.example',
      ]),
    );
    expect(fluxerPublicInstance()).toEqual({
      api: 'https://api.my-fluxer.example',
      web: 'https://web.my-fluxer.example',
      media: 'https://cdn.my-fluxer.example',
      clientId: 'custom-client-id',
    });
  });

  test('passes instance api_public, gateway, media, and webapp to the Fluxer.js client', () => {
    expect(fluxerClientInstanceOptions()).toEqual({
      instance: {
        api_public: 'https://api.my-fluxer.example',
        gateway: 'wss://gateway.my-fluxer.example',
        media: 'https://cdn.my-fluxer.example',
        webapp: 'https://web.my-fluxer.example',
      },
    });
  });

  test('builds an invite for the configured OAuth client', () => {
    expect(fluxerBotInviteUrl()).toBe(
      'https://web.my-fluxer.example/oauth2/authorize?client_id=custom-client-id&scope=bot&permissions=4504699474930806',
    );
  });
});
