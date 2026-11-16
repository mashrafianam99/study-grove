// Study Grove: wires state, views, the timer and the 3D grove together.
import * as store from './store.js';
import * as V from './views.js';
import { createTimer, fmtClock, createRainSound, chime, primeAudio } from './timer.js';
import { toast, leafBurst, icon } from './ui.js';
import { dateKey, fmtLong, fmtMinutes, esc, prefersReducedMotion } from './util.js';
import { currentStreak, levelInfo, greeting } from './stats.js';
import { dueReviews, INTERVALS } from './srs.js';
import * as native from './native.js';

const ROUTES = ['today', 'subjects', 'reviews', 'exams', 'stats', 'settings'];
const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
const TIMER_KEY = 'study-grove:timer';
const $ = (sel) => document.querySelector(sel);

const ui = {
  route: 'today',
  selSubject: '',
  selTopic: '',
  duration: null,
  activeSubject: '',
  activeTopic: '',
  pendingBreak: false,
  focusOpen: false,
  confirm: null,
  newColor: null,
  refocus: null,
  animateNext: false,
};

let grove = null;
let lastStatus = 'idle';
const rain = createRainSound();
const timer = createTimer({ onTick: updateClock, onComplete: handleComplete });

/* ---------- rendering ---------- */

function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'system') delete root.dataset.theme;
  else root.dataset.theme = theme;
  const bg = getComputedStyle(root).getPropertyValue('--bg').trim();
  if (bg) $('meta[name="theme-color"]').setAttribute('content', bg);
}

function subline(state, today, due) {
  const studied = state.days[today] ?? 0;
  const parts = [];
  if (due) parts.push(`${due} ${due === 1 ? 'review' : 'reviews'} due`);
  parts.push(studied ? `${fmtMinutes(studied)} studied today` : 'No study yet today. One session lights the lantern');
  return `${parts.join('. ')}.`;
}

