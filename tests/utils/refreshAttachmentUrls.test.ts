import {
  applyRefreshedAttachmentUrls,
  attachmentUrlNeedsRefresh,
  refreshAttachmentUrls,
  refreshTranscriptAttachments,
} from '@/utils/refreshAttachmentUrls';

const NOW = Date.now();
const EXPIRED = Math.floor((NOW - 60 * 60 * 1000) / 1000).toString(16);
const FRESH = Math.floor((NOW + 12 * 60 * 60 * 1000) / 1000).toString(16);

function attachmentUrl(ex: string): string {
  return `https://fluxerusercontent.com/attachments/1/2/file.png?ex=${ex}&is=12345678&hm=${'a'.repeat(64)}`;
}

describe('attachmentUrlNeedsRefresh', () => {
  test('refreshes unsigned attachment URLs', () => {
    expect(attachmentUrlNeedsRefresh('https://fluxerusercontent.com/attachments/1/2/file.png', NOW)).toBe(true);
  });

  test('refreshes signatures that expire within an hour', () => {
    expect(attachmentUrlNeedsRefresh(attachmentUrl(EXPIRED), NOW)).toBe(true);
  });

  test('keeps a still-valid signature', () => {
    expect(attachmentUrlNeedsRefresh(attachmentUrl(FRESH), NOW)).toBe(false);
  });

  test('does not refresh data package URLs', () => {
    expect(
      attachmentUrlNeedsRefresh(
        `https://fluxerusercontent.com/attachments/1/2/file.png?ex=0&is=12345678&hm=${'a'.repeat(64)}&uc=dp`,
        NOW,
      ),
    ).toBe(false);
  });

  test('ignores non-attachment URLs', () => {
    expect(attachmentUrlNeedsRefresh('https://example.com/pic.png', NOW)).toBe(false);
  });
});

describe('refreshAttachmentUrls', () => {
  test('batches stale URLs and maps refreshed results', async () => {
    const stale = attachmentUrl(EXPIRED);
    const rest = {
      post: jest.fn().mockResolvedValue({
        refreshed_urls: [{ original: stale, refreshed: attachmentUrl(FRESH) }],
      }),
    };

    const refreshed = await refreshAttachmentUrls(rest, [stale, stale], NOW);

    expect(rest.post).toHaveBeenCalledTimes(1);
    expect(rest.post).toHaveBeenCalledWith('/attachments/refresh-urls', {
      body: { attachment_urls: [stale] },
    });
    expect(refreshed.get(stale)).toBe(attachmentUrl(FRESH));
  });

  test('skips URLs that do not need a refresh', async () => {
    const rest = { post: jest.fn() };
    const fresh = attachmentUrl(FRESH);

    const refreshed = await refreshAttachmentUrls(rest, [fresh], NOW);

    expect(rest.post).not.toHaveBeenCalled();
    expect(refreshed.size).toBe(0);
  });
});

describe('refreshTranscriptAttachments', () => {
  test('rewrites stale transcript attachment URLs', async () => {
    const stale = attachmentUrl(EXPIRED);
    const fresh = attachmentUrl(FRESH);
    const rest = {
      post: jest.fn().mockResolvedValue({
        refreshed_urls: [{ original: stale, refreshed: fresh }],
      }),
    };

    const messages = await refreshTranscriptAttachments(rest, [{ attachments: [{ url: stale, name: 'file.png' }] }]);

    expect(messages[0]?.attachments?.[0]?.url).toBe(fresh);
  });

  test('keeps original URLs when refresh fails', async () => {
    const stale = attachmentUrl(EXPIRED);
    const rest = { post: jest.fn().mockRejectedValue(new Error('nope')) };

    const messages = await refreshTranscriptAttachments(rest, [{ attachments: [{ url: stale, name: 'file.png' }] }]);

    expect(messages[0]?.attachments?.[0]?.url).toBe(stale);
  });

  test('applyRefreshedAttachmentUrls leaves unmatched URLs alone', () => {
    const messages = applyRefreshedAttachmentUrls(
      [{ attachments: [{ url: 'https://example.com/a.png', name: 'a.png' }] }],
      new Map([['https://other.example/a.png', 'https://fresh.example/a.png']]),
    );

    expect(messages[0]?.attachments?.[0]?.url).toBe('https://example.com/a.png');
  });
});
