// AudioWorklet: 入力音声(ステレオ)を一定サイズにまとめて Float32 のまま main スレッドへ渡す
const CHUNK = 4096; // 48kHz で約85ms

class PcmCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.left = new Float32Array(CHUNK);
    this.right = new Float32Array(CHUNK);
    this.n = 0;
    this.peak = 0;
    this.port.onmessage = (e) => {
      if (e.data === 'flush') {
        this.emit();
        this.port.postMessage({ type: 'flushed' });
      }
    };
  }

  emit() {
    if (this.n === 0) return;
    const left = this.left.slice(0, this.n);
    const right = this.right.slice(0, this.n);
    this.port.postMessage({ type: 'pcm', left, right, peak: this.peak }, [left.buffer, right.buffer]);
    this.n = 0;
    this.peak = 0;
  }

  process(inputs) {
    const input = inputs[0];
    const l = input?.[0];
    if (!l) return true; // 入力が未接続の間は何もしない
    const r = input[1] ?? l;
    for (let i = 0; i < l.length; i++) {
      this.left[this.n] = l[i];
      this.right[this.n] = r[i];
      const a = Math.max(Math.abs(l[i]), Math.abs(r[i]));
      if (a > this.peak) this.peak = a;
      if (++this.n === CHUNK) this.emit();
    }
    return true;
  }
}

registerProcessor('pcm-capture', PcmCapture);
