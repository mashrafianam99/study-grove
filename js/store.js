// App state: one JSON object kept in localStorage. Every change goes through update(),
// which works on a copy and then notifies subscribers, so views never mutate state directly.
import { uid, dateKey, addDays, parseKey } from './util.js';
import { firstReview, nextReview } from './srs.js';

const KEY = 'study-grove:v1';
const DONE_TASK_KEEP_DAYS = 14;
export const XP_TOPIC_DONE = 20;
export const XP_REVIEW = 5;
export const SUBJECT_COLORS = ['#4E8F5B', '#3E7CB1', '#9A5BA5', '#D0675C', '#C3962F', '#2A9D8F'];

const emptyState = () => ({
  version: 1,
  subjects: [],
  tasks: [],
  exams: [],
  days: {},
  trees: [],
  xp: 0,
  settings: { focus: 25, brk: 5, theme: 'system' },
  example: null, // { days: {...}, xp } while example data is loaded
});

let storageWorks = true;
const listeners = new Set();

/* ---------- validation: everything loaded or imported is coerced to a known shape ---------- */

const ID_RE = /^[\w-]{1,40}$/;
const isId = (v) => typeof v === 'string' && ID_RE.test(v);
const ID = { test: isId }; // never let undefined pass as the string "undefined"
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const COLOR = /^#[0-9a-fA-F]{6}$/;
const STATUSES = ['todo', 'learning', 'done'];
const THEMES = ['system', 'light', 'dark'];
const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const text = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
const int = (v, min, max, fallback = min) => (Number.isFinite(Number(v)) ? Math.min(max, Math.max(min, Math.round(Number(v)))) : fallback);
// Caps keep a huge or hostile backup from filling storage or freezing the page.
const LIMITS = { subjects: 100, topics: 300, tasks: 2000, exams: 300, trees: 20000, days: 3700 };
const list = (v, clean, max) => (Array.isArray(v) ? v.slice(0, max * 2).map(clean).filter(Boolean).slice(0, max) : []);
const exFlag = (v) => (v.ex ? { ex: true } : {});
// A real calendar date in YYYY-MM-DD form (rejects 2024-99-99 and 2025-02-30).
const isRealDate = (v) => typeof v === 'string' && DATE.test(v) && dateKey(parseKey(v)) === v;
const date = (v) => (isRealDate(v) ? v : null);

function cleanTopic(v) {
  const t = obj(v);
  if (!t || !ID.test(t.id)) return null;
  const review = obj(t.review);
  return {
    id: t.id,
    name: text(t.name, 80) || 'Untitled topic',
    status: STATUSES.includes(t.status) ? t.status : 'todo',
    confidence: int(t.confidence, 0, 5),
    review: review && date(review.due) ? { step: int(review.step, 0, 4), due: review.due } : null,
    mastered: Boolean(t.mastered),
    ...(date(t.doneAt) ? { doneAt: t.doneAt } : {}),
  };
}

function cleanSubject(v) {
  const s = obj(v);
  if (!s || !ID.test(s.id)) return null;
  return {
    id: s.id, name: text(s.name, 40) || 'Untitled subject', color: COLOR.test(s.color) ? s.color : SUBJECT_COLORS[0],
    topics: list(s.topics, cleanTopic, LIMITS.topics), ...exFlag(s),
  };
}

const cleanTask = (v) => {
  const t = obj(v);
  return t && ID.test(t.id) && date(t.date)
    ? { id: t.id, text: text(t.text, 140) || 'Untitled task', done: Boolean(t.done), date: t.date, ...exFlag(t) } : null;
};
const cleanExam = (v) => {
  const e = obj(v);
  return e && ID.test(e.id) && date(e.date)
    ? { id: e.id, subjectId: ID.test(e.subjectId) ? e.subjectId : '', name: text(e.name, 60) || 'Exam', date: e.date, ...exFlag(e) } : null;
};
const cleanTree = (v) => {
  const t = obj(v);
  return t && ID.test(t.id) && date(t.date)
    ? {
      id: t.id, subjectId: ID.test(t.subjectId) ? t.subjectId : '', topicId: ID.test(t.topicId) ? t.topicId : null,
      minutes: int(t.minutes, 1, 600, 25), date: t.date, ...exFlag(t),
    } : null;
};
function cleanDays(v) {
  const out = {};
  const entries = Object.entries(obj(v) ?? {}).filter(([k, m]) => isRealDate(k) && Number(m) > 0);
  for (const [k, m] of entries.sort(([a], [b]) => b.localeCompare(a)).slice(0, LIMITS.days)) out[k] = int(m, 1, 1440);
  return out;
}

