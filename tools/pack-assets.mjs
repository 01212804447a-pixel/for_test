// Упаковка ассетов (текстуры, HDRI, модели) в JS-пакеты base64:
// так игра работает и при открытии index.html двойным щелчком (file://).
import fs from 'node:fs';
import path from 'node:path';

const root = 'assets';
const files = [];
for (const dir of ['tex', 'hdr', 'models']) {
  for (const f of fs.readdirSync(path.join(root, dir)).sort()) files.push(`${dir}/${f}`);
}
fs.mkdirSync('dist/assets', { recursive: true });
for (const f of fs.readdirSync('dist/assets')) fs.unlinkSync(path.join('dist/assets', f));
const LIMIT = 9 * 1024 * 1024;
let chunk = [], size = 0, n = 0;
const names = [];
const flush = () => {
  if (!chunk.length) return;
  const body = chunk.map(([k, v]) => `${JSON.stringify(k)}:${JSON.stringify(v)}`).join(',\n');
  const name = `pack_${n++}.js`;
  fs.writeFileSync(`dist/assets/${name}`, `(window.NEGS_ASSETS=window.NEGS_ASSETS||{});Object.assign(window.NEGS_ASSETS,{\n${body}\n});\n`);
  fs.writeFileSync(`dist/assets/${name.replace('.js', '.json')}`, `{${body}}`);
  names.push(name);
  chunk = []; size = 0;
};
for (const f of files) {
  const b64 = fs.readFileSync(path.join(root, f)).toString('base64');
  if (size + b64.length > LIMIT) flush();
  chunk.push([f, b64]); size += b64.length;
}
flush();
fs.writeFileSync('dist/assets/index.json', JSON.stringify(names));
console.log('пакеты:', names.join(', '), '| файлов:', files.length);

// Вписать пакеты в index.html между маркерами
const html = fs.readFileSync('index.html', 'utf8');
const tags = names.map((n) => `  <script src="dist/assets/${n}"></script>`).join('\n');
const out = html.replace(/<!-- assets -->[\s\S]*?<!-- \/assets -->/, `<!-- assets -->\n${tags}\n  <!-- /assets -->`);
fs.writeFileSync('index.html', out);
