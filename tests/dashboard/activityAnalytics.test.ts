import { getActivityViewState, getHeatmapIntensity } from '../../dashboard/src/lib/activityAnalytics';

describe('activity analytics view helpers', () => {
  test('reports loading before empty or populated states', () => {
    expect(getActivityViewState([], [], [], true)).toBe('loading');
    expect(getActivityViewState([], [], [])).toBe('empty');
  });

  test('reports populated activity and scales heatmap intensity', () => {
    expect(
      getActivityViewState(
        [
          {
            date: '2026-09-25',
            messages: 4,
            commands: 1,
            activeMembers: 2,
            joins: 0,
            leaves: 0,
            voiceJoins: 0,
            voiceMinutes: 0,
            moderationActions: 0,
            automodActions: 0,
            tickets: 0,
            reports: 0,
          },
        ],
        [],
        [],
      ),
    ).toBe('populated');
    expect(getHeatmapIntensity(5, 10)).toBe(0.5);
    expect(getHeatmapIntensity(0, 10)).toBe(0);
  });
});
