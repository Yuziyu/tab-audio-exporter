// MediaStream -> (AudioWorklet) -> (Worker: MP3 逐次エンコード) -> Blob
// offscreen document と E2E テストページの両方から使う。chrome.* には依存しない。

/**
 * @param {MediaStream} stream
 * @param {{kbps?:number, passthrough?:boolean, onLevel?:(peak:number)=>void, onError?:(e:Error)=>void}} [opts]
 */
export async function startPipeline(stream, opts = {}) {
  const { kbps = 192, passthrough = true, onLevel, onError } = opts;
  const base = new URL('./', import.meta.url);

  const ctx = new AudioContext({ latencyHint: 'playback' });
  await ctx.audioWorklet.addModule(new URL('pcm-worklet.js', base));
  const src = ctx.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(ctx, 'pcm-capture', {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    channelCount: 2,
    channelCountMode: 'explicit',
    outputChannelCount: [2],
  });
  src.connect(node);
  // 処理が止まらないよう、出力は無音で destination に繋ぐ
  const mute = ctx.createGain();
  mute.gain.value = 0;
  node.connect(mute).connect(ctx.destination);
  // tabCapture するとタブは無音になるため、聞こえ続けるよう destination へ戻す
  if (passthrough) src.connect(ctx.destination);

  const worker = new Worker(new URL('encoder-worker.js', base), { type: 'module' });
  const parts = [];
  const stats = {
    sampleRate: ctx.sampleRate,
    kbps,
    pcmChunksSent: 0,
    pcmChunksEncoded: 0,
    mp3Bytes: 0,
    maxEncodeMs: 0,
    samplesIn: 0,
    startedAt: performance.now(),
  };

  let resolveReady;
  const ready = new Promise((r) => (resolveReady = r));
  let resolveDone;
  const done = new Promise((r) => (resolveDone = r));

  worker.onmessage = (e) => {
    const m = e.data;
    if (m.type === 'ready') resolveReady();
    else if (m.type === 'mp3') {
      for (const c of m.chunks) parts.push(c);
      stats.pcmChunksEncoded = m.encodedChunks;
      stats.mp3Bytes = m.bytesOut;
      stats.maxEncodeMs = Math.max(stats.maxEncodeMs, m.ms);
    } else if (m.type === 'done') {
      for (const c of m.chunks) parts.push(c);
      stats.mp3Bytes = m.bytesOut;
      stats.samplesIn = m.samplesIn;
      resolveDone();
    } else if (m.type === 'error') onError?.(new Error(m.message));
  };
  worker.onerror = (e) => onError?.(new Error(e.message));
  worker.postMessage({ type: 'init', sampleRate: ctx.sampleRate, kbps });
  await ready;

  let resolveFlushed;
  const flushed = new Promise((r) => (resolveFlushed = r));
  node.port.onmessage = (e) => {
    const m = e.data;
    if (m.type === 'pcm') {
      stats.pcmChunksSent++;
      onLevel?.(m.peak);
      worker.postMessage({ type: 'pcm', left: m.left, right: m.right }, [m.left.buffer, m.right.buffer]);
    } else if (m.type === 'flushed') resolveFlushed();
  };

  let stopped = false;
  return {
    stats,
    audioContext: ctx,
    get backlog() {
      return stats.pcmChunksSent - stats.pcmChunksEncoded;
    },
    get elapsedSec() {
      return (performance.now() - stats.startedAt) / 1000;
    },
    /** 録音を止めて MP3 Blob を返す */
    async stop() {
      if (stopped) throw new Error('already stopped');
      stopped = true;
      src.disconnect();
      node.port.postMessage('flush');
      await flushed;
      worker.postMessage({ type: 'finish' });
      await done;
      worker.terminate();
      node.disconnect();
      mute.disconnect();
      await ctx.close();
      for (const t of stream.getTracks()) t.stop();
      const blob = new Blob(parts, { type: 'audio/mpeg' });
      return {
        blob,
        bytes: blob.size,
        durationSec: stats.samplesIn / ctx.sampleRate,
        sampleRate: ctx.sampleRate,
        kbps,
      };
    },
  };
}
