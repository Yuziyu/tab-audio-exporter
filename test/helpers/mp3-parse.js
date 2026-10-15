// MP3 のフレームを走査して整合性を検証する簡易パーサ（ffprobe が無い環境でも検証できるようにする）
const BITRATES_V1_L3 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const BITRATES_V2_L3 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
const RATES = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };

export function parseMp3(bytes) {
  let pos = 0;
  if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
    pos = 10 + ((bytes[6] << 21) | (bytes[7] << 14) | (bytes[8] << 7) | bytes[9]);
  }
  const frames = [];
  let broken = 0;
  while (pos + 4 <= bytes.length) {
    const h = parseHeader(bytes, pos);
    if (!h) { broken++; pos++; continue; }
    if (pos + h.length > bytes.length) break; // 末尾の不完全フレーム
    frames.push(h);
    pos += h.length;
  }
  const first = frames[0];
  const samples = frames.reduce((n, f) => n + f.samplesPerFrame, 0);
  return {
    frameCount: frames.length,
    resyncBytes: broken, // 0 なら全フレームが連続して正しく繋がっている
    sampleRate: first?.sampleRate,
    bitrateKbps: first?.bitrateKbps,
    channels: first?.channels,
    mpegVersion: first?.version,
    durationSec: first ? samples / first.sampleRate : 0,
    allSameFormat: frames.every((f) => f.sampleRate === first.sampleRate && f.bitrateKbps === first.bitrateKbps),
  };
}

function parseHeader(b, p) {
  if (b[p] !== 0xff || (b[p + 1] & 0xe0) !== 0xe0) return null;
  const version = (b[p + 1] >> 3) & 3; // 3=MPEG1, 2=MPEG2, 0=MPEG2.5
  const layer = (b[p + 1] >> 1) & 3; // 1=Layer III
  if (version === 1 || layer !== 1) return null;
  const brIdx = (b[p + 2] >> 4) & 15;
  const srIdx = (b[p + 2] >> 2) & 3;
  const padding = (b[p + 2] >> 1) & 1;
  if (brIdx === 0 || brIdx === 15 || srIdx === 3) return null;
  const bitrateKbps = (version === 3 ? BITRATES_V1_L3 : BITRATES_V2_L3)[brIdx];
  const sampleRate = RATES[version][srIdx];
  const samplesPerFrame = version === 3 ? 1152 : 576;
  const length = Math.floor(((version === 3 ? 144 : 72) * bitrateKbps * 1000) / sampleRate) + padding;
  const channels = ((b[p + 3] >> 6) & 3) === 3 ? 1 : 2;
  return { version, bitrateKbps, sampleRate, samplesPerFrame, length, channels };
}
