// Focus timer, rain sound and finishing chime.
// The timer counts against a fixed end time, so it stays correct when the phone sleeps the tab.

const TICK_MS = 250;
const MAX_SESSION_MS = 4 * 60 * 60000; // settings cap focus at 180 min
// ?fast in the URL turns minutes into seconds, for trying the flow quickly.
const SPEED = new URLSearchParams(location.search).has('fast') ? 60 : 1;

export function createTimer({ onTick, onComplete }) {
  let status = 'idle'; // idle | running | paused
  let kind = 'focus'; // focus | break
  let totalMs = 0;
  let endAt = 0;
  let remainingMs = 0;
  let interval = 0;
  let wakeLock = null;
  let wakeWanted = false;
  let wakePending = null;

  // Keep the screen on while a session runs. `wakeWanted` settles races between
  // a request still in flight and a pause/stop that happens before it resolves.
  async function holdScreen(on) {
    wakeWanted = on;
    if (!('wakeLock' in navigator)) return;
    if (on && !wakeLock && !wakePending && !document.hidden) {
      wakePending = navigator.wakeLock.request('screen')
        .then((lock) => {
          wakeLock = lock;
          lock.addEventListener('release', () => { if (wakeLock === lock) wakeLock = null; });
        })
        .catch(() => {}) // not allowed here; the timer still works
        .finally(() => { wakePending = null; });
      await wakePending;
    }
    if (!wakeWanted && wakeLock) {
      const lock = wakeLock;
      wakeLock = null;
      lock.release().catch(() => {});
    }
  }
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && status === 'running') holdScreen(true);
    if (!document.hidden) step();
  });

  const left = () => (status === 'running' ? Math.max(0, endAt - Date.now()) : remainingMs);
  const snapshot = () => ({
    status, kind, endAt, leftMs: left() * SPEED, totalMs: totalMs * SPEED, elapsedMs: (totalMs - left()) * SPEED,
  });

  function step() {
    if (status !== 'running') return;
    if (left() <= 0) {
      const done = snapshot();
      stopInternal();
      onTick?.(snapshot());
      onComplete?.(done);
      return;
    }
    onTick?.(snapshot());
  }

  function stopInternal() {
    clearInterval(interval);
    interval = 0;
    status = 'idle';
    remainingMs = 0;
    holdScreen(false);
  }

  return {
    start(minutes, nextKind = 'focus') {
      kind = nextKind;
      totalMs = (minutes * 60000) / SPEED;
      endAt = Date.now() + totalMs;
      status = 'running';
      clearInterval(interval);
      interval = setInterval(step, TICK_MS);
      holdScreen(true);
      step();
    },
    pause() {
      if (status !== 'running') return;
      remainingMs = left();
      status = 'paused';
      clearInterval(interval);
      holdScreen(false);
      onTick?.(snapshot());
    },
    resume() {
      if (status !== 'paused') return;
      endAt = Date.now() + remainingMs;
      status = 'running';
      interval = setInterval(step, TICK_MS);
      holdScreen(true);
      step();
    },
    // Ends early; returns what had elapsed so the caller can log it.
    stop() {
      const done = snapshot();
      stopInternal();
      onTick?.(snapshot());
      return done;
    },
    get: snapshot,
    // Raw state for saving, so a session survives the app being closed.
    save: () => ({ status, kind, totalMs, endAt, remainingMs }),
    // Picks a saved session back up; if it ended while the app was closed it completes right away.
    restore(s) {
      if (!s || !['running', 'paused'].includes(s.status) || !['focus', 'break'].includes(s.kind)) return;
      const nums = [s.totalMs, s.endAt, s.remainingMs];
      if (!nums.every(Number.isFinite) || s.totalMs <= 0 || s.totalMs > MAX_SESSION_MS) return;
      ({ status, kind, totalMs, endAt } = s);
      remainingMs = Math.min(Math.max(0, s.remainingMs), totalMs);
      clearInterval(interval);
      if (status === 'running') {
        interval = setInterval(step, TICK_MS);
        holdScreen(true);
        step();
      } else onTick?.(snapshot());
    },
  };
}

export function fmtClock(ms) {
  const total = Math.ceil(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/* ---------- sound ---------- */

let audio = null;
const ctx = () => {
  if (!audio) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    audio = Ctx ? new Ctx() : null;
  }
  if (audio?.state === 'suspended') audio.resume();
  return audio;
};

// Phones only allow sound after a tap, so call this from the Start button.
export const primeAudio = () => { ctx(); };

// Soft rain: looping brown noise through a low-pass filter. Must start from a tap.
export function createRainSound() {
  let source = null;
  let gain = null;
  return {
    get on() { return Boolean(source); },
    start() {
      const ac = ctx();
      if (!ac || source) return;
      const length = ac.sampleRate * 3;
      const buffer = ac.createBuffer(2, length, ac.sampleRate);
      for (let ch = 0; ch < 2; ch++) {
        const data = buffer.getChannelData(ch);
        let last = 0;
        for (let i = 0; i < length; i++) {
          last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
          data[i] = last * 3.2;
        }
      }
      source = ac.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      const filter = ac.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 1400;
      gain = ac.createGain();
      gain.gain.setValueAtTime(0, ac.currentTime);
      gain.gain.linearRampToValueAtTime(0.5, ac.currentTime + 1.2);
      source.connect(filter).connect(gain).connect(ac.destination);
      source.start();
    },
    stop() {
      if (!source) return;
      const ac = ctx();
      const s = source;
      const now = ac.currentTime;
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(gain.gain.value, now);
      gain.gain.linearRampToValueAtTime(0, now + 0.6);
      setTimeout(() => s.stop(), 700);
      source = null;
    },
  };
}

export function chime() {
  const ac = ctx();
  if (!ac) return;
  [523.25, 783.99, 1046.5].forEach((freq, i) => {
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    const t = ac.currentTime + i * 0.18;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.18, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.4);
    osc.connect(g).connect(ac.destination);
    osc.start(t);
    osc.stop(t + 1.5);
  });
  navigator.vibrate?.([120, 80, 120]);
}
