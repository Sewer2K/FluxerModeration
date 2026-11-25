import fs from 'fs';
import path from 'path';
import { type Json, isObject } from './common';

/** Keep existing locale strings; fill missing keys from en; drop keys not in en. */
function syncFromEn(en: Json, loc: unknown): Json {
  if (typeof en === 'string') {
    return typeof loc === 'string' ? loc : en;
  }
  const out: Record<string, Json> = {};
  for (const [key, enValue] of Object.entries(en)) {
    const locValue = isObject(loc) ? loc[key] : undefined;
    out[key] = syncFromEn(enValue, locValue);
  }
  return out;
}

function main() {
  const localesDir = path.join(process.cwd(), 'src', 'locales');
  const en = JSON.parse(fs.readFileSync(path.join(localesDir, 'en.json'), 'utf-8')) as Json;

  for (const file of fs.readdirSync(localesDir).filter((f) => f.endsWith('.json') && f !== 'en.json')) {
    const filePath = path.join(localesDir, file);
    const loc = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    const synced = syncFromEn(en, loc);
    fs.writeFileSync(filePath, `${JSON.stringify(synced, null, 2)}\n`, 'utf-8');
    console.log(`Synced ${file}`);
  }
}

main();