function normalize(input) {
  const base = emptyState();
  const s = obj(input) ?? {};
  const settings = obj(s.settings) ?? {};
  const ex = obj(s.example);
  return {
    version: 1,
    subjects: list(s.subjects, cleanSubject, LIMITS.subjects),
    tasks: list(s.tasks, cleanTask, LIMITS.tasks),
    exams: list(s.exams, cleanExam, LIMITS.exams),
    trees: list(s.trees, cleanTree, LIMITS.trees),
    days: cleanDays(s.days),
    xp: int(s.xp, 0, 1e9),
    settings: {
      focus: int(settings.focus, 5, 180, base.settings.focus),
      brk: int(settings.brk, 1, 60, base.settings.brk),
      theme: THEMES.includes(settings.theme) ? settings.theme : 'system',
    },
    example: ex ? { days: cleanDays(ex.days), xp: int(ex.xp, 0, 1e9) } : null,
  };
}

function readStored() {
  let raw = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    storageWorks = false;
  }
  if (!raw) return emptyState();
  try {
    return normalize(JSON.parse(raw));
  } catch {
    // Unreadable save: keep the raw copy so it is never overwritten, then start clean.
    try { localStorage.setItem(`${KEY}:unreadable`, raw); } catch { /* storage full */ } // one rolling copy
    return emptyState();
  }
}

// Declared after every helper above so loading can never hit an uninitialised constant.
let state = rollOver(readStored());

// Unfinished tasks from earlier days move to today; old finished ones are dropped.
function rollOver(s) {
  const today = dateKey();
  const cutoff = addDays(today, -DONE_TASK_KEEP_DAYS);
  const tasks = s.tasks
    .filter((t) => !(t.done && t.date < cutoff))
    .map((t) => (!t.done && t.date < today ? { ...t, date: today } : t));
  return { ...s, tasks };
}

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    storageWorks = true;
  } catch {
    storageWorks = false;
  }
}

export const getState = () => state;

// Called when the app is resumed on a new day (an installed app can stay open overnight).
export const rollOverDay = () => update((s) => rollOver(s));
export const canSave = () => storageWorks;

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function update(recipe) {
  const draft = structuredClone(state);
  state = recipe(draft) ?? draft;
  persist();
  listeners.forEach((fn) => fn(state));
}

const findSubject = (s, id) => s.subjects.find((x) => x.id === id);
const findTopic = (s, subjectId, topicId) => findSubject(s, subjectId)?.topics.find((t) => t.id === topicId);

/* ---------- subjects & topics ---------- */

export function addSubject(name, color) {
  update((s) => {
    const used = new Set(s.subjects.map((x) => x.color));
    const pick = color ?? SUBJECT_COLORS.find((c) => !used.has(c)) ?? SUBJECT_COLORS[s.subjects.length % 6];
    s.subjects.push({ id: uid(), name, color: pick, topics: [] });
  });
}

export const renameSubject = (id, name) => update((s) => { findSubject(s, id).name = name; });
export const recolorSubject = (id, color) => update((s) => { findSubject(s, id).color = color; });

export function deleteSubject(id) {
  update((s) => {
    s.subjects = s.subjects.filter((x) => x.id !== id);
    s.exams = s.exams.filter((e) => e.subjectId !== id);
  });
}

export function addTopic(subjectId, name) {
  update((s) => {
    findSubject(s, subjectId).topics.push({ id: uid(), name, status: 'todo', confidence: 0, review: null });
  });
}

export function deleteTopic(subjectId, topicId) {
  update((s) => {
    const subject = findSubject(s, subjectId);
    subject.topics = subject.topics.filter((t) => t.id !== topicId);
  });
}

export function setTopicStatus(subjectId, topicId, status) {
  update((s) => {
    const topic = findTopic(s, subjectId, topicId);
    if (!topic || topic.status === status) return;
    const today = dateKey();
    if (status === 'done') {
      topic.review = firstReview(today);
      topic.doneAt = today;
      s.xp += XP_TOPIC_DONE;
    } else if (topic.status === 'done') {
      topic.review = null;
      topic.mastered = false;
      s.xp = Math.max(0, s.xp - XP_TOPIC_DONE);
    }
    topic.status = status;
  });
}

export const setConfidence = (subjectId, topicId, value) =>
  update((s) => { findTopic(s, subjectId, topicId).confidence = value; });

export function reviewTopic(subjectId, topicId, remembered) {
  update((s) => {
    const topic = findTopic(s, subjectId, topicId);
    if (!topic?.review) return;
    const next = nextReview(topic.review, remembered, dateKey());
    topic.review = next;
    topic.mastered = next === null;
    topic.confidence = remembered ? Math.min(5, (topic.confidence || 2) + 1) : Math.max(1, (topic.confidence || 3) - 1);
    s.xp += XP_REVIEW;
  });
}

/* ---------- tasks ---------- */

export const addTask = (text) => update((s) => { s.tasks.push({ id: uid(), text, done: false, date: dateKey() }); });
export const toggleTask = (id) => update((s) => { const t = s.tasks.find((x) => x.id === id); t.done = !t.done; });
export const deleteTask = (id) => update((s) => { s.tasks = s.tasks.filter((x) => x.id !== id); });

/* ---------- exams ---------- */

export const addExam = (subjectId, name, date) =>
  update((s) => { s.exams.push({ id: uid(), subjectId, name, date }); });
