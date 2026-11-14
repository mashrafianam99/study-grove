// Small UI pieces: icons, toasts and the leaf burst for milestones.
import { prefersReducedMotion } from './util.js';

export const icon = (name, cls = '') => `<svg class="ic ${cls}" aria-hidden="true"><use href="#i-${name}"></use></svg>`;

let toastTimer = 0;
export function toast(message, tone = 'info') {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.dataset.tone = tone;
  el.hidden = false;
  el.classList.remove('is-out');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.classList.add('is-out');
    setTimeout(() => { el.hidden = true; }, 250);
  }, 3200);
}

const LEAF_COLORS = ['#6FAE5F', '#4E8F5B', '#F0B44E', '#C3962F', '#9CCB86'];

// A short burst of falling leaves from a point on screen.
export function leafBurst(x = innerWidth / 2, y = innerHeight / 3, count = 36) {
  if (prefersReducedMotion()) return;
  const canvas = document.getElementById('burst');
  const g = canvas.getContext('2d');
  const dpr = Math.min(devicePixelRatio, 2);
  canvas.width = innerWidth * dpr;
  canvas.height = innerHeight * dpr;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const leaves = Array.from({ length: count }, () => {
    const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.4;
    const v = 4 + Math.random() * 6;
    return {
      x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.3,
      s: 5 + Math.random() * 5, c: LEAF_COLORS[Math.floor(Math.random() * LEAF_COLORS.length)],
    };
  });
  const t0 = performance.now();
  function frame(now) {
    const age = (now - t0) / 1800;
    g.clearRect(0, 0, innerWidth, innerHeight);
    if (age >= 1) return;
    g.globalAlpha = 1 - age * age;
    for (const l of leaves) {
      l.vy += 0.22;
      l.vx *= 0.985;
      l.x += l.vx + Math.sin(now / 200 + l.s) * 0.6;
      l.y += l.vy * 0.6;
      l.r += l.vr;
      g.save();
      g.translate(l.x, l.y);
      g.rotate(l.r);
      g.fillStyle = l.c;
      g.beginPath();
      g.ellipse(0, 0, l.s, l.s * 0.45, 0, 0, Math.PI * 2);
      g.fill();
      g.restore();
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
