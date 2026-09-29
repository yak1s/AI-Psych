import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

function walk(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

test('service worker precaches every app file', () => {
  const sw = readFileSync('sw.js', 'utf8');
  const files = [...walk('js'), ...walk('css'), ...walk('assets')].filter((f) => !f.endsWith('.map'));
  for (const f of files) assert.ok(sw.includes(`'./${f}'`), `sw.js is missing ${f}`);
});
