import { defineConfig } from 'vitepress';

const SITE_TITLE = 'ClaudeCityMod Docs';
const SITE_DESCRIPTION = 'Command reference and setup for ClaudeCityMod on Fluxer.';
const SITE_URL = 'https://docs.claudecitymod.example';

export default defineConfig({
  srcDir: 'src',

  title: 'ClaudeCityMod',
  description: SITE_DESCRIPTION,

  hostname: SITE_URL,

  head: [
    ['link', { rel: 'icon', href: '/favicon.png' }],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:site_name', content: SITE_TITLE }],
    ['meta', { property: 'og:title', content: SITE_TITLE }],
    ['meta', { property: 'og:description', content: SITE_DESCRIPTION }],
    ['meta', { property: 'og:url', content: SITE_URL }],
    ['meta', { property: 'og:image', content: `${SITE_URL}/logo.png` }],
    ['meta', { name: 'twitter:card', content: 'summary' }],
    ['meta', { name: 'twitter:title', content: SITE_TITLE }],
    ['meta', { name: 'twitter:description', content: SITE_DESCRIPTION }],
    ['meta', { name: 'twitter:image', content: `${SITE_URL}/logo.png` }],
  ],

  cleanUrls: true,
  appearance: 'dark',

  themeConfig: {
    logo: '/logo.png',

    nav: [
      { text: 'Home', link: '/' },
      { text: 'Guides', link: '/guides/' },
      { text: 'Commands', link: '/commands/' },
    ],

    search: {
      provider: 'local',
    },

    sidebar: [
      {
        text: 'Introduction',
        items: [{ text: 'Get Started', link: '/get-started' }],
      },
      {
        text: 'Guides',
        items: [
          { text: 'Overview', link: '/guides/' },
          { text: 'Permissions', link: '/guides/permissions' },
          { text: 'Automod', link: '/guides/automod' },
          { text: 'Tickets', link: '/guides/tickets' },
          { text: 'Welcome and goodbye', link: '/guides/welcome-goodbye' },
          { text: 'Verification', link: '/guides/verification' },
          { text: 'Leveling', link: '/guides/leveling' },
          { text: 'Logging', link: '/guides/logging' },
          { text: 'Self-hosting', link: '/guides/self-hosting' },
        ],
      },
      {
        text: 'Commands',
        items: [
          { text: 'Overview', link: '/commands/' },
          {
            text: 'By category',
            collapsed: false,
            items: [
              { text: 'Moderation', link: '/commands/moderation' },
              { text: 'Admin', link: '/commands/admin' },
              { text: 'Info', link: '/commands/info' },
              { text: 'General', link: '/commands/general' },
            ],
          },
        ],
      },
    ],

    outline: {
      level: [2, 3],
    },

    footer: {
      message: 'ClaudeCityMod is a self-hosted bot for Fluxer.',
      copyright: 'ClaudeCityMod',
    },
  },

  markdown: {
    container: {
      dangerLabel: 'DANGER',
    },
  },
});
