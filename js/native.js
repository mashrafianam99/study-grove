// Android-only extras: the live timer notification and exam reminders in the phone calendar.
// The Capacitor bridge only exists inside the Android app; on the web every call here does nothing.
const plugins = window.Capacitor?.Plugins ?? {};
const live = plugins.FocusLive;
const calendar = plugins.ExamCalendar;

const warn = (what) => (err) => { console.warn(`[native] ${what} failed:`, err); return null; };

/* ---------- live timer ---------- */

// Asks once for notification access (Android 13+). Saying no just means no live timer.
export async function askNotifications() {
  if (!live) return;
  const now = await live.checkPermissions().catch(warn('notification check'));
  if (now && now.notifications !== 'granted' && now.notifications !== 'denied') {
    await live.requestPermissions().catch(warn('notification request'));
  }
}

// state: { status, kind, endAt, remainingMs, totalMs, title }. Idle clears the notification.
export function showLive(state) {
  live?.update(state).catch(warn('live update'));
}

// Taps on the notification's Pause / Resume / End buttons while the app is alive.
export function onLiveAction(fn) {
  if (!live) return;
  // On Android, addListener returns a plain handle, not a Promise; calling .catch on it threw
  // and aborted the app's startup, which kept the timer from ever reaching Android.
  Promise.resolve()
    .then(() => live.addListener('action', (e) => fn(e.action)))
    .catch(warn('live listener'));
}

// Starts a timer in the phone's Clock app (island, lock screen and alarm come with it).
// Resolves true when a Clock app took it, false otherwise (then the app's own notification is used).
export async function startClockTimer(seconds, message) {
  if (!live) return false;
  const res = await live.startClockTimer({ seconds, message }).catch(warn('clock timer'));
  return Boolean(res?.started);
}

// Dismisses the Clock timer, or (when the Clock app doesn't allow that, like Xiaomi's) opens its
// timer screen. Resolves { dismissed, opened }.
export async function dismissClockTimer() {
  const res = live ? await live.dismissClockTimer().catch(warn('clock dismiss')) : null;
  return { dismissed: Boolean(res?.dismissed), opened: Boolean(res?.opened) };
}

// What the notification buttons did while the app was closed, if anything.
// Gives up after 2 s: the timer waits for this at startup and must never hang on it.
export async function nativeTimerState() {
  if (!live) return null;
  const timeout = new Promise((resolve) => { setTimeout(() => resolve(null), 2000); });
  return Promise.race([Promise.resolve().then(() => live.getState()).catch(warn('live state')), timeout]);
}

/* ---------- exam calendar ---------- */

// Hands the full exam list to Android, which adds, updates and removes calendar events to match.
// Resolves to 'synced', 'denied' or null (not on Android / failed).
export async function syncExamCalendar(exams) {
  if (!calendar) return null;
  const res = await calendar.sync({ exams }).catch(warn('calendar sync'));
  return res?.status ?? null;
}
