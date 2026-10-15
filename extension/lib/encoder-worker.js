// Worker(module): PCM を受け取り、逐次 MP3 エンコードして返す
import { Mp3Stream } from './mp3-stream.js';

let enc = null;
let encodedChunks = 0;

self.onmessage = (e) => {
  const m = e.data;
  try {
    if (m.type === 'init') {
      enc = new Mp3Stream({ sampleRate: m.sampleRate, channels: 2, kbps: m.kbps });
      encodedChunks = 0;
      self.postMessage({ type: 'ready' });
    } else if (m.type === 'pcm') {
      const t0 = performance.now();
      const out = enc.push(m.left, m.right);
      encodedChunks++;
      self.postMessage({ type: 'mp3', chunks: out, encodedChunks, bytesOut: enc.bytesOut, ms: performance.now() - t0 }, out.map((c) => c.buffer));
    } else if (m.type === 'finish') {
      const out = enc.finish();
      self.postMessage({ type: 'done', chunks: out, bytesOut: enc.bytesOut, samplesIn: enc.samplesIn, sampleRate: enc.sampleRate }, out.map((c) => c.buffer));
    }
  } catch (err) {
    self.postMessage({ type: 'error', message: String(err?.stack ?? err) });
  }
};
