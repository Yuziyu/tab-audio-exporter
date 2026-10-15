// 逐次 MP3 エンコーダ。Float32 の PCM を受け取り、MP3 のバイト列を返す。
// ブラウザ（Worker）と Node（テスト）の両方で動くように、DOM/Chrome API には依存しない。
import { Mp3Encoder } from '../vendor/lamejs.js';

// lamejs は 1152 サンプル（MPEG-1 Layer III の1フレーム分）単位で渡すのが推奨
const BLOCK = 1152;

export function floatToInt16(input) {
  const out = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

export class Mp3Stream {
  constructor({ sampleRate, channels = 2, kbps = 192 }) {
    if (channels !== 1 && channels !== 2) throw new Error(`unsupported channels: ${channels}`);
    this.sampleRate = sampleRate;
    this.channels = channels;
    this.kbps = kbps;
    this.encoder = new Mp3Encoder(channels, sampleRate, kbps);
    this.pendingL = new Int16Array(0);
    this.pendingR = new Int16Array(0);
    this.samplesIn = 0;
    this.bytesOut = 0;
    this.finished = false;
  }

  /** @param {Float32Array} left @param {Float32Array} [right] @returns {Uint8Array[]} */
  push(left, right) {
    if (this.finished) throw new Error('already finished');
    this.samplesIn += left.length;
    this.pendingL = concat(this.pendingL, floatToInt16(left));
    if (this.channels === 2) {
      this.pendingR = concat(this.pendingR, floatToInt16(right ?? left));
    }
    const chunks = [];
    let offset = 0;
    while (this.pendingL.length - offset >= BLOCK) {
      const l = this.pendingL.subarray(offset, offset + BLOCK);
      const r = this.channels === 2 ? this.pendingR.subarray(offset, offset + BLOCK) : undefined;
      this.#encode(l, r, chunks);
      offset += BLOCK;
    }
    this.pendingL = this.pendingL.slice(offset);
    if (this.channels === 2) this.pendingR = this.pendingR.slice(offset);
    return chunks;
  }

  /** 残りのサンプルを flush して最後のバイト列を返す */
  finish() {
    if (this.finished) return [];
    this.finished = true;
    const chunks = [];
    if (this.pendingL.length > 0) {
      this.#encode(this.pendingL, this.channels === 2 ? this.pendingR : undefined, chunks);
    }
    const tail = this.encoder.flush();
    if (tail.length > 0) {
      chunks.push(new Uint8Array(tail));
      this.bytesOut += tail.length;
    }
    return chunks;
  }

  #encode(l, r, chunks) {
    const buf = this.channels === 2 ? this.encoder.encodeBuffer(l, r) : this.encoder.encodeBuffer(l);
    if (buf.length > 0) {
      // lamejs は内部バッファを再利用する場合があるのでコピーして返す
      chunks.push(new Uint8Array(buf));
      this.bytesOut += buf.length;
    }
  }
}

function concat(a, b) {
  if (a.length === 0) return b;
  const out = new Int16Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}
