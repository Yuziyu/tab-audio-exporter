// Web版: getDisplayMedia(タブ共有+音声) で取得した MediaStream を、共通の録音パイプラインで MP3 化する。
import { startPipeline } from '/lib/capture-pipeline.js';

const $ = (id) => document.getElementById(id);
const logEl = $('log');
const fmtKB = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.round(b / 1024)} KB`);
const fmtTime = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
function log(s) {
  logEl.textContent += `[${new Date().toLocaleTimeString()}] ${s}\n`;
  logEl.scrollTop = logEl.scrollHeight;
}

let pipeline = null;
let stream = null;
let timer = null;
let wakeLock = null;
let state = 'idle'; // idle | recording | finalizing
let lastUrl = null;

function setState(s) {
  state = s;
  $('status').textContent = s === 'recording' ? '録音中' : s === 'finalizing' ? 'MP3を確定中…' : '待機中';
  $('status').className = s === 'recording' ? 'recording' : '';
  $('start').disabled = s !== 'idle';
  $('stop').disabled = s !== 'recording';
  document.title = (s === 'recording' ? '● ' : '') + 'Tab Audio Exporter';
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}
function safeName(s) {
  return (s || 'recording').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 60).trim() || 'recording';
}

function tick() {
  if (!pipeline) return;
  const s = pipeline.stats;
  $('elapsed').textContent = fmtTime(pipeline.elapsedSec);
  $('size').textContent = fmtKB(s.mp3Bytes);
  $('fmt').textContent = `${s.sampleRate} Hz / ${s.kbps} kbps CBR`;
  $('enc').textContent = `${pipeline.backlog} / ${s.maxEncodeMs.toFixed(1)} ms`;
  $('heap').textContent = performance.memory ? `${Math.round(performance.memory.usedJSHeapSize / 1048576)} MB` : '-';
}

async function start() {
  $('error').textContent = '';
  if (lastUrl) { URL.revokeObjectURL(lastUrl); lastUrl = null; }
  $('result').hidden = true;
  try {
    // getDisplayMedia は video が必須。映像は使わないので最小限の負荷にする。
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: 1, displaySurface: 'browser' },
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, suppressLocalAudioPlayback: false },
      selfBrowserSurface: 'exclude',
      systemAudio: 'exclude',
      surfaceSwitching: 'exclude',
    });
  } catch (e) {
    log(`共有がキャンセル/失敗: ${e?.name}: ${e?.message}`);
    $('error').textContent = e?.name === 'NotAllowedError' ? '共有がキャンセルされました。' : `共有に失敗しました: ${e?.message ?? e}`;
    return;
  }
  const audioTracks = stream.getAudioTracks();
  const video = stream.getVideoTracks()[0];
  if (audioTracks.length === 0) {
    for (const t of stream.getTracks()) t.stop();
    log('音声トラックが無い（「タブの音声も共有」が未チェック、または対象が音声非対応）');
    $('error').textContent = '音声が共有されていません。\n共有ダイアログで「Chromeタブ」を選び、「タブの音声も共有」にチェックを入れてください。\n（ウィンドウ/画面共有では macOS は音声を共有できません）';
    return;
  }
  $('target').textContent = video?.label || '(不明)';
  log(`共有開始: "${video?.label}" / audio tracks=${audioTracks.length}`);

  try {
    // タブ共有ではタブの音は共有元でそのまま鳴り続けるため、passthrough は不要
    pipeline = await startPipeline(new MediaStream(audioTracks), {
      kbps: 192,
      passthrough: false,
      onLevel: (p) => { $('meter').firstElementChild.style.width = `${Math.min(100, Math.round(p * 100))}%`; },
      onError: (e) => { log(`pipeline error: ${e.message}`); $('error').textContent = e.message; },
    });
  } catch (e) {
    for (const t of stream.getTracks()) t.stop();
    log(`パイプライン開始失敗: ${e?.stack ?? e}`);
    $('error').textContent = `録音の開始に失敗しました: ${e?.message ?? e}`;
    return;
  }
  // 共有の停止（ブラウザの「共有を停止」ボタン、対象タブを閉じた等）で自動確定
  const onEnded = () => { if (state === 'recording') { log('共有が終了したため録音を確定します'); stop(); } };
  video?.addEventListener('ended', onEnded);
  audioTracks[0].addEventListener('ended', onEnded);

  setState('recording');
  timer = setInterval(tick, 500);
  tick();
  try { wakeLock = await navigator.wakeLock?.request('screen'); } catch { /* 非対応/拒否は無視 */ }
  log('録音開始');
}

async function stop() {
  if (state !== 'recording') return;
  setState('finalizing');
  clearInterval(timer);
  $('meter').firstElementChild.style.width = '0';
  try {
    const p = pipeline;
    const res = await p.stop();
    for (const t of stream?.getTracks() ?? []) t.stop(); // 共有を終了
    tick();
    lastUrl = URL.createObjectURL(res.blob);
    const filename = `${safeName($('name').value)}_${stamp()}.mp3`;
    $('save').href = lastUrl;
    $('save').download = filename;
    $('player').src = lastUrl;
    $('resultInfo').textContent = `${filename} / ${fmtKB(res.bytes)} / ${fmtTime(res.durationSec)} / ${res.sampleRate}Hz`;
    $('result').hidden = false;
    log(`完了: ${filename} (${fmtKB(res.bytes)}, ${res.durationSec.toFixed(1)}s)`);
  } catch (e) {
    log(`停止処理でエラー: ${e?.stack ?? e}`);
    $('error').textContent = `MP3の確定に失敗しました: ${e?.message ?? e}`;
  } finally {
    pipeline = null;
    stream = null;
    try { await wakeLock?.release(); } catch { /* noop */ }
    wakeLock = null;
    setState('idle');
  }
}

$('start').addEventListener('click', start);
$('stop').addEventListener('click', stop);
setState('idle');
log('準備完了');