function renderChrome(state, today) {
  const due = dueReviews(state.subjects, today).length;
  document.querySelectorAll('[data-route]').forEach((a) => {
    if (a.dataset.route === ui.route) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  document.querySelectorAll('[data-badge="reviews"]').forEach((b) => { b.textContent = due; b.hidden = !due; });
  $('#greeting').textContent = greeting();
  $('#subline').textContent = subline(state, today, due);
  const streak = currentStreak(state.days, today);
  const chip = $('#streak-chip');
  chip.classList.toggle('is-lit', (state.days[today] ?? 0) > 0);
  chip.innerHTML = `${icon('flame')}<b>${streak}</b><span>${streak === 1 ? 'day' : 'days'}</span>`;
  chip.title = `${streak} day streak`;
  const lvl = levelInfo(state.xp);
  $('#level-num').textContent = lvl.level;
  $('#level-bar').style.width = `${(lvl.pct * 100).toFixed(1)}%`;
  $('#level-xp').textContent = `${lvl.into} of ${lvl.span} XP`;
}

function viewFor(state, today) {
  switch (ui.route) {
    case 'subjects': return V.subjectsView(state, ui, today);
    case 'reviews': return V.reviewsView(state, today);
    case 'exams': return V.examsView(state, ui, today);
    case 'stats': return V.statsView(state, today);
    case 'settings': return V.settingsView(state, ui);
    default: return V.todayView(state, today);
  }
}

function syncGrove(state, today) {
  if (!grove) return;
  const colors = Object.fromEntries(state.subjects.map((s) => [s.id, s.color]));
  grove.setTrees(state.trees, colors, { animate: ui.animateNext });
  grove.setStreak(currentStreak(state.days, today), (state.days[today] ?? 0) > 0);
  $('#tree-count').textContent = state.trees.length
    ? `${state.trees.length} ${state.trees.length === 1 ? 'tree' : 'trees'} planted` : 'Finish a session to plant your first tree';
}

// Keep half-typed text when a re-render happens mid-typing (e.g. the timer finishes).
function captureDraft() {
  const el = document.activeElement;
  const form = el?.closest?.('#view form[data-form]');
  if (!form || el.tagName !== 'INPUT' || !el.name || !el.value) return null;
  return { form: form.dataset.form, subject: form.dataset.subject ?? '', name: el.name, value: el.value, caret: el.selectionStart };
}

function restoreDraft(d) {
  if (!d) return;
  const q = (v) => CSS.escape(v);
  const sel = `#view form[data-form="${q(d.form)}"]${d.subject ? `[data-subject="${q(d.subject)}"]` : ''} [name="${q(d.name)}"]`;
  const el = document.querySelector(sel);
  if (!el || ui.refocus) return;
  el.value = d.value;
  el.focus();
  try { el.setSelectionRange(d.caret, d.caret); } catch { /* date inputs have no caret */ }
}

// If a screen ever fails to draw, show a recovery panel instead of a broken app:
// the backup and reset buttons still work because they only need the store.
function render() {
  try {
    renderScreens();
  } catch (err) {
    console.error('Study Grove could not draw this screen', err);
    $('#view').innerHTML = `<section class="card form-card"><h2>Something went wrong drawing this page</h2>
      <p class="sub">Your data is still saved. Export a backup to keep it safe, then try reloading. If it keeps happening, delete all data and import the backup.</p>
      <div class="row"><button class="btn btn-primary" data-action="export">Export backup</button>
      <button class="btn btn-ghost" data-action="recover-reset">Delete all data</button></div></section>`;
  }
}

function renderScreens() {
  const state = store.getState();
  const today = dateKey();
  applyTheme(state.settings.theme);
  renderChrome(state, today);
  const showHero = ui.route === 'today' || ui.focusOpen;
  $('#hero').hidden = !showHero;
  grove?.setActive(showHero);
  renderTimer();
  const draft = captureDraft();
  $('#view').innerHTML = viewFor(state, today);
  restoreDraft(draft);
  const heat = $('.heatmap-wrap');
  if (heat) heat.scrollLeft = heat.scrollWidth; // show the most recent weeks first on narrow screens
  syncGrove(state, today);
  if (ui.refocus) {
    $(ui.refocus)?.focus();
    ui.refocus = null;
  }
}

function renderTimer() {
  const state = store.getState();
  const snap = timer.get();
  lastStatus = snap.status;
  $('#timer-card').innerHTML = V.timerCard(state, snap, ui);
  $('#focus-ui').innerHTML = `${V.timerCard(state, snap, ui)}
    <div class="focus-tools">
      <button class="btn btn-ghost" data-action="toggle-rain" aria-pressed="${rain.on}">${icon('rain')}${rain.on ? 'Rain on' : 'Rain off'}</button>
      <button class="btn btn-ghost" data-action="close-focus">${icon('close')}Leave focus mode</button>
    </div>`;
  updateClock(snap);
}

function updateClock(snap) {
  persistTimer();
  if (snap.status !== lastStatus) {
    renderTimer();
    return;
  }
  const running = snap.status !== 'idle';
  const clock = fmtClock(snap.leftMs);
  const pct = running ? `${((snap.elapsedMs / snap.totalMs) * 100).toFixed(1)}%` : '0%';
  document.querySelectorAll('[data-clock]').forEach((el) => { el.textContent = clock; });
  document.querySelectorAll('[data-progress]').forEach((el) => { el.style.width = pct; });
  const pill = $('#timer-pill');
  pill.hidden = !running || ui.route === 'today';
  pill.querySelector('b').textContent = clock;
  pill.querySelector('span').textContent = snap.kind === 'break' ? 'Break' : 'Focus';
  document.title = running ? `${clock} ${snap.kind === 'break' ? 'Break' : 'Focus'} | Study Grove` : 'Study Grove';
}

/* ---------- focus sessions ---------- */

function groveCenter() {
  const r = $('#grove').getBoundingClientRect();
  return [r.left + r.width / 2, r.top + r.height / 2];
}

function logFocus(minutes, day = dateKey()) {
  const before = levelInfo(store.getState().xp).level;
  ui.animateNext = true;
  store.logSession({ subjectId: ui.activeSubject, topicId: ui.activeTopic, minutes, day });
  ui.animateNext = false;
  const state = store.getState();
  const subject = state.subjects.find((s) => s.id === ui.activeSubject);
  leafBurst(...groveCenter());
  toast(`${fmtMinutes(minutes)} logged${subject ? ` for ${subject.name}` : ''}. A new tree is growing.`, 'good');
  const after = levelInfo(state.xp).level;
  if (after > before) {
    setTimeout(() => {
      toast(`You reached level ${after}.`, 'good');
      leafBurst(...groveCenter(), 70);
    }, 1600);
  }
}

function handleComplete(done) {
  chime();
  if (done.kind === 'focus') {
    ui.pendingBreak = true;
    // Log under the day the timer actually ended, even if the phone froze the tab past midnight.
    logFocus(Math.max(1, Math.round(done.totalMs / 60000)), dateKey(new Date(Math.min(done.endAt, Date.now()))));
  } else {
    toast('Break is over. Ready for the next round?');
  }
  renderTimer();
}

function startFocus() {
  primeAudio();
  native.askNotifications();
  ui.activeSubject = ui.selSubject;
  ui.activeTopic = ui.selTopic;
  ui.pendingBreak = false;
  timer.start(ui.duration ?? store.getState().settings.focus, 'focus');
}

function finishEarly() {
  const snap = timer.stop();
  if (snap.kind !== 'focus') return;
  const minutes = Math.floor(snap.elapsedMs / 60000);
  if (minutes >= 1) {
    ui.pendingBreak = true;
    logFocus(minutes);
    renderTimer();
  } else {
    toast('Sessions shorter than a minute are not saved.');
  }
}

function openFocus() {
  ui.focusOpen = true;
  document.body.classList.add('focus-on');
  $('#focus').hidden = false;
  grove?.setFocus(true);
  document.documentElement.requestFullscreen?.().catch(() => {});
  render();
}

function closeFocus() {
  ui.focusOpen = false;
  document.body.classList.remove('focus-on');
  $('#focus').hidden = true;
  grove?.setFocus(false);
  if (rain.on) rain.stop();
  grove?.setRain(false);
  if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  render();
}

function toggleTimer() {
  const { status } = timer.get();
  if (status === 'running') timer.pause();
  else if (status === 'paused') timer.resume();
  else if (!ui.pendingBreak) startFocus();
}

/* ---------- timer outside the app ---------- */

let savedTimerKey = '';
// The Clock app's timer mirrors a running session: clockEndAt is the end time it was started for.
let clockMode = false;
let clockEndAt = 0;
let timerRestored = false; // until restore runs, an idle timer must not wipe the saved session

// Saves the running session (so closing the app doesn't lose it) and mirrors it to the
// Android notification. Runs on every tick but only does work when the timer state changed.
function persistTimer() {
  if (!timerRestored) return;
  const t = timer.save();
  const key = JSON.stringify(t);
  if (key === savedTimerKey) return;
  savedTimerKey = key;
  const subject = store.getState().subjects.find((s) => s.id === ui.activeSubject);
  const live = { ...t, title: t.kind === 'break' ? 'Break' : (subject?.name ?? 'Focus') };
  mirrorToClock(live);
  try {
    if (t.status === 'idle') localStorage.removeItem(TIMER_KEY);
    else localStorage.setItem(TIMER_KEY, JSON.stringify({ ...t, subject: ui.activeSubject, topic: ui.activeTopic, clockMode, clockEndAt, savedAt: Date.now() }));
  } catch { /* storage blocked: the session just won't survive a restart */ }
  // A running countdown is shown by the Clock app, or by our notification only once the Clock
  // app declined (see mirrorToClock); a paused one only when the Clock app isn't in use.
  if (t.status === 'idle' || (t.status === 'paused' && !clockMode)) native.showLive(live);
}

function mirrorToClock(live) {
  if (live.status === 'running') {
    if (clockEndAt === live.endAt) return; // already running there (also after a restart)
    clockEndAt = live.endAt;
    const seconds = Math.max(1, Math.round((live.endAt - Date.now()) / 1000));
    native.startClockTimer(seconds, `Study Grove: ${live.title}`).then((ok) => {
      if (clockEndAt !== live.endAt) return; // paused or ended meanwhile
      // clockEndAt stays set either way, so a failed attempt isn't retried every tick.
      clockMode = ok;
      if (!ok) native.showLive(live); // no Clock app took it: use Study Grove's own notification
      savedTimerKey = ''; // re-save with the Clock state
      persistTimer();
    });
    return;
  }
  if (!clockEndAt) {
    if (live.status === 'idle') clockMode = false;
    return;
  }
  const wasClock = clockMode;
  const early = clockEndAt > Date.now() + 2000;
  clockEndAt = 0;
  if (live.status === 'idle') clockMode = false;
  if (early && wasClock) {
    const verb = live.status === 'paused' ? 'pause' : 'cancel';
    native.dismissClockTimer().then(({ dismissed, opened }) => {
      if (dismissed) return;
      toast(opened
        ? `Your Clock app is open: ${verb} its timer there too, then come back.`
        : `Also ${verb} the timer in your Clock app.`);
    });
  }
}

async function restoreTimer() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(TIMER_KEY)); } catch { /* corrupt or blocked */ }
  // The notification buttons may have paused, resumed or ended the session while the app was closed.
  const nat = await native.nativeTimerState();
  timerRestored = true;
  // Only Study Grove's own notification has buttons; with the Clock app in charge, ignore it.
  if (nat?.updatedAt && saved && !saved.clockMode && nat.updatedAt > (saved.savedAt ?? 0)) {
    if (nat.status === 'idle' && saved.kind === 'focus' && nat.endedEarlyMs >= 60000) {
      ui.activeSubject = saved.subject ?? '';
      ui.activeTopic = saved.topic ?? '';
      ui.pendingBreak = true;
      logFocus(Math.floor(nat.endedEarlyMs / 60000), dateKey(new Date(nat.updatedAt)));
    }
    saved = nat.status === 'idle' ? null : { ...saved, ...nat };
  }
  if (!saved) { persistTimer(); return; }
  ui.activeSubject = typeof saved.subject === 'string' ? saved.subject : '';
  ui.activeTopic = typeof saved.topic === 'string' ? saved.topic : '';
  clockMode = saved.clockMode === true;
  clockEndAt = Number.isFinite(saved.clockEndAt) ? saved.clockEndAt : 0;
  timer.restore(saved);
  persistTimer();
}

