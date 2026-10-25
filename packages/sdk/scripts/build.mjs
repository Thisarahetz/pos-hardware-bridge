// Builds the SDK twice — ES modules (with types) and CommonJS — so it works with
// `import` and `require`, in browsers, bundlers, Node and Electron.
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const tsc = createRequire(import.meta.url).resolve('typescript/bin/tsc');
const run = (...args) => execFileSync(process.execPath, [tsc, ...args], { cwd: root, stdio: 'inherit' });

rmSync(path.join(root, 'dist'), { recursive: true, force: true });
run('-p', 'tsconfig.json');
run('-p', 'tsconfig.cjs.json');
mkdirSync(path.join(root, 'dist/cjs'), { recursive: true });
writeFileSync(path.join(root, 'dist/cjs/package.json'), '{ "type": "commonjs" }\n');
