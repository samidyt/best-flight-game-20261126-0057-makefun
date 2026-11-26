// Synthesised sound: no audio files. A little prop engine (two detuned
// oscillators through a low-pass filter), wind noise that grows with speed,
// and short chimes for rings, landings and crashes.
export function createAudio() {
  let ctx = null;
  let engineOsc = null;
  let engineOsc2 = null;
  let engineGain = null;
  let engineFilter = null;
  let windSource = null;
  let windGain = null;
  let windFilter = null;
  let muted = false;
  let started = false;

  function ensure() {
    if (ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    engineOsc = ctx.createOscillator();
    engineOsc.type = 'sawtooth';
    engineOsc2 = ctx.createOscillator();
    engineOsc2.type = 'square';
    engineFilter = ctx.createBiquadFilter();
    engineFilter.type = 'lowpass';
    engineFilter.frequency.value = 420;
    engineGain = ctx.createGain();
    engineGain.gain.value = 0;
    engineOsc.connect(engineFilter);
    engineOsc2.connect(engineFilter);
    engineFilter.connect(engineGain);
    engineGain.connect(ctx.destination);
    engineOsc.start();
    engineOsc2.start();
    // Wind: looped noise through a band-pass filter.
    const len = ctx.sampleRate * 2;
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i += 1) data[i] = Math.random() * 2 - 1;
    windSource = ctx.createBufferSource();
    windSource.buffer = buffer;
    windSource.loop = true;
    windFilter = ctx.createBiquadFilter();
    windFilter.type = 'bandpass';
    windFilter.frequency.value = 700;
    windFilter.Q.value = 0.6;
    windGain = ctx.createGain();
    windGain.gain.value = 0;
    windSource.connect(windFilter);
    windFilter.connect(windGain);
    windGain.connect(ctx.destination);
    windSource.start();
    started = true;
  }

  function resume() {
    ensure();
    if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
  }

  // Call every frame while flying: engine pitch follows throttle, wind
  // follows airspeed. Silent when muted or before the first user gesture.
  function update(throttle, speed, flying) {
    if (!started || muted || !ctx) return;
    const t = ctx.currentTime;
    const rpm = 55 + throttle * 75 + speed * 0.12;
    engineOsc.frequency.setTargetAtTime(rpm, t, 0.08);
    engineOsc2.frequency.setTargetAtTime(rpm * 1.5 + 3, t, 0.08);
    engineFilter.frequency.setTargetAtTime(320 + throttle * 900, t, 0.1);
    engineGain.gain.setTargetAtTime(flying ? 0.045 + throttle * 0.05 : 0, t, 0.1);
    windFilter.frequency.setTargetAtTime(400 + speed * 14, t, 0.1);
    windGain.gain.setTargetAtTime(flying ? Math.min(0.12, speed * 0.0016) : 0, t, 0.15);
  }

  function blip(freq, dur, type, vol, when = 0) {
    if (!ctx || muted) return;
    const t = ctx.currentTime + when;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  function ring() {
    blip(880, 0.18, 'sine', 0.22);
    blip(1318, 0.28, 'sine', 0.18, 0.09);
  }

  function thud() {
    if (!ctx || muted) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(120, t);
    osc.frequency.exponentialRampToValueAtTime(45, t + 0.22);
    gain.gain.setValueAtTime(0.5, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.32);
  }

  function crash() {
    if (!ctx || muted) return;
    const t = ctx.currentTime;
    const len = ctx.sampleRate * 0.5;
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 900;
    const gain = ctx.createGain();
    gain.gain.value = 0.5;
    src.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    src.start(t);
  }

  function click() {
    blip(660, 0.07, 'triangle', 0.12);
  }

  function setMuted(value) {
    muted = value;
    if (ctx) {
      const t = ctx.currentTime;
      if (engineGain) engineGain.gain.setTargetAtTime(0, t, 0.05);
      if (windGain) windGain.gain.setTargetAtTime(0, t, 0.05);
    }
  }

  return { resume, update, ring, thud, crash, click, setMuted, get muted() { return muted; } };
}
