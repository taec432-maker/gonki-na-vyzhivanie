import type { RaceResult } from '../core/sim';

/**
 * Очки сессии (раздел 6 ТЗ): победа 10, 2-е место 6, 3-е 3, участие 1,
 * уничтожение соперника +2. Только зрители (боты в лидерборд не попадают).
 */
export const POINTS = { first: 10, second: 6, third: 3, participation: 1, kill: 2 } as const;

export interface ScoreRow {
  id: string;
  /** Оригинальный ник (для лидерборда — как есть). */
  name: string;
  points: number;
  races: number;
  wins: number;
  podiums: number;
  kills: number;
  best: number | null;
}

export class Leaderboard {
  readonly rows = new Map<string, ScoreRow>();

  private row(id: string, name: string): ScoreRow {
    let r = this.rows.get(id);
    if (!r) {
      r = { id, name, points: 0, races: 0, wins: 0, podiums: 0, kills: 0, best: null };
      this.rows.set(id, r);
    }
    if (name) r.name = name;
    return r;
  }

  /** Итог заезда: места → очки. names — оригинальные ники по playerId. */
  addRace(results: readonly RaceResult[], names: (playerId: string) => string): void {
    for (const res of results) {
      if (!res.playerId) continue;
      const r = this.row(res.playerId, names(res.playerId));
      r.races++;
      r.points += POINTS.participation;
      if (res.place === 1) {
        r.points += POINTS.first;
        r.wins++;
      } else if (res.place === 2) r.points += POINTS.second;
      else if (res.place === 3) r.points += POINTS.third;
      if (res.place <= 3) r.podiums++;
      if (res.place < (r.best ?? Infinity)) r.best = res.place;
    }
  }

  addKill(playerId: string, name: string): void {
    const r = this.row(playerId, name);
    r.kills++;
    r.points += POINTS.kill;
  }

  top(n = 10): ScoreRow[] {
    return [...this.rows.values()]
      .sort((a, b) => b.points - a.points || b.wins - a.wins || a.name.localeCompare(b.name))
      .slice(0, n);
  }

  toJSON(): { version: 1; rows: ScoreRow[] } {
    return { version: 1, rows: [...this.rows.values()] };
  }

  load(raw: unknown): void {
    this.rows.clear();
    const rows = (raw as { rows?: unknown[] })?.rows;
    if (!Array.isArray(rows)) return;
    for (const x of rows as Partial<ScoreRow>[]) {
      if (!x || typeof x.id !== 'string') continue;
      this.rows.set(x.id, {
        id: x.id,
        name: String(x.name ?? x.id),
        points: Number(x.points) || 0,
        races: Number(x.races) || 0,
        wins: Number(x.wins) || 0,
        podiums: Number(x.podiums) || 0,
        kills: Number(x.kills) || 0,
        best: typeof x.best === 'number' ? x.best : null,
      });
    }
  }

  reset(): void {
    this.rows.clear();
  }
}
