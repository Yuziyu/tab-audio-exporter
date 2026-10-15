export function sine({ freq, sampleRate, seconds, amp = 0.5, phase = 0 }) {
  const n = Math.round(sampleRate * seconds);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = amp * Math.sin(2 * Math.PI * freq * (i / sampleRate) + phase);
  return out;
}
