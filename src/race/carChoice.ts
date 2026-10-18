import type { VehicleSpec } from '../vehicles/types';

/**
 * Выбор машины из чата (раздел 8 ТЗ): «машина 7», «машина №7», «машину 7», «тачка 7»,
 * «car 7» или по названию: «машина пикап», «машина ралли». Регистр и ё/е не важны.
 * Возвращает машину или null, если в сообщении нет выбора (или такой машины нет).
 */
const WORD = '(?:машин[аеуы]?|тачк[аеуи]|car)';
const BY_NUMBER = new RegExp(`(?:^|[^\\p{L}])${WORD}\\s*(?:№|#|номер\\s*)?\\s*(\\d{1,2})(?!\\d)`, 'iu');
const BY_NAME = new RegExp(`(?:^|[^\\p{L}])${WORD}\\s+([\\p{L}][\\p{L}\\- ]{1,30})`, 'iu');

const norm = (s: string): string => s.toLowerCase().replace(/ё/g, 'е').trim();

export function parseCarChoice(text: string, vehicles: readonly VehicleSpec[]): VehicleSpec | null {
  const n = BY_NUMBER.exec(text);
  if (n) {
    const num = Number(n[1]);
    return vehicles.find((v) => v.number === num) ?? null;
  }
  const m = BY_NAME.exec(text);
  if (!m) return null;
  const words = norm(m[1] as string).split(/\s+/);
  const first = words[0] ?? '';
  if (first.length < 3) return null;
  // Сначала — точное начало названия («пикап», «ралли»), затем — любое слово названия.
  const byStart = vehicles.find((v) => norm(v.name).startsWith(first));
  if (byStart) return byStart;
  return (
    vehicles.find((v) =>
      norm(v.name)
        .split(/[\s-]+/)
        .some((w) => w.startsWith(first) || (first.length >= 5 && first.startsWith(w.slice(0, 5)))),
    ) ?? null
  );
}
