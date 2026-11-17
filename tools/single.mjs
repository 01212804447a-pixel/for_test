// Сборка однофайловой версии: dist/negs-zapolyarye.html (CSS и JS внутри)
import fs from 'node:fs';

const css = fs.readFileSync('style.css', 'utf8');
const js = fs.readFileSync('dist/game.js', 'utf8').replace(/<\/script/gi, '<\\/script');
const html = `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>N.E.G.S: Заполярье</title>
<style>
${css}
</style>
</head>
<body>
<canvas id="game"></canvas>
<div id="hud"></div>
<div id="ui"></div>
<script>
${js}
</script>
</body>
</html>
`;
fs.writeFileSync('dist/negs-zapolyarye.html', html);
console.log('dist/negs-zapolyarye.html', (html.length / 1024).toFixed(0), 'КБ');