export const deleteExam = (id) => update((s) => { s.exams = s.exams.filter((x) => x.id !== id); });

/* ---------- focus sessions ---------- */

// `day` is the date the session ended, so a session finished at 23:50 counts for that day.
export function logSession({ subjectId, topicId, minutes, day = dateKey() }) {
  const today = day;
  update((s) => {
    s.days[today] = (s.days[today] ?? 0) + minutes;
    s.trees.push({ id: uid(), subjectId, topicId: topicId || null, minutes, date: today });
    s.xp += minutes;
    const topic = topicId ? findTopic(s, subjectId, topicId) : null;
    if (topic && topic.status === 'todo') topic.status = 'learning';
  });
}

export const setSettings = (patch) => update((s) => { s.settings = { ...s.settings, ...patch }; });

/* ---------- backup ---------- */

export const exportJSON = () => JSON.stringify({ app: 'study-grove', exportedAt: new Date().toISOString(), state }, null, 2);

export function importJSON(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('That file is not valid JSON. Choose a backup exported from Study Grove.');
  }
  const incoming = parsed?.app === 'study-grove' ? parsed.state : parsed;
  if (!incoming || !Array.isArray(incoming.subjects) || !obj(incoming.days)) {
    throw new Error('That file is not a Study Grove backup. It needs subjects and study days.');
  }
  update(() => rollOver(normalize(incoming)));
}

export const resetAll = () => update(() => emptyState());

/* ---------- example data ---------- */

export function loadExample() {
  const today = dateKey();
  update((s) => {
    if (s.example) return; // already loaded; a second batch could never be cleared cleanly
    const mk = (name, color, topics) => ({
      id: uid(), name, color, ex: true,
      topics: topics.map(([tName, status, confidence, reviewIn]) => ({
        id: uid(), name: tName, status, confidence,
        review: status === 'done' ? { step: 1, due: addDays(today, reviewIn) } : null,
      })),
    });
    const physics = mk('Physics', SUBJECT_COLORS[1], [
      ['Optics', 'done', 4, 0], ['Waves', 'learning', 3], ['Thermodynamics', 'todo', 0], ['Electrostatics', 'todo', 0],
    ]);
    const maths = mk('Mathematics', SUBJECT_COLORS[0], [
      ['Integration', 'done', 3, 2], ['Differential equations', 'learning', 2], ['Probability', 'done', 5, 0], ['Vectors', 'todo', 0],
    ]);
    const chem = mk('Chemistry', SUBJECT_COLORS[3], [
      ['Organic reactions', 'learning', 2], ['Chemical equilibrium', 'todo', 0], ['Electrochemistry', 'todo', 0],
    ]);
    const subjects = [physics, maths, chem];
    s.subjects.push(...subjects);
    s.exams.push(
      { id: uid(), subjectId: physics.id, name: 'Physics midterm', date: addDays(today, 18), ex: true },
      { id: uid(), subjectId: chem.id, name: 'Chemistry final', date: addDays(today, 32), ex: true },
    );
    s.tasks.push(
      { id: uid(), text: 'Finish the optics problem set', done: false, date: today, ex: true },
      { id: uid(), text: 'Write flashcards for equilibrium', done: true, date: today, ex: true },
    );
    const exDays = {};
    let exXp = 0;
    const lengths = [25, 25, 50, 25, 45, 50, 90];
    for (let back = 34; back >= 1; back--) {
      if (back % 9 === 4 || back % 11 === 0) continue; // a few rest days
      const key = addDays(today, -back);
      const sessions = 1 + (back % 3 === 0 ? 1 : 0);
      for (let i = 0; i < sessions; i++) {
        const subject = subjects[(back + i) % 3];
        const minutes = lengths[(back * 3 + i) % lengths.length];
        s.trees.push({ id: uid(), subjectId: subject.id, topicId: subject.topics[0].id, minutes, date: key, ex: true });
        exDays[key] = (exDays[key] ?? 0) + minutes;
        exXp += minutes;
      }
    }
    for (const [k, m] of Object.entries(exDays)) s.days[k] = (s.days[k] ?? 0) + m;
    s.xp += exXp + 2 * XP_TOPIC_DONE;
    s.example = { days: exDays, xp: exXp + 2 * XP_TOPIC_DONE };
  });
}

export function clearExample() {
  update((s) => {
    const ex = s.example;
    if (!ex) return;
    const exSubjectIds = new Set(s.subjects.filter((x) => x.ex).map((x) => x.id));
    s.subjects = s.subjects.filter((x) => !x.ex);
    s.exams = s.exams.filter((x) => !x.ex && !exSubjectIds.has(x.subjectId));
    s.tasks = s.tasks.filter((x) => !x.ex);
    s.trees = s.trees.filter((x) => !x.ex);
    for (const [k, m] of Object.entries(ex.days)) {
      const left = (s.days[k] ?? 0) - m;
      if (left > 0) s.days[k] = left;
      else delete s.days[k];
    }
    s.xp = Math.max(0, s.xp - ex.xp);
    s.example = null;
  });
}
