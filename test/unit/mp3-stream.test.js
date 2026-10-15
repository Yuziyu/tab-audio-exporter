import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Mp3Stream, floatToInt16 } from '../../extension/lib/mp3-stream.js';
import { parseMp3 } from '../helpers/mp3-parse.js';
import { sine } from '../helpers/signals.js';

function encodeAll({ sampleRate, channels, kbps, seconds, chunkSizes }) {
  const left = sine({ freq: 440, sampleRate, seconds });
  const right = sine({ freq: 660, sampleRate, seconds });
  const enc = new Mp3Stream({ sampleRate, channels, kbps });
  const parts = [];
  let i = 0;
  let k = 0;
  while (i < left.length) {
    const size = chunkSizes[k++ % chunkSizes.length];
    const l = left.subarray(i, i + size);
    const r = right.subarray(i, i + size);
    parts.push(...enc.push(l, channels === 2 ? r : undefined));
    i += size;
  }
  parts.push(...enc.finish());
  const total = parts.reduce((n, p) => n + p.length, 0);
  const bytes = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { bytes.set(p, o); o += p.length; }
  return { bytes, enc };
}

test('floatToInt16 clips and scales', () => {
  const out = floatToInt16(Float32Array.from([-2, -1, 0, 0.5, 1, 2]));
  assert.deepEqual(Array.from(out), [-32768, -32768, 0, 16383, 32767, 32767]);
});

// 対応サンプルレート（ブラウザは通常 44100 / 48000）
for (const sampleRate of [32000, 44100, 48000]) {
  test(`192kbps stereo @${sampleRate}Hz: 不規則なチャンク長でも正しい MP3 になる`, () => {
    const seconds = 10;
    // AudioWorklet のブロック(128)の倍数や 1152 の非倍数を混ぜる
    const { bytes } = encodeAll({ sampleRate, channels: 2, kbps: 192, seconds, chunkSizes: [4096, 1000, 128, 5000, 777] });
    const info = parseMp3(bytes);
    assert.equal(info.sampleRate, sampleRate);
    assert.equal(info.bitrateKbps, 192);
    assert.equal(info.channels, 2);
    assert.equal(info.resyncBytes, 0, 'フレームが途切れず連続している');
    assert.ok(info.allSameFormat);
    assert.ok(Math.abs(info.durationSec - seconds) < 0.1, `duration ${info.durationSec}`);
    // CBR 192kbps ≒ 24000 bytes/sec
    assert.ok(Math.abs(bytes.length / seconds - 24000) < 600, `bytes/sec ${bytes.length / seconds}`);
  });
}

test('mono でも動く', () => {
  const { bytes } = encodeAll({ sampleRate: 48000, channels: 1, kbps: 192, seconds: 3, chunkSizes: [4096] });
  const info = parseMp3(bytes);
  assert.equal(info.channels, 1);
  assert.equal(info.resyncBytes, 0);
});

test('チャンク分割しても一括エンコードと同じ長さになる', () => {
  const a = parseMp3(encodeAll({ sampleRate: 48000, channels: 2, kbps: 192, seconds: 5, chunkSizes: [48000 * 5] }).bytes);
  const b = parseMp3(encodeAll({ sampleRate: 48000, channels: 2, kbps: 192, seconds: 5, chunkSizes: [128] }).bytes);
  assert.ok(Math.abs(a.durationSec - b.durationSec) < 0.05);
});

test('finish 後の push はエラー', () => {
  const enc = new Mp3Stream({ sampleRate: 48000 });
  enc.finish();
  assert.throws(() => enc.push(new Float32Array(10)));
});

test('未対応のチャンネル数は拒否', () => {
  assert.throws(() => new Mp3Stream({ sampleRate: 48000, channels: 6 }));
});

// 参考: 対応外のサンプルレートが「無言で壊れた出力」になるかを記録する
test('[調査] 96000Hz のような非対応レートの挙動を確認', () => {
  let result;
  try {
    const { bytes } = encodeAll({ sampleRate: 96000, channels: 2, kbps: 192, seconds: 1, chunkSizes: [4096] });
    const info = parseMp3(bytes);
    result = { threw: false, sampleRate: info.sampleRate, frames: info.frameCount };
  } catch (e) {
    result = { threw: true, message: String(e.message ?? e) };
  }
  console.log('# 96kHz result:', JSON.stringify(result));
  assert.ok(result); // 結果をログに残すだけ（対応方針は結果次第で決める）
});
