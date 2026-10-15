// Side Panel: 開始/停止・状態表示・保存。録音処理自体は offscreen document が行う。
const $ = (id) => document.getElementById(id);
const logEl = $('log');

function log(s) {
  const t = new Date().toLocaleTimeString();
  logEl.textContent += `[${t}] ${s}\n`;
  logEl.scrollTop = logEl.scrollHeight;
}
function fmtTime(sec) {
  const s = Math.floor(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
const fmtKB = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.round(b / 1024)} KB`);

let lastResult = null;

function render(st) {
  const rec = st.status === 'recording';
  const fin = st.status === 'finalizing';
  $('status').textContent = rec ? '録音中' : fin ? 'MP3を確定中…' : '待機中';
  $('status').className = rec ? 'recording' : '';
  $('start').disabled = rec || fin;
  $('stop').disabled = !rec;
  if (rec || fin) $('target').textContent = st.title || '(不明)';
  $('elapsed').textContent = fmtTime(st.elapsedSec ?? 0);
  $('size').textContent = fmtKB(st.mp3Bytes ?? 0);
  $('rate').textContent = st.sampleRate ? `${st.sampleRate} Hz / 192 kbps CBR` : '-';
  $('backlog').textContent = String(st.backlog ?? 0);
  $('maxenc').textContent = st.maxEncodeMs ? `${st.maxEncodeMs.toFixed(1)} ms` : '-';
  $('heap').textContent = st.heapMB != null ? `${st.heapMB} MB` : '-';
  $('error').textContent = st.error ?? '';
  if (st.last && st.last !== lastResult && st.last.url !== lastResult?.url) {
    lastResult = st.last;
    $('result').hidden = false;
    $('resultInfo').textContent = `${st.last.filename} / ${fmtKB(st.last.bytes)} / ${fmtTime(st.last.durationSec)}`;
    $('link').href = st.last.url;
    $('link').download = st.last.filename;
    log(`完了: ${st.last.filename} (${fmtKB(st.last.bytes)}, ${st.last.durationSec.toFixed(1)}s, ${st.last.sampleRate}Hz)`);
  }
  if (!st.last) $('result').hidden = true;
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab;
}
async function refreshTarget() {
  const st = await getStatus();
  if (st?.status === 'recording' || st?.status === 'finalizing') return;
  const tab = await activeTab();
  $('target').textContent = tab ? `${tab.title} (id:${tab.id})` : '-';
}
async function getStatus() {
  try {
    const res = await chrome.runtime.sendMessage({ target: 'offscreen', type: 'getStatus' });
    return res?.ok ? res : null;
  } catch {
    return null; // offscreen がまだ無い = 待機中
  }
}

$('start').addEventListener('click', async () => {
  $('error').textContent = '';
  const tab = await activeTab();
  if (!tab) return log('アクティブなタブが見つかりません');
  log(`開始要求: tab ${tab.id} "${tab.title}"`);
  let streamId;
  try {
    // Side Panel 内のボタン操作で getMediaStreamId が許可されるか
    streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id });
    log('getMediaStreamId: OK（Side Panel のボタンから取得できた）');
  } catch (e) {
    log(`getMediaStreamId: NG -> ${e?.message ?? e}`);
    $('error').textContent = `Side Panel からは開始できませんでした。\n${e?.message ?? e}\n→ ショートカット Alt+Shift+R で開始してください。`;
    return;
  }
  const res = await chrome.runtime.sendMessage({ target: 'background', type: 'start', streamId, title: tab.title });
  if (!res?.ok) {
    log(`start: NG -> ${res?.error}`);
    $('error').textContent = res?.error ?? '開始に失敗しました';
  } else log('録音開始');
});

$('stop').addEventListener('click', async () => {
  log('停止要求');
  const res = await chrome.runtime.sendMessage({ target: 'offscreen', type: 'stop' }).catch((e) => ({ ok: false, error: String(e) }));
  if (!res?.ok) {
    log(`stop: NG -> ${res?.error}`);
    $('error').textContent = res?.error ?? '停止に失敗しました';
  }
});

$('save').addEventListener('click', async () => {
  if (!lastResult) return;
  try {
    const id = await chrome.downloads.download({ url: lastResult.url, filename: lastResult.filename, saveAs: false });
    log(`downloads.download OK (id ${id})`);
  } catch (e) {
    log(`downloads.download NG -> ${e?.message ?? e}（右のリンクから保存してください）`);
  }
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.target !== 'sidepanel') return;
  if (msg.type === 'status') render(msg);
  else if (msg.type === 'level') $('meter').firstElementChild.style.width = `${Math.min(100, Math.round(msg.peak * 100))}%`;
  else if (msg.type === 'error') {
    $('error').textContent = msg.message;
    log(msg.message);
  }
});

chrome.tabs.onActivated.addListener(refreshTarget);
chrome.tabs.onUpdated.addListener((_id, info) => { if (info.title) refreshTarget(); });

(async () => {
  const st = await getStatus();
  if (st) render(st);
  await refreshTarget();
  log('Side Panel 起動');
})();
