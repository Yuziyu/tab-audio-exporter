// node_modules の lamejs を extension/vendor にコピーする（拡張機能は node_modules を同梱しないため）
import { copyFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'node_modules/@breezystack/lamejs');
const dst = join(root, 'extension/vendor');
mkdirSync(dst, { recursive: true });
copyFileSync(join(src, 'dist/lamejs.js'), join(dst, 'lamejs.js'));
copyFileSync(join(src, 'LICENSE'), join(dst, 'LICENSE-lamejs.txt'));
console.log('vendored lamejs ->', dst);
