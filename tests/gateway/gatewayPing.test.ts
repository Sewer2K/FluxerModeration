import { getGatewayPing } from '@/utils/gatewayPing';

describe('getGatewayPing', () => {
  test('averages shard ping when manager ping is missing', () => {
    const client = {
      _ws: {
        shards: new Map([
          [0, { ping: 40 }],
          [1, { _ping: 60 }],
        ]),
      },
    };

    expect(getGatewayPing(client as any)).toBe(50);
  });

  test('prefers manager ping when present', () => {
    const client = {
      _ws: {
        ping: 12,
        shards: new Map([[0, { ping: 99 }]]),
      },
    };

    expect(getGatewayPing(client as any)).toBe(12);
  });
});
