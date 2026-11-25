export function normalizeString(str: string) {
  return str.replaceAll(/[\u2010-\u2015]/g, '-').trim();
}
