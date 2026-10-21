// Spaced repetition: a simplified SM-2. Each card carries
//   due      'YYYY-MM-DD' (local date) it next comes up; missing = new card
//   interval days between reviews
//   ease     growth factor for the interval (starts at 2.5)
//   reps     correct answers in a row
//   lapses   times it was forgotten
// Dates are local calendar days so "due today" matches what the user sees.

export const NEW_EASE = 2.5;
const MIN_EASE = 1.3;

export function dayKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function addDays(key, n) {
  const [y, m, d] = key.split('-').map(Number);
  return dayKey(new Date(y, m - 1, d + n));
}

export function daysBetween(a, b) {
  const toDate = (k) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
  return Math.round((toDate(b) - toDate(a)) / 86400000);
}

export const isNew = (card) => !card.due;
export const isDue = (card, today = dayKey()) => !!card.due && card.due <= today;

// The scheduling fields after answering `grade` ('again' | 'good' | 'easy').
export function schedule(card, grade, today = dayKey()) {
  const ease = card.ease ?? NEW_EASE;
  const reps = card.reps ?? 0;
  const interval = card.interval ?? 0;
  let next;
  if (grade === 'again') {
    next = { interval: 1, ease: Math.max(MIN_EASE, ease - 0.2), reps: 0, lapses: (card.lapses ?? 0) + 1 };
  } else if (grade === 'easy') {
    const days = reps === 0 ? 4 : Math.max(interval + 1, Math.round(interval * ease * 1.3));
    next = { interval: days, ease: ease + 0.15, reps: reps + 1 };
  } else {
    const days = reps === 0 ? 1 : reps === 1 ? 3 : Math.max(interval + 1, Math.round(interval * ease));
    next = { interval: days, ease, reps: reps + 1 };
  }
  return { lapses: card.lapses ?? 0, ...next, due: addDays(today, next.interval), reviewedAt: Date.now() };
}

export function formatInterval(days) {
  if (days < 1) return 'now';
  if (days < 30) return `${days}d`;
  if (days < 365) return `${Math.round(days / 30)}mo`;
  return `${(days / 365).toFixed(1).replace(/\.0$/, '')}y`;
}
