import type { Json } from '../types/Json';
import { isObject } from './isObject';

function flatten(obj: Json, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') {
      out[key] = v;
    } else if (isObject(v)) {
      Object.assign(out, flatten(v, key));
    }
  }
  return out;
}

export function flattenLocaleJson(obj: Json) {
  return flatten(obj);
}

export function unflattenLocaleJson(obj: Record<string, string>) {
  const out: Json = {};
  for (const [k, v] of Object.entries(obj)) {
    let head = out;
    const parts = k.split('.');
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (!(part in head)) head[part] = {};
      head = head[part] as Record<string, Json>;
    }
    head[parts[parts.length - 1]] = v;
  }

  return out;
}
