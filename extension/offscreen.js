// offscreen document: tabCapture の MediaStream を受け取り、録音〜MP3化を担当する
import { startPipeline } from './lib/capture-pipeline.js';

const state = {
  status: 'idle', // idle | recording | finalizing
  title: '',
  startedAtMs: 0,
  last: null, // { url, bytes, durationSec, filename, sampleRate }
  error: null,
};
let pipeline = null;
let statsTimer = null;
let lastLevelSent = 0;

function broadcast(msg) {
  chrome.runtime.sendMessage({ target: 'sidepanel', ...msg }).catch(() => {});
}

function snapshot() {
  const s = pipeline?.stats;
  return {
    status: state.status,
    title: state.title,
    error: state.error,
    last: state.last,
    elapsedSec: pipeline ? pipeline.elapsedSec : 0,
    mp3Bytes: s?.mp3Bytes ?? 0,
    sampleRate: s?.sampleRate,
    backlog: pipeline ? pipeline.backlog : 0,
    maxEncodeMs: s?.maxEncodeMs ?? 0,
    heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null,
  };
}

function filenameFor(title) {
  const safe = (title || 'tab').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 60).trim() || 'tab';
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${safe}_${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.mp3`;
}

async function start({ streamId, title }) {
  if (state.status !== 'idle') throw new Error(`busy: ${state.status}`);
  if (state.last?.url) URL.revokeObjectURL(state.last.url);
  state.last = null;
  state.error = null;
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } },
    video: false,
  });
  pipeline = await startPipeline(stream, {
    kbps: 192,
    passthrough: true,
    onLevel: (peak) => {
      const now = performance.now();
      if (now - lastLevelSent > 100) {
        lastLevelSent = now;
        broadcast({ type: 'level', peak });
      }
    },
    onError: (e) => {
      state.error = String(e.message ?? e);
      broadcast({ type: 'status', ...snapshot() });
    },
  });
  state.status = 'recording';
  state.title = title ?? '';
  state.startedAtMs = Date.now();
  // タブが閉じられる等でトラックが終了したら自動で確定する
  stream.getAudioTracks()[0].addEventListener('ended', () => {
    if (state.status === 'recording') stop().catch(() => {});
  });
  statsTimer = setInterval(() => {
    const snap = snapshot();
    console.log('[stats]', JSON.stringify({ ...snap, last: undefined }));
    broadcast({ type: 'status', ...snap });
  }, 2000);
  broadcast({ type: 'status', ...snapshot() });
}

async function stop() {
  if (state.status !== 'recording') throw new Error(`not recording: ${state.status}`);
  state.status = 'finalizing';
  broadcast({ type: 'status', ...snapshot() });
  clearInterval(statsTimer);
  try {
    const res = await pipeline.stop();
    const url = URL.createObjectURL(res.blob);
    state.last = {
      url,
      bytes: res.bytes,
      durationSec: res.durationSec,
      sampleRate: res.sampleRate,
      kbps: res.kbps,
      filename: filenameFor(state.title),
    };
  } catch (e) {
    state.error = String(e?.stack ?? e);
  } finally {
    pipeline = null;
    state.status = 'idle';
  }
  broadcast({ type: 'status', ...snapshot() });
  return state.last;
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.target !== 'offscreen') return false;
  (async () => {
    try {
      if (msg.type === 'start') {
        await start(msg);
        sendResponse({ ok: true });
      } else if (msg.type === 'stop') {
        const last = await stop();
        sendResponse({ ok: true, last });
      } else if (msg.type === 'getStatus') {
        sendResponse({ ok: true, ...snapshot() });
      } else sendResponse({ ok: false, error: `unknown type ${msg.type}` });
    } catch (e) {
      state.error = String(e?.message ?? e);
      sendResponse({ ok: false, error: state.error });
    }
  })();
  return true; // 非同期応答
});
