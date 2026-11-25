import { formatMessageLogContent, truncateMessageLogContent } from '@/utils/messageLogContent';
import type { Message } from '@fluxerjs/core';
import { APIMessageAttachment } from '@fluxerjs/types';

describe('formatMessageLogContent', () => {
  test('returns plain content', () => {
    expect(formatMessageLogContent({ content: 'hello' } as unknown as Message)).toBe('hello');
  });

  test('formats embed-only messages', () => {
    const text = formatMessageLogContent({
      content: '',
      embeds: [{ title: 'Rules', description: 'Be nice.' }],
    } as unknown as Message);
    expect(text).toBe('**Rules**\nBe nice.');
  });

  test('combines content, embeds, and attachments', () => {
    const text = formatMessageLogContent({
      content: 'check this',
      embeds: [{ description: 'more info' }],
      attachments: [{ filename: 'pic.png', url: 'https://example.com/pic.png' } as APIMessageAttachment],
    } as unknown as Message);
    expect(text).toBe('check this\n\nmore info\n\n[pic.png](https://example.com/pic.png)');
  });

  test('returns null when there is nothing to log', () => {
    expect(formatMessageLogContent({ content: '', embeds: [] } as unknown as Message)).toBeNull();
  });
});

describe('truncateMessageLogContent', () => {
  test('truncates long strings', () => {
    const long = 'a'.repeat(1030);
    expect(truncateMessageLogContent(long)).toHaveLength(1024);
    expect(truncateMessageLogContent(long).endsWith('...')).toBe(true);
  });
});
