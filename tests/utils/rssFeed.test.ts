jest.mock('dns/promises', () => ({
  __esModule: true,
  default: {
    lookup: jest.fn(),
  },
}));

import dns from 'dns/promises';
import { fetchFeed } from '@/utils/rssFeed';

const mockLookup = (dns as any).lookup as jest.Mock;

const RSS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Example Feed</title>
    <link>https://example.com</link>
    <description>Example</description>
    <item>
      <title>Item One</title>
      <link>https://example.com/item-1</link>
      <guid>item-1</guid>
    </item>
  </channel>
</rss>`;

const RSS_XML_WITH_ENTITIES = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Example &amp; Feed</title>
    <link>https://example.com</link>
    <description>Example</description>
    <item>
      <title>RT Test &amp; Stuff</title>
      <link>https://example.com/item-entity</link>
      <guid>entity-1</guid>
      <description><![CDATA[RT Test &amp; Stuff &gt; survivors complain &amp; killers adapt]]></description>
    </item>
  </channel>
</rss>`;

const GAMEBANANA_RSS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <items>
    <title>GameBanana API RSS Feed</title>
    <item>
      <title>Yolvoria 9 | Modded Island</title>
      <link>https://gamebanana.com/mods/702660</link>
      <image>https://images.gamebanana.com/img/ss/mods/example.jpg</image>
      <pubDate>Mon, 10 Aug 2026 19:22:19 +0000</pubDate>
    </item>
  </items>
</rss>`;

const REDDIT_ATOM_XML = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:media="http://search.yahoo.com/mrss/">
  <title>Reddit</title>
  <entry>
    <title>Direct image link</title>
    <id>direct-image</id>
    <link href="https://www.reddit.com/r/example/comments/direct/" />
    <content type="html"><![CDATA[
      <img src="https://preview.redd.it/direct.jpeg?width=640&auto=webp&s=hash" />
      <a href="https://i.redd.it/direct.jpeg">[link]</a>
    ]]></content>
    <media:thumbnail url="https://preview.redd.it/other.jpeg?width=640&auto=webp&s=hash" />
  </entry>
  <entry>
    <title>Preview image only</title>
    <id>preview-image</id>
    <link href="https://www.reddit.com/r/example/comments/preview/" />
    <content type="html"><![CDATA[
      <img src="https://preview.redd.it/preview.jpeg?width=640&auto=webp&s=hash" />
    ]]></content>
  </entry>
</feed>`;

