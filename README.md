# Tab Audio Exporter

Chrome のタブで鳴っている音を **MP3 (192kbps CBR)** として書き出すツール。
**Web版（`web/`）** と **Chrome拡張版（`extension/`）** の2形態があり、録音〜MP3化の処理（`extension/lib/`）は共通。

| 形態 | 状況 |
|---|---|
| Web版（localhost + 標準のタブ共有） | 拡張機能のインストールが制限された環境（会社管理の Chrome 等）でも動作確認済み。**メイン** |
| 拡張機能版（tabCapture） | 拡張機能のインストールが制限された環境（会社管理の Chrome 等）では「Extension installation is blocked by policy」で読み込めない |

配信形式（MP3/HLS/DASH/MSE/Web Audio 等）に関わらず、ブラウザが再生した後の音をタブ単位で録音する。

- 対象: Chrome のみ / DRM コンテンツは対象外

## クイックスタート（Web版の起動方法）

```sh
# 1. ターミナルでプロジェクトのフォルダへ移動
cd ~/repository/Private/tab-audio-exporter

# 2. 初回のみ: 依存パッケージをインストール
npm install

# 3. サーバを起動（このターミナルは開いたままにする）
npm run web
#   -> Tab Audio Exporter (web): http://localhost:8765/

# 4. Chrome で http://localhost:8765/ を開く
# 5. 終了するときはターミナルで Ctrl+C
```

- 必要なもの: Node.js（動作確認は v24）
- ポートを変えたいとき: `PORT=9000 npm run web`
- 「このアドレスに接続できません」と出たら、サーバ（手順3）が起動していない
- 起動後の使い方は下の「Web版の使い方」を参照

## Web版の使い方

1. Chrome で `http://localhost:8765/` を開く（録音用タブ）
2. 録りたい音のタブを**別のタブ**で開いておく
3. 「録音開始」→ 共有ダイアログで **「Chromeタブ」** → 対象タブを選び、**「タブの音声も共有」にチェック**
4. 音を再生 → 録音用タブに戻って「停止」→「MP3を保存」

- macOS ではシステム音声は共有できない（「Chromeタブ」のみ音声付き）
- 録音中は画面スリープを抑止する（Wake Lock）。長時間録音中は録音用タブを閉じないこと

## 構成

```
web/
  server.mjs          ローカル配信サーバ（/ → web/public、/lib・/vendor → extension/ を共有）
  public/index.html, app.js   Web版UI（getDisplayMedia）
extension/           ← 拡張機能版。Chrome に読み込むフォルダ
  manifest.json
  service-worker.js   Side Panel設定 / offscreen管理 / ショートカット(Alt+Shift+R)
  sidepanel.html/js   UI（開始・停止・状態・保存）
  offscreen.html/js   tabCapture の MediaStream を受け取り録音〜MP3化
  lib/
    capture-pipeline.js  MediaStream -> AudioWorklet -> Worker -> Blob
    pcm-worklet.js       AudioWorklet（PCMを4096サンプルずつ取得）
    encoder-worker.js    Worker（逐次MP3エンコード）
    mp3-stream.js        lamejs ラッパー（Node/ブラウザ共通）
  vendor/lamejs.js    @breezystack/lamejs (LGPL-3.0) のコピー
test/
  unit/   Node: エンコーダ・manifest の検証
  e2e/    実ブラウザ(Playwright同梱Chromium): MediaStream→MP3 を通しで検証
```

## セットアップ

```sh
npm install
npm run vendor           # node_modules の lamejs を extension/vendor にコピー（更新時のみ）
npm run setup:browsers   # E2E用 Chromium を .browsers/ にダウンロード（初回のみ）
```

## テスト

```sh
npm test                 # ユニットテスト（数秒）
npm run test:e2e         # 実ブラウザでの通しテスト（約15秒）
SOAK_SECONDS=600 npm run test:e2e   # 長時間録音（10分）
```

> 会社管理の Google Chrome は DevTools のリモートデバッグがポリシーで禁止されているため、
> E2E は Playwright 同梱の Chromium を使う（`.browsers/`、git管理外）。

## 拡張機能版: Chrome への読み込み方法

1. `chrome://extensions` を開き、右上の「デベロッパーモード」を ON
2. 「パッケージ化されていない拡張機能を読み込む」→ `extension/` を選択
3. 音の鳴っているタブを開き、拡張アイコンをクリック → Side Panel が開く
4. 「● 録音開始」。**エラーになった場合は `Alt+Shift+R` で開始**（`chrome://extensions/shortcuts` で変更可）
5. 「■ 停止」→「MP3を保存」

### 手動で確認する項目（自動テストでは確認できない部分）
| # | 確認項目 | 見る場所 |
|---|---|---|
| ① | Side Panel のボタンで録音を開始できるか（できない場合はショートカットで） | Side Panel のログ `getMediaStreamId: OK / NG` |
| ② | 録音中もタブの音が聞こえ続けるか | 耳で確認 |
| ③ | 保存した MP3 が正しく再生できるか（長さ・音質） | 保存したファイル |
| ④ | 30分〜1時間の録音が安定しているか | Side Panel の「エンコード待ち」「JSヒープ」「最大エンコード時間」 |
