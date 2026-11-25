import {
  clearFluxerIpBanState,
  isFluxerIpBanError,
  isFluxerIpBanMessage,
  isFluxerIpBanned,
  markFluxerIpBan,
  noteFluxerApiRecovered,
  shouldLogFluxerIpBan,
  shouldReportFluxerIpBanToGlitchtip,
} from '@/utils/fluxerApiErrors';

describe('fluxerApiErrors', () => {
  beforeEach(() => {
    clearFluxerIpBanState();
  });

  test('detects IP ban by code', () => {
    expect(isFluxerIpBanError({ code: 'GLOBAL_IP_TEMPORARILY_BANNED', message: 'nope' })).toBe(true);
  });

  test('detects IP ban by message', () => {
    expect(
      isFluxerIpBanError({
        message: 'Your IP address has been temporarily blocked from the Fluxer API for 24 hours',
      }),
    ).toBe(true);
  });

  test('mark and clear ban state', () => {
    markFluxerIpBan();
    expect(isFluxerIpBanned()).toBe(true);
    noteFluxerApiRecovered();
    expect(isFluxerIpBanned()).toBe(false);
  });

  test('rate-limits logs and glitchtip', () => {
    expect(shouldLogFluxerIpBan()).toBe(true);
    expect(shouldLogFluxerIpBan()).toBe(false);
    expect(shouldReportFluxerIpBanToGlitchtip()).toBe(true);
    expect(shouldReportFluxerIpBanToGlitchtip()).toBe(false);
  });

  test('isFluxerIpBanMessage', () => {
    expect(isFluxerIpBanMessage('GLOBAL_IP_TEMPORARILY_BANNED')).toBe(true);
    expect(isFluxerIpBanMessage('something else')).toBe(false);
  });
});
