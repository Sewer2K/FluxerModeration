// oh yea. im ready. are you ready? im ready to be ready. let me just get ready real quick and then we can get this ready party started. its gonna be so ready, you wont even believe how ready it is. im talking next level ready, like so ready it should be illegal. but its not, because im a responsible bot owner and i know how to be ready without breaking any laws. so get ready, because this bot is about to be the most ready thing youve ever seen. are you ready for it? because im ready to show you what ready really means. just kidding im not ready thanks for reading dickwad

import type { BotEvent } from '@/types';
import { startApplicationOnce } from '@/services/ApplicationBootstrap';
import { enforceGuildLock } from '@/utils/accessControl';

const event: BotEvent = {
  name: 'ready',
  once: true,

  async execute(client) {
    await enforceGuildLock(client);
    startApplicationOnce(client);
  },
};

export default event;
