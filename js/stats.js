// Derived numbers: streaks, levels, heatmap grid and per-subject totals.
import { addDays, parseKey, dateKey } from './util.js';

const XP_STEP = 50; // level n -> n+1 needs XP_STEP * n * (n + 1) total XP

export function currentStreak(days, today) {
  let key = days[today] > 0 ? today : addDays(today, -1);
  let count = 0;
  while (days[key] > 0) {
    count += 1;
    key = addDays(key, -1);
  }
  return count;
}

export function bestStreak(days) {
  const keys = Object.keys(days).filter((k) => days[k] > 0).sort();
  let best = 0;
  let run = 0;
  let prev = null;
  for (const key of keys) {
    run = prev && addDays(prev, 1) === key ? run + 1 : 1;
    best = Math.max(best, run);
    prev = key;
  }
  return best;
}

export function levelInfo(xp) {
  let level = 1;
  while (xp >= XP_STEP * level * (level + 1)) level += 1;
  const floor = XP_STEP * (level - 1) * level;
  const ceil = XP_STEP * level * (level + 1);
  return { level, into: xp - floor, span: ceil - floor, pct: (xp - floor) / (ceil - floor) };
}

// Columns of 7 days (Monday first), ending with the week that contains today.
export function heatmapWeeks(days, today, weeks = 26) {
  const end = parseKey(today);
  const mondayOffset = (end.getDay() + 6) % 7;
  const start = addDays(today, -mondayOffset - (weeks - 1) * 7);
  const columns = [];
  for (let w = 0; w < weeks; w++) {
    const cells = [];
    for (let d = 0; d < 7; d++) {
      const key = addDays(start, w * 7 + d);
      cells.push({ key, minutes: days[key] ?? 0, future: key > today });
    }
    columns.push(cells);
  }
  return columns;
}

export function heatLevel(minutes) {
  if (minutes <= 0) return 0;
  if (minutes < 30) return 1;
  if (minutes < 60) return 2;
  if (minutes < 120) return 3;
  return 4;
}

export function minutesInRange(days, today, count) {
  let sum = 0;
  for (let i = 0; i < count; i++) sum += days[addDays(today, -i)] ?? 0;
  return sum;
}

export const totalMinutes = (days) => Object.values(days).reduce((a, b) => a + b, 0);

export function minutesBySubject(trees) {
  const out = {};
  for (const t of trees) out[t.subjectId] = (out[t.subjectId] ?? 0) + t.minutes;
  return out;
}

export function greeting(now = new Date()) {
  const h = now.getHours();
  if (h >= 5 && h < 12) return 'Good morning';
  if (h >= 12 && h < 17) return 'Good afternoon';
  if (h >= 17 && h < 22) return 'Good evening';
  return 'Late night study';
}

export const todayKey = () => dateKey();