describe('fetchFeed SSRF safety + domain handling', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn();
  });

  test('allows normal public domain hostnames', async () => {
    mockLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    (global.fetch as jest.Mock).mockResolvedValue(
      new Response(RSS_XML, {
        status: 200,
        headers: { 'content-type': 'application/rss+xml' },
      }),
    );

    const result = await fetchFeed(
      {
        sourceType: 'rss',
        url: 'https://hnrss.org/frontpage',
        route: null,
      },
      {
        timeoutMs: 5000,
        maxBodyBytes: 1024 * 1024,
      },
    );

    expect(result.notModified).toBe(false);
    expect(result.items.length).toBeGreaterThan(0);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test('rejects a private literal host address', async () => {
    await expect(
      fetchFeed(
        {
          sourceType: 'rss',
          url: 'http://127.0.0.1/feed.xml',
          route: null,
        },
        {
          timeoutMs: 5000,
          maxBodyBytes: 1024 * 1024,
        },
      ),
    ).rejects.toThrow('Feed URL hostname cannot be an IP address');

    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('rejects domains that resolve to private addresses', async () => {
    mockLookup.mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);

    await expect(
      fetchFeed(
        {
          sourceType: 'rss',
          url: 'https://evil-proxy.example/feed.xml',
          route: null,
        },
        {
          timeoutMs: 5000,
          maxBodyBytes: 1024 * 1024,
        },
      ),
    ).rejects.toThrow('Feed host resolves to a private or loopback address');

    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('rejects redirects to private literal host addresses', async () => {
    mockLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    (global.fetch as jest.Mock).mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { location: 'http://127.0.0.1/feed.xml' },
      }),
    );

    await expect(
      fetchFeed(
        {
          sourceType: 'rss',
          url: 'https://example.com/feed.xml',
          route: null,
        },
        {
          timeoutMs: 5000,
          maxBodyBytes: 1024 * 1024,
        },
      ),
    ).rejects.toThrow('Feed redirect hostname cannot be an IP address');

    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test('decodes HTML entities in feed title and item summary text', async () => {
    mockLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    (global.fetch as jest.Mock).mockResolvedValue(
      new Response(RSS_XML_WITH_ENTITIES, {
        status: 200,
        headers: { 'content-type': 'application/rss+xml' },
      }),
    );

    const result = await fetchFeed(
      {
        sourceType: 'rss',
        url: 'https://example.com/feed.xml',
        route: null,
      },
      {
        timeoutMs: 5000,
        maxBodyBytes: 1024 * 1024,
      },
    );

    expect(result.title).toBe('Example & Feed');
    expect(result.items[0].title).toBe('RT Test & Stuff');
    expect(result.items[0].description).toBe('RT Test & Stuff > survivors complain & killers adapt');
  });

  test('accepts GameBanana feeds that use an items container instead of channel', async () => {
    mockLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    (global.fetch as jest.Mock).mockResolvedValue(
      new Response(GAMEBANANA_RSS_XML, {
        status: 200,
        headers: { 'content-type': 'text/html; charset=UTF-8' },
      }),
    );

    const result = await fetchFeed(
      {
        sourceType: 'rss',
        url: 'https://api.gamebanana.com/Rss/New?gameid=7923',
        route: null,
      },
      {
        timeoutMs: 5000,
        maxBodyBytes: 1024 * 1024,
      },
    );

    expect(result.title).toBe('GameBanana API RSS Feed');
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      title: 'Yolvoria 9 | Modded Island',
      link: 'https://gamebanana.com/mods/702660',
      imageUrl: 'https://images.gamebanana.com/img/ss/mods/example.jpg',
      publishedAt: new Date('2026-08-10T19:22:19.000Z'),
    });
  });

  test('prefers Reddit original images over preview URLs in Atom entries', async () => {
    mockLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    (global.fetch as jest.Mock).mockResolvedValue(
      new Response(REDDIT_ATOM_XML, {
        status: 200,
        headers: { 'content-type': 'application/atom+xml' },
      }),
    );

    const result = await fetchFeed(
      {
        sourceType: 'rss',
        url: 'https://www.reddit.com/r/example/.rss',
        route: null,
      },
      {
        timeoutMs: 5000,
        maxBodyBytes: 1024 * 1024,
      },
    );

    expect(result.items).toHaveLength(2);
    expect(result.items[0]?.imageUrl).toBe('https://i.redd.it/direct.jpeg');
    expect(result.items[1]?.imageUrl).toBe('https://i.redd.it/preview.jpeg');
  });

  test('strips torrentfreak-style markdown image captions and inline refs from descriptions', async () => {
    const torrentFreakXml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>TorrentFreak</title>
    <link>https://torrentfreak.com</link>
    <description>News</description>
    <item>
      <title>Tech Industry Warns of Piracy Blocking Risks as FIFA World Cup Kicks Off</title>
      <link>https://torrentfreak.com/tech-industry-warns-of-piracy-blocking-risks-as-fifa-world-cup-kicks-off/</link>
      <guid>tf-1</guid>
      <description><![CDATA[ballnetblock [https://torrentfreak.com/images/ballnetblock-600x445.jpg]Today, the 2026 FIFA World Cup officially kicked off with roughly $4 billion [https://www.salaryleaks.com/blogs/world-cup-2026-broadcasting-deals-value] in broadcasting rights.]]></description>
    </item>
  </channel>
</rss>`;

    mockLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    (global.fetch as jest.Mock).mockResolvedValue(
      new Response(torrentFreakXml, {
        status: 200,
        headers: { 'content-type': 'application/rss+xml' },
      }),
    );

    const result = await fetchFeed(
      {
        sourceType: 'rss',
        url: 'https://torrentfreak.com/feed/',
        route: null,
      },
      {
        timeoutMs: 5000,
        maxBodyBytes: 1024 * 1024,
      },
    );

    expect(result.items[0].description).toBe(
      'Today, the 2026 FIFA World Cup officially kicked off with roughly $4 billion in broadcasting rights.',
    );
  });
});
