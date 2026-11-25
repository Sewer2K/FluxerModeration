import { parseWebhookTarget, validateEmbedPayload, buildEmbedBuilder, parseEmbedColor } from '@/utils/embedPayload';

describe('embedPayload', () => {
  test('validates a minimal embed', () => {
    const result = validateEmbedPayload({ title: 'Hello', description: 'World' });
    expect(result.ok).toBe(true);
  });

  test('rejects empty embed bodies', () => {
    const result = validateEmbedPayload({ color: '#5865f2' });
    expect(result.ok).toBe(false);
  });

  test('parses hex colors', () => {
    expect(parseEmbedColor('#ff00aa')).toBe(0xff00aa);
    expect(parseEmbedColor('5865f2')).toBe(0x5865f2);
  });

  test('builds a fluxer embed builder', () => {
    const embed = buildEmbedBuilder({
      title: 'News',
      description: 'Update',
      color: '#5865f2',
      fields: [{ name: 'Status', value: 'Live', inline: true }],
    });
    const json = embed.toJSON();
    expect(json.title).toBe('News');
    expect(json.fields).toHaveLength(1);
  });

  test('parses fluxer webhook urls', () => {
    expect(
      parseWebhookTarget({
        webhookUrl: 'https://api.fluxer.app/webhooks/123456789012345678/abcdef_token',
      }),
    ).toEqual({ id: '123456789012345678', token: 'abcdef_token' });
  });

  test('parses webhook urls from another Fluxer instance', () => {
    expect(
      parseWebhookTarget({
        webhookUrl: 'https://api.my-fluxer.example/webhooks/123456789012345678/abcdef_token',
      }),
    ).toEqual({ id: '123456789012345678', token: 'abcdef_token' });
  });

  test('parses webhook id and token fields', () => {
    expect(
      parseWebhookTarget({
        webhookId: '123456789012345678',
        webhookToken: 'tok',
      }),
    ).toEqual({ id: '123456789012345678', token: 'tok' });
  });
});
