// this script can be used to determine if any English translations have been misplaced into other language locales

import fs from 'fs';
import path from 'path';
import {
  flattenLocaleJson as flatten,
  unflattenLocaleJson as unflatten,
  loadJson,
  dumpJson,
  normalizeString,
} from './common';

function main() {
  const localesDir = path.join(process.cwd(), 'src', 'locales');
  const files = fs.readdirSync(localesDir).filter((f) => f.endsWith('.json'));
  if (!files.includes('en.json')) {
    console.error('Missing src/locales/en.json');

    process.exit(1);
  }

  const enPath = path.join(localesDir, 'en.json');
  const enFlat = flatten(loadJson(enPath));

  for (const file of files) {
    const loc = file.replace(/\.json$/, '');
    if (loc === 'en') continue;

    const locPath = path.join(localesDir, file);
    const flat = flatten(loadJson(locPath));

    const flattenedKept = Object.fromEntries(
      Object.entries(flat).filter(([key, value]) => normalizeString(enFlat[key]) !== normalizeString(flat[key])),
    );

    const kept = unflatten(flattenedKept);
    dumpJson(locPath, kept);
  }
}

main();
