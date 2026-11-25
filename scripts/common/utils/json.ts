import fs from 'fs';
import type { Json } from '../types';

function ensureNewlineEOF(input: string) {
  return input.trim() + '\n';
}

export function loadJson(p: string): Json {
  const raw = fs.readFileSync(p, 'utf-8');
  return JSON.parse(raw);
}

export function dumpJson(p: string, j: Json): void {
  fs.writeFileSync(p, ensureNewlineEOF(JSON.stringify(j, null, 2)), 'utf-8');
}
