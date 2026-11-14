// Screen templates. Each returns an HTML string built from state; all user text goes through esc().
import { esc, fmtLong, fmtMinutes, plural, daysBetween, addDays, parseKey } from './util.js';
import { allReviews, dueReviews, INTERVALS } from './srs.js';
import {
  currentStreak, bestStreak, levelInfo, heatmapWeeks, heatLevel, minutesInRange, totalMinutes, minutesBySubject,
} from './stats.js';
import { SUBJECT_COLORS } from './store.js';
import { icon } from './ui.js';
import { fmtClock } from './timer.js';

const STATUS_LABELS = { todo: 'To do', learning: 'Learning', done: 'Done' };
const DURATIONS = [25, 50, 90];

const subjectById = (state, id) => state.subjects.find((s) => s.id === id);
const dot = (color) => `<span class="dot" style="--c:${esc(color)}"></span>`;

function ring(done, total, color, size = 44) {
  const r = 17;
  const c = 2 * Math.PI * r;
  const pct = total ? done / total : 0;
  return `<svg class="ring" width="${size}" height="${size}" viewBox="0 0 44 44" aria-hidden="true">
    <circle cx="22" cy="22" r="${r}" class="ring-track"></circle>
    <circle cx="22" cy="22" r="${r}" class="ring-fill" style="stroke:${esc(color)}"
      stroke-dasharray="${(pct * c).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 22 22)"></circle>
    <text x="22" y="26" text-anchor="middle" class="ring-text">${Math.round(pct * 100)}</text></svg>`;
}

function whenLabel(inDays) {
  if (inDays < -1) return `${-inDays} days late`;
  if (inDays === -1) return '1 day late';
  if (inDays === 0) return 'Due today';
  if (inDays === 1) return 'Tomorrow';
  return `In ${inDays} days`;
}

/* ---------- timer card (hero, right of the grove) ---------- */

