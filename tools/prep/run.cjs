// Запуск страницы подготовки ассетов в headless Chromium: node tools/prep/run.cjs <page.html> [outdir]
const { chromium } = require('playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const root = path.resolve(__dirname, '../..');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.glb': 'model/gltf-binary', '.fbx': 'application/octet-stream', '.jpg': 'image/jpeg', '.png': 'image/png', '.hdr': 'application/octet-stream', '.json': 'application/json', '.wasm': 'application/wasm' };
const srv = http.createServer((req, res) => {
  const p = path.join(root, decodeURIComponent(req.url.split('?')[0]));
  if (req.method === 'POST') {
    const chunks = []; req.on('data', (c) => chunks.push(c)); req.on('end', () => {
      const name = decodeURIComponent(req.url.split('?name=')[1]);
      const dest = path.join(root, name); fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, Buffer.concat(chunks)); console.log('записано', name, Buffer.concat(chunks).length); res.end('ok');
    }); return;
  }
  fs.readFile(p, (err, data) => { if (err) { res.statusCode = 404; res.end(); return; } res.setHeader('Content-Type', types[path.extname(p)] || 'application/octet-stream'); res.end(data); });
});
srv.listen(0, async () => {
  const port = srv.address().port;
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const pg = await b.newPage({ viewport: { width: +(process.env.VW || 1000), height: +(process.env.VH || 700) } });
  pg.on('console', (m) => console.log('[page]', m.text()));
  pg.on('pageerror', (e) => console.log('ERR', e.message));
  await pg.goto(`http://localhost:${port}/${process.argv[2]}${process.argv[4] ? '?' + process.argv[4] : ''}`);
  await pg.waitForFunction(() => window.done, null, { timeout: 0 });
  const out = await pg.evaluate(() => window.out);
  if (out !== undefined) console.log(JSON.stringify(out, null, 1));
  if (process.argv[3]) await pg.screenshot({ path: process.argv[3] });
  await b.close(); srv.close();
});
