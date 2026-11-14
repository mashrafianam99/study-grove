// Spaced repetition: a finished topic comes back for review after 1, 3, 7, 21 and 45 days.
import { addDays, daysBetween } from './util.js';

export const INTERVALS = [1, 3, 7, 21, 45];

export const firstReview = (today) => ({ step: 0, due: addDays(today, INTERVALS[0]) });

// Returns the next review, or null when the topic is mastered (all intervals passed).
export function nextReview(review, remembered, today) {
  if (!remembered) return { step: 0, due: addDays(today, INTERVALS[0]) };
  const step = (review?.step ?? 0) + 1;
  if (step >= INTERVALS.length) return null;
  return { step, due: addDays(today, INTERVALS[step]) };
}

// Every topic with a scheduled review, flattened with its subject, soonest first.
export function allReviews(subjects, today) {
  const rows = [];
  for (const subject of subjects) {
    for (const topic of subject.topics) {
      if (!topic.review) continue;
      rows.push({ subject, topic, inDays: daysBetween(today, topic.review.due) });
    }
  }
  return rows.sort((a, b) => a.inDays - b.inDays);
}

export const dueReviews = (subjects, today) => allReviews(subjects, today).filter((r) => r.inDays <= 0);