function liveAction(action) {
  if (timer.get().status === 'idle') return; // e.g. already ended by the alarm
  if (action === 'pause') timer.pause();
  else if (action === 'resume') timer.resume();
  else if (action === 'stop') finishEarly();
}

/* ---------- exams in the phone calendar ---------- */

let calendarKey = '';
let calendarWarned = false;

function syncCalendar(state) {
  const exams = state.exams.filter((e) => !e.ex).map((e) => {
    const subject = state.subjects.find((s) => s.id === e.subjectId);
    return { id: e.id, date: e.date, title: subject ? `${subject.name}: ${e.name}` : e.name };
  });
  const key = JSON.stringify(exams);
  if (key === calendarKey) return;
  calendarKey = key;
  native.syncExamCalendar(exams).then((status) => {
    if (status === 'denied' && exams.length && !calendarWarned) {
      calendarWarned = true;
      toast('Calendar access is off, so exams are not added to your calendar. You can allow it in Android settings.', 'warn');
    }
  });
}

/* ---------- actions ---------- */

function downloadBackup() {
  const blob = new Blob([store.exportJSON()], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `study-grove-backup-${dateKey()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast('Backup exported. Keep the file somewhere safe.');
}

const actions = {
  duration: (el) => { ui.duration = Number(el.dataset.min); renderTimer(); },
  'start-focus': startFocus,
  pause: () => timer.pause(),
  resume: () => timer.resume(),
  finish: finishEarly,
  'start-break': () => {
    ui.pendingBreak = false;
    timer.start(store.getState().settings.brk, 'break');
  },
  'skip-break': () => { ui.pendingBreak = false; renderTimer(); },
  'open-focus': openFocus,
  'close-focus': closeFocus,
  'toggle-rain': () => {
    if (rain.on) rain.stop();
    else rain.start();
    grove?.setRain(rain.on);
    renderTimer();
  },
  'toggle-task': (el) => store.toggleTask(el.dataset.id),
  'delete-task': (el) => store.deleteTask(el.dataset.id),
  review: (el) => {
    const ok = el.dataset.ok === '1';
    store.reviewTopic(el.dataset.subject, el.dataset.topic, ok);
    const topic = store.getState().subjects.find((s) => s.id === el.dataset.subject)?.topics.find((t) => t.id === el.dataset.topic);
    if (!ok) toast('No problem. It comes back tomorrow.');
    else if (topic?.mastered) { toast(`${topic.name} is mastered.`, 'good'); leafBurst(); }
    else toast(`Next review in ${INTERVALS[topic?.review?.step ?? 0]} days.`, 'good');
  },
  status: (el) => {
    const { subject, topic, status } = el.dataset;
    store.setTopicStatus(subject, topic, status);
    if (status === 'done') {
      const r = el.getBoundingClientRect();
      leafBurst(r.left + r.width / 2, r.top, 28);
      toast('Topic done. Its first review is tomorrow.', 'good');
    }
  },
  confidence: (el) => {
    const { subject, topic } = el.dataset;
    const value = Number(el.dataset.value);
    const current = store.getState().subjects.find((s) => s.id === subject)?.topics.find((t) => t.id === topic)?.confidence;
    store.setConfidence(subject, topic, current === value ? value - 1 : value);
  },
  'delete-topic': (el) => store.deleteTopic(el.dataset.subject, el.dataset.topic),
  ask: (el) => { ui.confirm = el.dataset.key; render(); },
  'cancel-confirm': () => { ui.confirm = null; render(); },
  'delete-subject': (el) => {
    ui.confirm = null;
    if (ui.selSubject === el.dataset.id) ui.selSubject = '';
    store.deleteSubject(el.dataset.id);
    toast('Subject deleted. Its trees stay on your island.');
  },
  'delete-exam': (el) => { ui.confirm = null; store.deleteExam(el.dataset.id); },
  reset: () => { ui.confirm = null; ui.selSubject = ''; store.resetAll(); toast('All data deleted.'); },
  // Recovery screen: confirm in place (no re-render), since rendering is what failed.
  'recover-reset': (el) => {
    if (el.dataset.armed !== '1') {
      el.dataset.armed = '1';
      el.textContent = 'Tap again to delete everything';
      el.classList.add('btn-danger');
      return;
    }
    actions.reset();
  },
  'pick-color': (el) => {
    ui.newColor = el.dataset.color;
    document.querySelectorAll('.swatch').forEach((s) => {
      const on = s === el;
      s.classList.toggle('is-on', on);
      s.setAttribute('aria-checked', on);
    });
  },
  theme: (el) => store.setSettings({ theme: el.dataset.theme }),
  export: downloadBackup,
  'load-example': () => {
    store.loadExample();
    toast('Example subjects loaded. Clear them any time from Settings.');
    location.hash = '#today';
  },
  'clear-example': () => { ui.selSubject = ''; store.clearExample(); toast('Examples cleared.'); },
};

const forms = {
  task: (data) => {
    const text = data.get('text').trim();
    if (!text) return;
    ui.refocus = '#task-input';
    store.addTask(text);
  },
  topic: (data, form) => {
    const name = data.get('name').trim();
    if (!name) return;
    ui.refocus = `form[data-subject="${CSS.escape(form.dataset.subject)}"] input`;
    store.addTopic(form.dataset.subject, name);
  },
  subject: (data) => {
    const name = data.get('name').trim();
    if (!name) return;
    ui.refocus = 'form[data-form="subject"] input';
    store.addSubject(name, ui.newColor ?? undefined);
    ui.newColor = null;
    toast(`${name} added. Now add its topics.`, 'good');
  },
  exam: (data) => {
    const name = data.get('name').trim();
    const date = data.get('date');
    const subject = data.get('subject');
    if (!name || !subject) return;
    if (!date || date < dateKey()) {
      toast('Pick an exam date from today onwards.', 'warn');
      return;
    }
    store.addExam(subject, name, date);
    toast(`${name} added.`, 'good');
  },
};

/* ---------- tree tooltip ---------- */

function showTree(tree, x, y) {
  const tip = $('#tree-tip');
  if (!tree) { tip.hidden = true; return; }
  const state = store.getState();
  const subject = state.subjects.find((s) => s.id === tree.subjectId);
  const topic = subject?.topics.find((t) => t.id === tree.topicId);
  tip.innerHTML = `<strong>${esc(subject?.name ?? 'Focus session')}${topic ? `: ${esc(topic.name)}` : ''}</strong>
    <span>${fmtMinutes(tree.minutes)} on ${fmtLong(tree.date)}</span>`;
  const panel = $('#grove-panel');
  tip.style.left = `${Math.min(Math.max(x, 110), panel.clientWidth - 110)}px`;
  tip.style.top = `${Math.max(y, 70)}px`;
  tip.hidden = false;
}

/* ---------- events ---------- */

function route() {
  const name = location.hash.slice(1);
  ui.route = ROUTES.includes(name) ? name : 'today';
  document.body.dataset.route = ui.route;
  // The phone settings icon doubles as a close button while settings is open.
  const gear = $('.top-settings');
  gear.href = ui.route === 'settings' ? '#today' : '#settings';
  gear.setAttribute('aria-label', ui.route === 'settings' ? 'Close settings' : 'Settings');
  ui.confirm = null;
  $('#tree-tip').hidden = true;
  render();
  $('#main').scrollIntoView({ block: 'start' });
}

const isTyping = (el) => el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));

function bindEvents() {
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (el) actions[el.dataset.action]?.(el, e);
  });
  document.addEventListener('submit', (e) => {
    const form = e.target.closest('[data-form]');
    if (!form) return;
    e.preventDefault();
    forms[form.dataset.form]?.(new FormData(form), form);
  });
  document.addEventListener('change', (e) => {
    const el = e.target;
    if (el.id === 'sel-subject') { ui.selSubject = el.value; ui.selTopic = ''; renderTimer(); }
    if (el.id === 'sel-topic') ui.selTopic = el.value;
    if (el.id === 'set-focus') store.setSettings({ focus: Math.min(180, Math.max(5, Math.round(Number(el.value) || 25))) });
    if (el.id === 'set-brk') store.setSettings({ brk: Math.min(60, Math.max(1, Math.round(Number(el.value) || 5))) });
    if (el.id === 'import-file' && el.files[0]) {
      const file = el.files[0];
      el.value = '';
      if (file.size > MAX_IMPORT_BYTES) {
        toast('That file is over 5 MB, which is far bigger than any Study Grove backup. Choose the exported .json file.', 'warn');
        return;
      }
      file.text().then((text) => {
        store.importJSON(text);
        toast('Backup imported.', 'good');
      }).catch((err) => toast(err.message, 'warn'));
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (ui.focusOpen) closeFocus();
      $('#tree-tip').hidden = true;
      return;
    }
    if (isTyping(document.activeElement) || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.code === 'Space' && document.activeElement?.tagName !== 'BUTTON') {
      e.preventDefault();
      toggleTimer();
    } else if (e.key === 'n' || e.key === 'N') {
      e.preventDefault();
      if (ui.route !== 'today') location.hash = '#today';
      setTimeout(() => $('#task-input')?.focus(), 0);
    }
  });
  window.addEventListener('hashchange', route);
  // Refresh the date-dependent bits when the app comes back after midnight.
  let lastDay = dateKey();
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && dateKey() !== lastDay) {
      lastDay = dateKey();
      store.rollOverDay(); // carries unfinished tasks to today and re-renders
    }
  });
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyTheme(store.getState().settings.theme));
}

/* ---------- boot ---------- */

// Called by the Android back button (MainActivity). Returns true when the app handled it;
// false lets Android leave the app, like any app on its home tab.
window.studyGroveBack = () => {
  if (ui.focusOpen) { closeFocus(); return true; }
  if (ui.route !== 'today') { location.replace('#today'); return true; }
  return false;
};

function boot() {
  store.subscribe(render);
  store.subscribe(syncCalendar);
  bindEvents();
  route();
  native.onLiveAction(liveAction);
  restoreTimer();
  syncCalendar(store.getState());
  if (!store.canSave()) toast('This browser is blocking storage, so changes will not be saved.', 'warn');
  import('./grove.js')
    .then(({ createGrove }) => {
      grove = createGrove($('#grove'), { onTreeClick: showTree, reducedMotion: prefersReducedMotion() });
      render();
    })
    .catch(() => {
      $('#grove').insertAdjacentHTML('beforeend',
        '<p class="grove-fallback">The 3D grove needs an internet connection the first time it loads. Everything else works.</p>');
    });
  // Offline/install support only on a real HTTPS host. On the local dev server a worker would
  // keep serving old files after edits, so any earlier registration there is removed.
  if ('serviceWorker' in navigator) {
    if (location.protocol === 'https:') {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    } else {
      navigator.serviceWorker.getRegistrations().then((regs) => regs.forEach((r) => r.unregister())).catch(() => {});
    }
  }
}

boot();
