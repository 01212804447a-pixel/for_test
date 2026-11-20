// Метка сборки для журнала игры: коммит, время сборки и хэш исходников (src/version.js).
// По ней можно восстановить ту же сборку и сопоставить позиции в game.js с исходным кодом.
import { execSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const files = [];
(function walk(d) {
  for (const f of readdirSync(d).sort()) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (p.endsWith('.js') && !p.endsWith('version.js')) files.push(p);
  }
})('src');
const h = createHash('sha1');
for (const f of files) h.update(f).update(readFileSync(f));
let commit = 'нет git', dirty = false;
try {
  commit = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  dirty = execSync('git status --porcelain -- src', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim().length > 0;
} catch {}
const build = { commit, dirty, src: h.digest('hex').slice(0, 10), date: new Date().toISOString().slice(0, 16) + 'Z' };
writeFileSync('src/version.js', `// создаётся при сборке (tools/version.mjs): коммит-основа, изменены ли исходники после него, хэш src, время сборки\nexport const BUILD = ${JSON.stringify(build)};\n`);
console.log('сборка', build);
