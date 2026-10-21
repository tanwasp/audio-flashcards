// Streaks, XP, levels and badges. Everything is derived from per-day records:
//   { date: 'YYYY-MM-DD', reviews, correct, xp, added, newSeen, goalMet }
// so nothing here needs its own storage beyond the list of badges already shown.

import { addDays, dayKey } from './srs.js';

export const XP = { again: 4, good: 10, easy: 10, added: 5, goal: 20 };

export function emptyDay(date = dayKey()) {
  return { date, reviews: 0, correct: 0, xp: 0, added: 0, newSeen: 0, goalMet: false };
}

// Current streak: consecutive days that met the goal, ending today, or
// yesterday if today's goal isn't met yet (the streak is still alive).
export function currentStreak(days, today = dayKey()) {
  const met = new Set(days.filter((d) => d.goalMet).map((d) => d.date));
  let day = met.has(today) ? today : addDays(today, -1);
  let n = 0;
  while (met.has(day)) { n++; day = addDays(day, -1); }
  return n;
}

export function bestStreak(days) {
  const met = days.filter((d) => d.goalMet).map((d) => d.date).sort();
  let best = 0, run = 0, prev = null;
  for (const d of met) {
    run = prev && addDays(prev, 1) === d ? run + 1 : 1;
    best = Math.max(best, run);
    prev = d;
  }
  return best;
}

// Each level takes 100 XP more than the last: 0, 100, 300, 600, 1000, …
export function levelFor(xp) {
  let level = 1, floor = 0;
  while (xp >= floor + level * 100) { floor += level * 100; level++; }
  return { level, into: xp - floor, needed: level * 100 };
}

export const BADGES = [
  { id: 'first-card', icon: '🌱', name: 'First card', desc: 'Add your first card', test: (s) => s.cards >= 1 },
  { id: 'deck-25', icon: '📚', name: 'Collector', desc: 'Have 25 cards', test: (s) => s.cards >= 25 },
  { id: 'deck-100', icon: '🏛️', name: 'Library', desc: 'Have 100 cards', test: (s) => s.cards >= 100 },
  { id: 'streak-3', icon: '🔥', name: 'Warming up', desc: '3-day streak', test: (s) => s.best >= 3 },
  { id: 'streak-7', icon: '⚡', name: 'One week', desc: '7-day streak', test: (s) => s.best >= 7 },
  { id: 'streak-30', icon: '🏆', name: 'Unstoppable', desc: '30-day streak', test: (s) => s.best >= 30 },
  { id: 'reviews-100', icon: '🎯', name: 'Centurion', desc: '100 reviews', test: (s) => s.reviews >= 100 },
  { id: 'reviews-1000', icon: '💎', name: 'Dedicated', desc: '1,000 reviews', test: (s) => s.reviews >= 1000 },
  { id: 'perfect', icon: '✨', name: 'Flawless', desc: '10+ card session with no misses', test: (s) => s.perfect >= 1 },
  { id: 'polyglot', icon: '🌍', name: 'Polyglot', desc: 'Cards in 3 languages', test: (s) => s.languages >= 3 },
];

export function summarize(days, cards, profile, today = dayKey()) {
  const xp = days.reduce((n, d) => n + d.xp, 0);
  return {
    xp,
    ...levelFor(xp),
    streak: currentStreak(days, today),
    best: bestStreak(days),
    reviews: days.reduce((n, d) => n + d.reviews, 0),
    correct: days.reduce((n, d) => n + d.correct, 0),
    cards: cards.length,
    languages: new Set(cards.map((c) => c.language)).size,
    perfect: profile.perfectSessions ?? 0,
  };
}

export const earnedBadges = (stats) => BADGES.filter((b) => b.test(stats)).map((b) => b.id);
