import BanAppeal from '@/models/BanAppeal';

describe('BanAppeal schema', () => {
  test('keeps one record per guild and user', () => {
    type IndexDefinition = [Record<string, number>, { unique?: boolean }];
    const indexes = BanAppeal.schema.indexes() as IndexDefinition[];
    const uniqueIndex = indexes.find(([fields, options]) => {
      return fields.guildId === 1 && fields.userId === 1 && options?.unique === true;
    });

    expect(uniqueIndex).toBeDefined();
  });

  test('limits appeal history to twenty entries', () => {
    const historyPath = BanAppeal.schema.path('history');
    expect(historyPath.options.validate.validator(new Array(20).fill({}))).toBe(true);
    expect(historyPath.options.validate.validator(new Array(21).fill({}))).toBe(false);
  });
});
