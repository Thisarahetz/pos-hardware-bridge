// Renders build/icon.png (512px) for the installer and app. Run after `npm run build`.
const fs = require('node:fs');
const path = require('node:path');
const { drawAppIcon, toPng } = require('../dist/main/icon-draw');

const size = 512;
const out = path.join(__dirname, '..', 'build', 'icon.png');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, toPng(drawAppIcon(size), size));
console.log(`wrote ${out}`);
