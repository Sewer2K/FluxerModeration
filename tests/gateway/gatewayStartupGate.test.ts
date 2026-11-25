import { GatewayStartupGate } from '@/gateway/GatewayStartupGate';

function makeGate(passive = false) {
  const actions = {
    startApplication: jest.fn(),
    startPresenceUpdates: jest.fn(),
    scheduleTempBanExpiries: jest.fn(),
    scheduleGatewayInfo: jest.fn(),
  };
  const gate = new GatewayStartupGate({ passive, ...actions });
  return { actions, gate };
}

describe('GatewayStartupGate', () => {
  test.each([
    {
      name: 'Ready then Resume',
      signal: (gate: GatewayStartupGate) => [gate.onReady(), gate.onResume()],
    },
    {
      name: 'Resume then Ready',
      signal: (gate: GatewayStartupGate) => [gate.onResume(), gate.onReady()],
    },
    {
      name: 'duplicate Resume',
      signal: (gate: GatewayStartupGate) => [gate.onResume(), gate.onResume()],
    },
  ])('$name starts process work once', ({ signal }) => {
    const { actions, gate } = makeGate();

    expect(signal(gate)).toEqual([true, false]);

    expect(gate.isOperational).toBe(true);
    expect(actions.startApplication).toHaveBeenCalledTimes(1);
    expect(actions.startPresenceUpdates).toHaveBeenCalledTimes(1);
    expect(actions.scheduleTempBanExpiries).toHaveBeenCalledTimes(1);
    expect(actions.scheduleGatewayInfo).toHaveBeenCalledTimes(1);
  });

  test('passive mode enables the watchdog without starting application work', () => {
    const { actions, gate } = makeGate(true);

    expect(gate.onResume()).toBe(true);
    expect(gate.onReady()).toBe(false);

    expect(gate.isOperational).toBe(true);
    expect(actions.startApplication).not.toHaveBeenCalled();
    expect(actions.startPresenceUpdates).not.toHaveBeenCalled();
    expect(actions.scheduleTempBanExpiries).not.toHaveBeenCalled();
    expect(actions.scheduleGatewayInfo).toHaveBeenCalledTimes(1);
  });
});
