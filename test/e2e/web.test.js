// E2E: Web版の画面操作（開始→停止→保存）を実ブラウザで検証する。
// getDisplayMedia は共有ダイアログが出てしまい自動化できないため、偽の音声入力 + ダミー映像に差し替える。
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { chromium } from 'playwright-core';
import { createServer } from '../../web/server.mjs';
import { parseMp3 } from '../helpers/mp3-parse.js';
import { writeWav } from '../helpers/wav.js';

let server, browser, page, tmp, url;

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tae-web-'));
  const wav = path.join(tmp, 'tone.wav');
  writeWav(wav, {});
  server = createServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  url = `http://127.0.0.1:${server.address().port}/`;
  browser = await chromium.launch({
    headless: true,
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-audio-capture=${wav}`],
  });
  const ctx = await browser.newContext({ permissions: ['microphone'] });
  await ctx.addInitScript(() => {
    window.__mode = 'ok'; // 'ok' | 'noaudio' | 'cancel'
    navigator.mediaDevices.getDisplayMedia = async () => {
      if (window.__mode === 'cancel') throw new DOMException('Permission denied', 'NotAllowedError');
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 16;
      canvas.getContext('2d').fillRect(0, 0, 16, 16);
      const tracks = [...canvas.captureStream(1).getVideoTracks()];
      if (window.__mode === 'ok') {
        const a = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
        tracks.push(...a.getAudioTracks());
      }
      const s = new MediaStream(tracks);
      window.__lastShare = s;
      return s;
    };
  });
  page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('# [pageerror]', e.message));
});

after(async () => {
  await browser?.close();
  server?.close();
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
});

async function savedMp3() {
  const b64 = await page.evaluate(async () => {
    const buf = new Uint8Array(await (await fetch(document.getElementById('save').href)).arrayBuffer());
    let bin = '';
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return btoa(bin);
  });
  return Buffer.from(b64, 'base64');
}

test('配信ファイル(/lib, /vendor, /)が配信される', async () => {
  for (const p of ['', 'app.js', 'lib/capture-pipeline.js', 'lib/pcm-worklet.js', 'vendor/lamejs.js']) {
    const r = await fetch(url + p);
    assert.equal(r.status, 200, p);
  }
  assert.equal((await fetch(url + '../package.json')).status, 404);
  assert.equal((await fetch(url + 'lib/../../package.json')).status, 404);
});

test('開始→停止→MP3保存: UI操作で正しい MP3 が得られる', { timeout: 60000 }, async () => {
  await page.goto(url);
  await page.fill('#name', 'テスト/音声');
  await page.click('#start');
  await page.waitForFunction(() => document.getElementById('status').textContent === '録音中');
  assert.equal(await page.isDisabled('#start'), true);
  await page.waitForTimeout(5000);
  assert.ok((await page.textContent('#size')).includes('KB'));
  await page.click('#stop');
  await page.waitForSelector('#result:not([hidden])');
  assert.equal(await page.textContent('#status'), '待機中');

  const filename = await page.getAttribute('#save', 'download');
  assert.match(filename, /^テスト_音声_\d{8}-\d{6}\.mp3$/, '禁止文字が置換され日時が付く');
  const info = parseMp3(await savedMp3());
  console.log('# web mp3:', JSON.stringify(info));
  assert.equal(info.bitrateKbps, 192);
  assert.equal(info.resyncBytes, 0);
  assert.ok(Math.abs(info.durationSec - 5) < 1, `duration ${info.durationSec}`);
  assert.equal(await page.evaluate(() => window.__lastShare.getTracks().every((t) => t.readyState === 'ended')), true, '停止後は共有が終了している');
});

test('共有の終了(「共有を停止」)で自動的に確定する', { timeout: 60000 }, async () => {
  await page.goto(url);
  await page.click('#start');
  await page.waitForFunction(() => document.getElementById('status').textContent === '録音中');
  await page.waitForTimeout(2500);
  await page.evaluate(() => window.__lastShare.getVideoTracks()[0].dispatchEvent(new Event('ended')));
  await page.waitForSelector('#result:not([hidden])', { timeout: 15000 });
  const info = parseMp3(await savedMp3());
  assert.equal(info.resyncBytes, 0);
  assert.ok(info.durationSec > 2 && info.durationSec < 4.5, `duration ${info.durationSec}`);
});

test('音声が共有されなかった場合は分かりやすいエラーを出す', async () => {
  await page.goto(url);
  await page.evaluate(() => (window.__mode = 'noaudio'));
  await page.click('#start');
  await page.waitForFunction(() => document.getElementById('error').textContent.length > 0);
  assert.match(await page.textContent('#error'), /タブの音声も共有/);
  assert.equal(await page.textContent('#status'), '待機中');
  assert.equal(await page.isDisabled('#start'), false);
});

test('共有ダイアログをキャンセルしても待機状態に戻る', async () => {
  await page.goto(url);
  await page.evaluate(() => (window.__mode = 'cancel'));
  await page.click('#start');
  await page.waitForFunction(() => document.getElementById('error').textContent.length > 0);
  assert.match(await page.textContent('#error'), /キャンセル/);
  assert.equal(await page.isDisabled('#start'), false);
});
