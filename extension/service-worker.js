// service worker: Side Panel の設定、offscreen document の管理、ショートカットからの録音開始/停止
const OFFSCREEN_URL = 'offscreen.html';

chrome.runtime.onInstalled.addListener(setup);
chrome.runtime.onStartup.addListener(setup);
function setup() {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);
}

async function hasOffscreen() {
  const ctxs = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_URL)],
  });
  return ctxs.length > 0;
}

async function ensureOffscreen() {
  if (await hasOffscreen()) return;
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_URL,
    reasons: ['USER_MEDIA'],
    justification: 'タブの音声(MediaStream)を録音し、MP3にエンコードするため',
  });
}

async function sendToOffscreen(msg, retries = 10) {
  for (let i = 0; ; i++) {
    try {
      const res = await chrome.runtime.sendMessage({ target: 'offscreen', ...msg });
      if (res !== undefined) return res;
      throw new Error('no response');
    } catch (e) {
      if (i >= retries) throw e;
      await new Promise((r) => setTimeout(r, 100)); // offscreen のスクリプト読み込み待ち
    }
  }
}

async function startFromStreamId({ streamId, title }) {
  await ensureOffscreen();
  return sendToOffscreen({ type: 'start', streamId, title });
}

async function isRecording() {
  if (!(await hasOffscreen())) return false;
  const st = await sendToOffscreen({ type: 'getStatus' }, 2).catch(() => null);
  return st?.status === 'recording';
}

// Side Panel からの開始要求（streamId は Side Panel 側で取得したもの）
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.target !== 'background') return false;
  (async () => {
    try {
      if (msg.type === 'start') sendResponse(await startFromStreamId(msg));
      else sendResponse({ ok: false, error: `unknown type ${msg.type}` });
    } catch (e) {
      sendResponse({ ok: false, error: String(e?.message ?? e) });
    }
  })();
  return true;
});

// ショートカット(Alt+Shift+R)でトグル。ユーザー操作として activeTab が付与される想定
chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command !== 'toggle-recording') return;
  try {
    if (await isRecording()) {
      await sendToOffscreen({ type: 'stop' });
      return;
    }
    const target = tab ?? (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0];
    const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: target.id });
    await startFromStreamId({ streamId, title: target.title });
  } catch (e) {
    console.error('[command] failed', e);
    chrome.runtime.sendMessage({ target: 'sidepanel', type: 'error', message: `ショートカット失敗: ${e?.message ?? e}` }).catch(() => {});
  }
});
