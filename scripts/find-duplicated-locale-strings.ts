// can specify a locale code (e.g. `en`) as an argument to this script and it will filter results to only that locale

import fs from 'fs';
import path from 'path';
import { flattenLocaleJson as flatten, loadJson } from './common';

function localeNameFromFileName(fileName: string) {
  return fileName.replace(/\.json$/, '');
}

function main() {
  const localesDir = path.join(process.cwd(), 'src', 'locales');
  const fileNames = fs.readdirSync(localesDir).filter((f) => f.endsWith('.json'));

  const selectedLocale: string | null = process.argv[2] ?? null;
  if (selectedLocale && !fileNames.some((name) => localeNameFromFileName(name) === selectedLocale)) {
    console.error(`Unknown locale: \`${selectedLocale}\``);
    return;
  }

  let totalCount = 0;
  for (const fileName of fileNames) {
    // key is normalised localised value
    // value is all locales that point to it
    const map: Record<string, Array<string>> = {};

    const loc = localeNameFromFileName(fileName);
    if (selectedLocale && selectedLocale !== loc) continue;

    const locPath = path.join(localesDir, fileName);
    const flat = flatten(loadJson(locPath));

    for (const [key, value] of Object.entries(flat)) {
      (map[value] ??= []).push(key);
    }

    let count = 0;
    for (const [value, keys] of Object.entries(map)) {
      if (keys.length <= 1) continue;

      count++;

      console.log(`The \`${loc}\` string:

"\x1b[90m${value}\x1b[0m"

appears in:
${keys.map((key) => `- ${key}`).join('\n')}
`);
    }

    console.log(`Number of duplicates in \`${loc}\`: ${count}`);
    totalCount += count;
  }

  if (!selectedLocale) {
    console.log(`\nNumber of duplicates in project: ${totalCount}`);
  }
}

main();
