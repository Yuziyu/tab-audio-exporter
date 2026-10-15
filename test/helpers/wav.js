import fs from 'node:fs';

export function writeWav(file, { sampleRate = 48000, seconds = 20, left = 440, right = 660 }) {
  const n = sampleRate * seconds;
  const buf = Buffer.alloc(44 + n * 4);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 4, 4); buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(sampleRate, 24); buf.writeUInt32LE(sampleRate * 4, 28);
  buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) {
    buf.writeInt16LE(Math.round(0.5 * 32767 * Math.sin((2 * Math.PI * left * i) / sampleRate)), 44 + i * 4);
    buf.writeInt16LE(Math.round(0.5 * 32767 * Math.sin((2 * Math.PI * right * i) / sampleRate)), 46 + i * 4);
  }
  fs.writeFileSync(file, buf);
}
