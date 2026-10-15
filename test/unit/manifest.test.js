import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ext = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../extension');
const manifest = JSON.parse(fs.readFileSync(path.join(ext, 'manifest.json'), 'utf8'));

test('manifest が参照するファイルが全て存在する', () => {
  const refs = [manifest.background.service_worker, manifest.side_panel.default_path];
  for (const r of refs) assert.ok(fs.existsSync(path.join(ext, r)), r);
});

test('必要な権限が宣言されている', () => {
  for (const p of ['tabCapture', 'offscreen', 'sidePanel', 'activeTab', 'downloads']) {
    assert.ok(manifest.permissions.includes(p), p);
  }
  assert.equal(manifest.manifest_version, 3);
});

test('拡張内の相対 import / リソースが解決できる', () => {
  const files = ['service-worker.js', 'sidepanel.js', 'offscreen.js', 'lib/capture-pipeline.js', 'lib/encoder-worker.js', 'lib/mp3-stream.js'];
  for (const f of files) {
    const src = fs.readFileSync(path.join(ext, f), 'utf8');
    for (const m of src.matchAll(/(?:from\s+|import\s+)['"](\.[^'"]+)['"]/g)) {
      assert.ok(fs.existsSync(path.resolve(ext, path.dirname(f), m[1])), `${f} -> ${m[1]}`);
    }
  }
  for (const f of ['lib/pcm-worklet.js', 'lib/encoder-worker.js', 'vendor/lamejs.js', 'offscreen.html', 'sidepanel.html']) {
    assert.ok(fs.existsSync(path.join(ext, f)), f);
  }
});

test('HTML が参照するスクリプトが存在する', () => {
  for (const html of ['offscreen.html', 'sidepanel.html']) {
    const src = fs.readFileSync(path.join(ext, html), 'utf8');
    for (const m of src.matchAll(/<script[^>]*src="([^"]+)"/g)) {
      assert.ok(fs.existsSync(path.join(ext, m[1])), `${html} -> ${m[1]}`);
    }
  }
});
