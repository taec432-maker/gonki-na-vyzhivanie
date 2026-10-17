/** 83.4 → «1:23.4». */
export function formatTime(sec: number): string {
  if (!Number.isFinite(sec)) return '—';
  const neg = sec < 0;
  const t = Math.abs(sec);
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${neg ? '−' : ''}${m}:${s < 10 ? '0' : ''}${s.toFixed(1)}`;
}

/** Экранирование текста для вставки в HTML (ники зрителей!). */
export function esc(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  );
}
