// E2E: 実際の Chrome 上で「MediaStream -> AudioWorklet -> Worker(MP3) -> Blob」を通しで検証する。
// tabCapture 自体（ユーザー操作が必要）は含まない。録音以降の処理系が実ブラウザで動くことを確認する。
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { parseMp3 } from '../helpers/mp3-parse.js';
import { writeWav } from '../helpers/wav.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');
// 会社管理の Google Chrome は DevTools リモートデバッグがポリシーで禁止されているため、
// Playwright 同梱の Chromium(.browsers/) を使う。CHROME_PATH で別のバイナリも指定可能。
const CHROME = process.env.CHROME_PATH || undefined;
const SECONDS = Number(process.env.E2E_SECONDS ?? 8);
const SOAK_SECONDS = Number(process.env.SOAK_SECONDS ?? 0);


let server, browser, page, tmp, baseUrl;

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tae-e2e-'));
  const wav = path.join(tmp, 'tone.wav');
  writeWav(wav, {});
  server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const file = url.pathname === '/' ? path.join(root, 'test/e2e/harness/index.html') : path.join(root, url.pathname);
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
    const type = file.endsWith('.html') ? 'text/html' : file.endsWith('.js') ? 'text/javascript' : 'application/octet-stream';
    res.writeHead(200, { 'content-type': type });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${server.address().port}/`;
  browser = await chromium.launch({
    ...(CHROME ? { executablePath: CHROME } : {}),
    headless: true,
    args: [
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      `--use-file-for-fake-audio-capture=${wav}`,
      '--autoplay-policy=no-user-gesture-required',
    ],
  });
  const ctx = await browser.newContext({ permissions: ['microphone'] });
  page = await ctx.newPage();
  page.on('crash', () => console.log('# [PAGE CRASH]'));
  page.on('close', () => console.log('# [PAGE CLOSE]'));
  browser.on('disconnected', () => console.log('# [BROWSER DISCONNECTED]'));
  page.on('console', (m) => { if (m.type() === 'error') console.log('# [page error]', m.text()); });
  page.on('pageerror', (e) => console.log('# [pageerror]', e.message));
  await page.goto(baseUrl);
  await page.waitForFunction(() => window.ready === true);
});

after(async () => {
  await browser?.close();
  server?.close();
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
});

test(`${SECONDS}秒録音 -> 192kbps の正しい MP3 になり、中身の音(L=440Hz / R=660Hz)も保たれる`, { timeout: (SECONDS + 60) * 1000 }, async () => {
  const r = await page.evaluate((s) => window.record(s), SECONDS);
  console.log('# result:', JSON.stringify({ ...r, mp3Base64: `(${r.mp3Base64.length} chars)` }));
  assert.deepEqual(r.errors, []);
  assert.ok(r.peakMax > 0.3, `無音ではない (peakMax=${r.peakMax})`);

  const bytes = Buffer.from(r.mp3Base64, 'base64');
  const info = parseMp3(bytes);
  assert.equal(info.bitrateKbps, 192);
  assert.equal(info.channels, 2);
  assert.equal(info.sampleRate, r.sampleRate);
  assert.equal(info.resyncBytes, 0, 'フレームが連続している');
  assert.ok(Math.abs(info.durationSec - SECONDS) < 0.5, `duration ${info.durationSec} vs ${SECONDS}`);
  assert.ok(Math.abs(info.durationSec - r.durationSec) < 0.1, 'MP3の長さと取り込みサンプル数が一致');
  assert.ok(r.backlogBeforeStop <= 3, `エンコードが追いついている (backlog=${r.backlogBeforeStop})`);

  const a = await page.evaluate((b64) => window.analyze(b64), r.mp3Base64);
  console.log('# analyze:', JSON.stringify(a));
  assert.equal(a.channels, 2);
  assert.ok(a.L440 > a.L1000 * 20, `左は440Hzが支配的 (${a.L440} vs ${a.L1000})`);
  assert.ok(a.R660 > a.R1000 * 20, `右は660Hzが支配的 (${a.R660} vs ${a.R1000})`);
  assert.ok(a.L440 > 0.15, `左440Hzのレベルが十分 (${a.L440})`);
});

test('連続して2回録音できる（停止後に再開始）', { timeout: 60000 }, async () => {
  const r = await page.evaluate(() => window.record(3));
  const info = parseMp3(Buffer.from(r.mp3Base64, 'base64'));
  assert.equal(info.resyncBytes, 0);
  assert.ok(Math.abs(info.durationSec - 3) < 0.5);
});

test('[ソーク] 長時間録音の安定性（SOAK_SECONDS 指定時のみ）', { skip: SOAK_SECONDS <= 0, timeout: (SOAK_SECONDS + 120) * 1000 }, async () => {
  const r = await page.evaluate((s) => window.record(s), SOAK_SECONDS);
  const info = parseMp3(Buffer.from(r.mp3Base64, 'base64'));
  console.log('# soak:', JSON.stringify({ sec: SOAK_SECONDS, bytes: r.bytes, dur: info.durationSec, maxEncodeMs: r.maxEncodeMs, backlog: r.backlogBeforeStop }));
  assert.equal(info.resyncBytes, 0);
  assert.ok(Math.abs(info.durationSec - SOAK_SECONDS) < 1);
});
