import { cacheMessageForDeleteLog } from './messageLogContent';
import { Message, TextChannel } from '@fluxerjs/core';

// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
type Proto0<MethodName extends string> = { [K in MethodName]: Function };
type Proto1<MethodName extends string> = { [K in `__ccmLogCache_${MethodName}`]?: unknown };
type Proto2<MethodName extends string> = Proto0<MethodName> & Proto1<MethodName>;

function retype<Proto>(proto: Proto) {
  return proto;
}

function patchSendMethod<MethodName extends string>(proto: Proto2<MethodName>, methodName: MethodName): void {
  const original = proto[methodName];
  if (!original || proto[`__ccmLogCache_${methodName}`]) return;

  retype<Proto0<MethodName>>(proto)[methodName] = async function (...args: unknown[]) {
    const sent = await original.apply(this, args);
    if (sent?.guildId) cacheMessageForDeleteLog(sent);
    return sent;
  };
  retype<Proto1<MethodName>>(proto)[`__ccmLogCache_${methodName}`] = true;
}

export function installMessageLogCacheHooks(): void {
  patchSendMethod(Message.prototype, '_send');

  for (const ChannelClass of [
    TextChannel /* more to become applicable if more `send`-supporting channel types are added */,
  ]) {
    patchSendMethod(ChannelClass.prototype, 'send');
  }
}
