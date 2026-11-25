import { cpSync, existsSync } from 'fs';
import { join } from 'path';

const root = process.cwd();
const targets = [
  ['src/assets', 'build/assets'],
  ['src/locales', 'build/locales'],
];

for (const [from, to] of targets) {
  const source = join(root, from);
  if (!existsSync(source)) {
    console.error(`Missing build input: ${from}`);
    process.exit(1);
  }
  cpSync(source, join(root, to), { recursive: true });
}
