// Audio inputs. All go through one AnalyserNode; the analysis code reads dB frames from it.
// File playback uses an <audio> element (streams, no full decode); the mic is never routed to the speakers.

export class AudioInput {
  constructor() {
    this.ctx = null; this.analyser = null; this.db = null; this.source = null; this.stream = null; this.mode = 'none';
    this.el = null;
  }
  async ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC({ latencyHint: 'interactive' });
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 2048;
      this.analyser.smoothingTimeConstant = 0;     // onset detection needs the raw frame, scenes smooth for themselves
      this.analyser.minDecibels = -120; this.analyser.maxDecibels = 0;
      this.db = new Float32Array(this.analyser.frequencyBinCount);
    }
    if (this.ctx.state !== 'running') await this.ctx.resume();
  }
  disconnect() {
    if (this.source) { try { this.source.disconnect(); } catch {} this.source = null; }
    if (this.stream) { this.stream.getTracks().forEach(t => t.stop()); this.stream = null; }
    if (this.el) { this.el.pause(); }
  }
  async useFile(file, audioEl) {
    await this.ensure(); this.disconnect();
    this.el = audioEl;
    if (this._url) URL.revokeObjectURL(this._url);
    this._url = URL.createObjectURL(file);
    audioEl.src = this._url;
    if (!this._elSource) this._elSource = this.ctx.createMediaElementSource(audioEl);
    this.source = this._elSource;
    this.source.connect(this.analyser);
    this.analyser.connect(this.ctx.destination);
    await audioEl.play().catch(() => {});          // a click already happened; if play is refused the controls are visible
    this.mode = 'file';
  }
  async useMic() {
    await this.ensure(); this.disconnect();
    try { this.analyser.disconnect(this.ctx.destination); } catch {}
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    this.source = this.ctx.createMediaStreamSource(this.stream);
    this.source.connect(this.analyser);
    this.mode = 'mic';
  }
  stop() { this.disconnect(); this.mode = 'none'; }
  get sampleRate() { return this.ctx ? this.ctx.sampleRate : 48000; }
  frame() { this.analyser.getFloatFrequencyData(this.db); return this.db; }
}