export function timerCard(state, snap, ui) {
  if (ui.pendingBreak) {
    return `<div class="timer-done">
      <h2 class="timer-title">Session logged</h2>
      <p class="muted">A new tree is growing on your island. Take a short break before the next round.</p>
      <div class="timer-actions">
        <button class="btn btn-primary" data-action="start-break">Start ${state.settings.brk} min break</button>
        <button class="btn btn-ghost" data-action="skip-break">Skip break</button>
      </div></div>`;
  }
  if (snap.status !== 'idle') {
    const subject = subjectById(state, ui.activeSubject);
    const topic = subject?.topics.find((t) => t.id === ui.activeTopic);
    const label = snap.kind === 'break' ? 'Break' : subject ? `${subject.name}${topic ? `: ${topic.name}` : ''}` : 'Focus';
    const paused = snap.status === 'paused';
    return `<div class="timer-live" data-kind="${snap.kind}">
      <p class="timer-label">${subject && snap.kind === 'focus' ? dot(subject.color) : ''}${esc(label)}</p>
      <div class="digits" data-clock>${fmtClock(snap.leftMs)}</div>
      <div class="bar"><span data-progress style="width:${((snap.elapsedMs / snap.totalMs) * 100).toFixed(1)}%"></span></div>
      <div class="timer-actions">
        <button class="btn btn-primary" data-action="${paused ? 'resume' : 'pause'}">${icon(paused ? 'play' : 'pause')}${paused ? 'Resume' : 'Pause'}</button>
        <button class="btn btn-ghost" data-action="finish">${snap.kind === 'break' ? 'End break' : 'Finish now'}</button>
        <button class="btn btn-icon" data-action="open-focus" aria-label="Open focus mode" title="Focus mode">${icon('expand')}</button>
      </div></div>`;
  }
  const subject = subjectById(state, ui.selSubject);
  const topics = subject?.topics.filter((t) => t.status !== 'done') ?? [];
  const duration = ui.duration ?? state.settings.focus;
  const choices = DURATIONS.includes(state.settings.focus) ? DURATIONS : [state.settings.focus, ...DURATIONS];
  return `<div class="timer-idle">
    <h2 class="timer-title">Focus session</h2>
    <label class="field"><span>Subject</span>
      <select id="sel-subject">
        <option value="">No subject</option>
        ${state.subjects.map((s) => `<option value="${s.id}" ${s.id === ui.selSubject ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}
      </select></label>
    <label class="field"><span>Topic</span>
      <select id="sel-topic" ${subject ? '' : 'disabled'}>
        <option value="">Any topic</option>
        ${topics.map((t) => `<option value="${t.id}" ${t.id === ui.selTopic ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}
      </select></label>
    <div class="durations" role="group" aria-label="Session length">
      ${choices.map((m) => `<button class="chip ${m === duration ? 'is-on' : ''}" data-action="duration" data-min="${m}" aria-pressed="${m === duration}">${m} min</button>`).join('')}
    </div>
    <button class="btn btn-primary btn-big" data-action="start-focus">${icon('play')}Start focus</button>
    <p class="hint">Press <kbd>Space</kbd> to start or pause</p>
  </div>`;
}

/* ---------- today ---------- */

function welcomeCard() {
  return `<section class="card welcome">
    <h2>Plant your first tree</h2>
    <p>Add a subject you're studying, then run a focus session. Each finished session grows a tree on your island.</p>
    <div class="row">
      <a class="btn btn-primary" href="#subjects">Add a subject</a>
      <button class="btn btn-ghost" data-action="load-example">Start with example subjects</button>
    </div></section>`;
}

function exampleNote() {
  return `<div class="note">You're looking at example data. Clear it when you're ready to add your own.
    <button class="btn btn-small btn-ghost" data-action="clear-example">Clear examples</button></div>`;
}

function tasksCard(state, today) {
  const tasks = state.tasks.filter((t) => t.date === today);
  const done = tasks.filter((t) => t.done).length;
  return `<section class="card">
    <header class="card-head"><h2>Today's plan</h2>${tasks.length ? `<span class="meta">${done} of ${tasks.length} done</span>` : ''}</header>
    <form class="inline-add" data-form="task">
      <input id="task-input" name="text" maxlength="140" autocomplete="off" placeholder="Add a task (press N)" aria-label="New task">
      <button class="btn btn-icon" aria-label="Add task">${icon('plus')}</button>
    </form>
    ${tasks.length ? `<ul class="list">${tasks.map((t) => `
      <li class="task ${t.done ? 'is-done' : ''}">
        <button class="check" data-action="toggle-task" data-id="${t.id}" aria-pressed="${t.done}" aria-label="${t.done ? 'Mark not done' : 'Mark done'}">${icon('check')}</button>
        <span class="task-text">${esc(t.text)}</span>
        <button class="btn-icon subtle" data-action="delete-task" data-id="${t.id}" aria-label="Delete task">${icon('trash')}</button>
      </li>`).join('')}</ul>` : '<p class="empty">Nothing planned yet. Add the first thing you want to finish today.</p>'}
  </section>`;
}

function reviewRow({ subject, topic, inDays }) {
  return `<li class="review">
    <div class="review-main">${dot(subject.color)}<div><strong>${esc(topic.name)}</strong>
      <span class="sub">${esc(subject.name)}, ${whenLabel(inDays)}</span></div></div>
    <div class="review-actions">
      <button class="btn btn-small btn-good" data-action="review" data-ok="1" data-subject="${subject.id}" data-topic="${topic.id}">Remembered</button>
      <button class="btn btn-small btn-ghost" data-action="review" data-ok="0" data-subject="${subject.id}" data-topic="${topic.id}">Shaky</button>
    </div></li>`;
}

function reviewsCard(state, today) {
  const due = dueReviews(state.subjects, today);
  return `<section class="card">
    <header class="card-head"><h2>Reviews due</h2>${due.length ? `<span class="badge">${due.length}</span>` : ''}</header>
    ${due.length ? `<ul class="list">${due.slice(0, 5).map(reviewRow).join('')}</ul>
      ${due.length > 5 ? `<a class="more" href="#reviews">See all ${due.length} reviews</a>` : ''}`
      : `<p class="empty">No reviews due. Topics you mark done come back here after ${INTERVALS.slice(0, 3).join(', ')} days and longer.</p>`}
  </section>`;
}

function examStats(state, exam, today) {
  const subject = subjectById(state, exam.subjectId);
  const left = subject ? subject.topics.filter((t) => t.status !== 'done').length : 0;
  const days = daysBetween(today, exam.date);
  const perDay = days > 0 ? left / days : left;
  let target = 'All topics done. Keep reviewing.';
  if (left) target = perDay >= 1 ? `About ${Math.ceil(perDay)} topics a day` : `One topic every ${Math.max(1, Math.floor(1 / perDay))} days`;
  return { subject, left, days, target };
}

function examsCard(state, today) {
  const upcoming = state.exams.filter((e) => e.date >= today).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 3);
  return `<section class="card">
    <header class="card-head"><h2>Exams</h2><a class="meta link" href="#exams">Manage</a></header>
    ${upcoming.length ? `<ul class="list">${upcoming.map((e) => {
      const { subject, days, target } = examStats(state, e, today);
      return `<li class="exam-row"><div class="countdown" style="--c:${esc(subject?.color ?? 'var(--moss)')}"><b>${days}</b><span>${days === 1 ? 'day' : 'days'}</span></div>
        <div><strong>${esc(e.name)}</strong><span class="sub">${fmtLong(e.date)}. ${target}</span></div></li>`;
    }).join('')}</ul>` : '<p class="empty">No exams yet. <a href="#exams">Add one</a> to see a countdown and a daily target.</p>'}
  </section>`;
}

export function todayView(state, today) {
  return `${state.example ? exampleNote() : ''}
    ${state.subjects.length ? '' : welcomeCard()}
    <div class="today-grid">${tasksCard(state, today)}${reviewsCard(state, today)}${examsCard(state, today)}</div>`;
}

/* ---------- subjects ---------- */

function topicRow(subject, topic, today) {
  const review = topic.mastered ? '<span class="tag tag-good">Mastered</span>'
    : topic.review ? `<span class="tag">Review ${whenLabel(daysBetween(today, topic.review.due)).toLowerCase()}</span>` : '';
  return `<li class="topic">
    <span class="topic-name">${esc(topic.name)}</span>${review}
    <div class="seg" role="group" aria-label="Status of ${esc(topic.name)}">
      ${Object.entries(STATUS_LABELS).map(([k, label]) => `<button data-action="status" data-subject="${subject.id}" data-topic="${topic.id}" data-status="${k}" aria-pressed="${topic.status === k}">${label}</button>`).join('')}
    </div>
    <div class="confidence" role="group" aria-label="How sure you feel">
      ${[1, 2, 3, 4, 5].map((n) => `<button data-action="confidence" data-subject="${subject.id}" data-topic="${topic.id}" data-value="${n}" class="${n <= topic.confidence ? 'is-on' : ''}" aria-label="Confidence ${n} of 5" title="Confidence ${n} of 5"></button>`).join('')}
    </div>
    <button class="btn-icon subtle" data-action="delete-topic" data-subject="${subject.id}" data-topic="${topic.id}" aria-label="Delete topic ${esc(topic.name)}">${icon('trash')}</button>
  </li>`;
}

function subjectCard(state, subject, minutes, ui, today) {
  const done = subject.topics.filter((t) => t.status === 'done').length;
  const confirming = ui.confirm === `subject:${subject.id}`;
  return `<section class="card subject" style="--c:${esc(subject.color)}">
    <header class="subject-head">
      ${ring(done, subject.topics.length, subject.color)}
      <div class="subject-title"><h2>${esc(subject.name)}</h2>
        <span class="sub">${done} of ${plural(subject.topics.length, 'topic')} done. ${minutes ? `${fmtMinutes(minutes)} studied.` : 'No sessions yet.'}</span></div>
      <div class="subject-tools">
        ${confirming ? `<span class="confirm-text">Delete ${esc(subject.name)} and its exams?</span>
          <button class="btn btn-small btn-danger" data-action="delete-subject" data-id="${subject.id}">Delete</button>
          <button class="btn btn-small btn-ghost" data-action="cancel-confirm">Keep</button>`
        : `<button class="btn-icon subtle" data-action="ask" data-key="subject:${subject.id}" aria-label="Delete subject ${esc(subject.name)}">${icon('trash')}</button>`}
      </div>
    </header>
    ${subject.topics.length ? `<ul class="topics">${subject.topics.map((t) => topicRow(subject, t, today)).join('')}</ul>` : '<p class="empty">No topics yet. Add the chapters or units you need to cover.</p>'}
    <form class="inline-add" data-form="topic" data-subject="${subject.id}">
      <input name="name" maxlength="80" autocomplete="off" placeholder="Add a topic to ${esc(subject.name)}" aria-label="New topic for ${esc(subject.name)}">
      <button class="btn btn-icon" aria-label="Add topic">${icon('plus')}</button>
    </form>
  </section>`;
}

export function subjectsView(state, ui, today) {
  const minutes = minutesBySubject(state.trees);
  const used = new Set(state.subjects.map((s) => s.color));
  const pick = ui.newColor ?? SUBJECT_COLORS.find((c) => !used.has(c)) ?? SUBJECT_COLORS[0];
  return `<header class="view-head"><h1>Subjects</h1>
    <p>Break each subject into topics. Rate how sure you feel, and mark a topic done to schedule its reviews.</p></header>
    <form class="card add-subject" data-form="subject">
      <input name="name" maxlength="40" autocomplete="off" placeholder="New subject, like Biology" aria-label="Subject name" required>
      <div class="swatches" role="radiogroup" aria-label="Subject colour">
        ${SUBJECT_COLORS.map((c) => `<button type="button" class="swatch ${c === pick ? 'is-on' : ''}" style="--c:${c}" data-action="pick-color" data-color="${c}" role="radio" aria-checked="${c === pick}" aria-label="Colour ${c}"></button>`).join('')}
      </div>
      <button class="btn btn-primary">${icon('plus')}Add subject</button>
    </form>
    ${state.subjects.map((s) => subjectCard(state, s, minutes[s.id] ?? 0, ui, today)).join('')}`;
}

/* ---------- reviews ---------- */

export function reviewsView(state, today) {
  const rows = allReviews(state.subjects, today);
  const due = rows.filter((r) => r.inDays <= 0);
  const soon = rows.filter((r) => r.inDays > 0 && r.inDays <= 30);
  const mastered = state.subjects.reduce((n, s) => n + s.topics.filter((t) => t.mastered).length, 0);
  return `<header class="view-head"><h1>Reviews</h1>
    <p>Finished topics come back on a growing schedule: ${INTERVALS.join(', ')} days. Mark one Shaky and it starts over tomorrow.</p></header>
    <section class="card"><header class="card-head"><h2>Due now</h2>${due.length ? `<span class="badge">${due.length}</span>` : ''}</header>
      ${due.length ? `<ul class="list">${due.map(reviewRow).join('')}</ul>` : '<p class="empty">Nothing due. Nice work.</p>'}</section>
    <section class="card"><header class="card-head"><h2>Coming up</h2><span class="meta">${plural(mastered, 'topic')} mastered</span></header>
      ${soon.length ? `<ul class="list">${soon.map(({ subject, topic, inDays }) => `<li class="review">
        <div class="review-main">${dot(subject.color)}<div><strong>${esc(topic.name)}</strong><span class="sub">${esc(subject.name)}</span></div></div>
        <span class="meta">${fmtLong(addDays(today, inDays))}</span></li>`).join('')}</ul>`
      : '<p class="empty">Nothing scheduled in the next 30 days. Mark topics done on the Subjects page.</p>'}</section>`;
}

/* ---------- exams ---------- */

export function examsView(state, ui, today) {
  const sorted = [...state.exams].sort((a, b) => a.date.localeCompare(b.date));
  const upcoming = sorted.filter((e) => e.date >= today);
  const past = sorted.filter((e) => e.date < today);
  const card = (e) => {
    const { subject, left, days, target } = examStats(state, e, today);
    const confirming = ui.confirm === `exam:${e.id}`;
    return `<li class="card exam-card" style="--c:${esc(subject?.color ?? 'var(--moss)')}">
      <div class="countdown big"><b>${Math.max(0, days)}</b><span>${days === 1 ? 'day left' : 'days left'}</span></div>
      <div class="exam-body"><h2>${esc(e.name)}</h2>
        <span class="sub">${subject ? `${dot(subject.color)}${esc(subject.name)}. ` : ''}${fmtLong(e.date)}</span>
        ${days >= 0 ? `<p>${plural(left, 'topic')} left. ${target}.</p>` : ''}</div>
      ${confirming ? `<div class="row"><button class="btn btn-small btn-danger" data-action="delete-exam" data-id="${e.id}">Delete</button>
        <button class="btn btn-small btn-ghost" data-action="cancel-confirm">Keep</button></div>`
      : `<button class="btn-icon subtle" data-action="ask" data-key="exam:${e.id}" aria-label="Delete ${esc(e.name)}">${icon('trash')}</button>`}
    </li>`;
  };
  return `<header class="view-head"><h1>Exams</h1><p>Each exam shows the days left and how many topics a day keep you on track.</p></header>
    <form class="card add-exam" data-form="exam">
      <label class="field"><span>Exam</span><input name="name" maxlength="60" required placeholder="Physics midterm" autocomplete="off"></label>
      <label class="field"><span>Subject</span><select name="subject" required>
        ${state.subjects.length ? state.subjects.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('') : '<option value="">Add a subject first</option>'}
      </select></label>
      <label class="field"><span>Date</span><input type="date" name="date" min="${today}" required></label>
      <button class="btn btn-primary" ${state.subjects.length ? '' : 'disabled'}>${icon('plus')}Add exam</button>
    </form>
    ${upcoming.length ? `<ul class="exam-list">${upcoming.map(card).join('')}</ul>` : '<p class="empty">No upcoming exams.</p>'}
    ${past.length ? `<h2 class="section-title">Past</h2><ul class="exam-list is-past">${past.map(card).join('')}</ul>` : ''}`;
}

/* ---------- stats ---------- */

function heatmap(state, today) {
  const weeks = heatmapWeeks(state.days, today);
  let lastMonth = '';
  const months = weeks.map((col) => {
    const m = parseKey(col[0].key).toLocaleDateString(undefined, { month: 'short' });
    const label = m !== lastMonth ? m : '';
    lastMonth = m;
    return `<span>${label}</span>`;
  }).join('');
  const cells = weeks.map((col) => `<div class="hm-col">${col.map((c) => c.future ? '<i class="hm-cell is-future"></i>'
    : `<i class="hm-cell" data-l="${heatLevel(c.minutes)}" title="${fmtLong(c.key)}: ${c.minutes ? fmtMinutes(c.minutes) : 'no study'}"></i>`).join('')}</div>`).join('');
  return `<div class="heatmap-wrap"><div class="heatmap">
    <div class="hm-months">${months}</div><div class="hm-grid">${cells}</div></div></div>
    <div class="hm-legend"><span>Less</span>${[0, 1, 2, 3, 4].map((l) => `<i class="hm-cell" data-l="${l}"></i>`).join('')}<span>More</span></div>`;
}

export function statsView(state, today) {
  const streak = currentStreak(state.days, today);
  const best = bestStreak(state.days);
  const lvl = levelInfo(state.xp);
  const bySubject = minutesBySubject(state.trees);
  const maxMin = Math.max(1, ...Object.values(bySubject));
  const tiles = [
    ['Current streak', plural(streak, 'day')],
    ['Best streak', plural(best, 'day')],
    ['This week', fmtMinutes(minutesInRange(state.days, today, 7))],
    ['All time', fmtMinutes(totalMinutes(state.days))],
    ['Trees planted', String(state.trees.length)],
  ];
  return `<header class="view-head"><h1>Stats</h1><p>Every square is a day. The darker it is, the longer you studied.</p></header>
    <section class="card">${heatmap(state, today)}</section>
    <div class="tiles">${tiles.map(([k, v]) => `<div class="tile"><span class="tile-k">${k}</span><b class="tile-v">${v}</b></div>`).join('')}</div>
    <div class="stats-grid">
      <section class="card"><header class="card-head"><h2>Time by subject</h2></header>
        ${state.subjects.length ? `<ul class="bars">${state.subjects.map((s) => {
          const m = bySubject[s.id] ?? 0;
          return `<li><span class="bar-label">${dot(s.color)}${esc(s.name)}</span>
            <span class="bar-track"><span style="width:${((m / maxMin) * 100).toFixed(1)}%;--c:${esc(s.color)}"></span></span>
            <span class="bar-val">${fmtMinutes(m)}</span></li>`;
        }).join('')}</ul>` : '<p class="empty">Add subjects to compare your time.</p>'}</section>
      <section class="card"><header class="card-head"><h2>Level ${lvl.level}</h2><span class="meta">${state.xp} XP</span></header>
        <div class="bar thick"><span style="width:${(lvl.pct * 100).toFixed(1)}%"></span></div>
        <p class="sub">${lvl.span - lvl.into} XP to level ${lvl.level + 1}. You earn 1 XP per focus minute, 20 for a finished topic and 5 for a review.</p></section>
    </div>`;
}

/* ---------- settings ---------- */

export function settingsView(state, ui) {
  const { focus, brk, theme } = state.settings;
  return `<header class="view-head"><h1>Settings</h1></header>
    <section class="card form-card"><h2>Timer</h2>
      <div class="row">
        <label class="field"><span>Focus length (minutes)</span><input id="set-focus" type="number" min="5" max="180" value="${focus}"></label>
        <label class="field"><span>Break length (minutes)</span><input id="set-brk" type="number" min="1" max="60" value="${brk}"></label>
      </div></section>
    <section class="card form-card"><h2>Appearance</h2>
      <div class="seg wide" role="group" aria-label="Theme">
        ${['system', 'light', 'dark'].map((t) => `<button data-action="theme" data-theme="${t}" aria-pressed="${theme === t}">${t[0].toUpperCase() + t.slice(1)}</button>`).join('')}
      </div></section>
    <section class="card form-card"><h2>Backup</h2>
      <p class="sub">Your data is saved on this device only. Export a backup to move it to your phone or keep it safe.</p>
      <div class="row">
        <button class="btn btn-ghost" data-action="export">Export backup</button>
        <label class="btn btn-ghost file-btn">Import backup<input id="import-file" type="file" accept="application/json,.json"></label>
      </div></section>
    <section class="card form-card"><h2>Example data</h2>
      ${state.example ? '<p class="sub">Example subjects are loaded.</p><button class="btn btn-ghost" data-action="clear-example">Clear examples</button>'
        : '<p class="sub">Load three sample subjects with a month of sessions to see how everything looks.</p><button class="btn btn-ghost" data-action="load-example">Load examples</button>'}
    </section>
    <section class="card form-card"><h2>Start over</h2>
      <p class="sub">Deletes every subject, session and tree on this device.</p>
      ${ui.confirm === 'reset' ? `<div class="row"><button class="btn btn-danger" data-action="reset">Delete everything</button>
        <button class="btn btn-ghost" data-action="cancel-confirm">Keep my data</button></div>`
        : '<button class="btn btn-ghost" data-action="ask" data-key="reset">Delete all data</button>'}
    </section>
    <p class="sub foot">Tip: on your phone, open the menu in Chrome and choose "Add to Home screen" to install Study Grove as an app.</p>`;
}
