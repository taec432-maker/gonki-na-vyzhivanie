/**
 * Ники зрителей (раздел 6 ТЗ): подпись над машиной — до 16 символов, без эмодзи
 * и служебных символов; оригинал хранится для лидерборда.
 */
const MAX = 16;

/** Разрешено в подписи: буквы любых алфавитов, цифры, пробел и простая пунктуация. */
const ALLOWED = /[\p{L}\p{N} ._\-'!?&+]/u;

export function labelName(raw: string, fallback = 'Игрок'): string {
  const chars: string[] = [];
  for (const ch of raw.normalize('NFC')) {
    if (ALLOWED.test(ch)) chars.push(ch);
    else if (chars.length && chars[chars.length - 1] !== ' ') chars.push(' ');
  }
  let s = chars.join('').replace(/\s+/g, ' ').trim();
  // Не больше 16 символов (по кодовым точкам — кириллица и латиница).
  const cps = [...s];
  if (cps.length > MAX) s = cps.slice(0, MAX).join('').trimEnd();
  return s.length > 0 ? s : fallback;
}

/** Невидимые и управляющие символы (в том числе переворот направления текста). */
function invisible(cp: number): boolean {
  return (
    cp < 0x20 ||
    cp === 0x7f ||
    (cp >= 0x200b && cp <= 0x200f) ||
    (cp >= 0x202a && cp <= 0x202e) ||
    (cp >= 0x2066 && cp <= 0x2069)
  );
}

/** Оригинальный ник для лидерборда: без невидимых управляющих символов, не длиннее 40. */
export function originalName(raw: string): string {
  return [...raw]
    .filter((ch) => !invisible(ch.codePointAt(0) ?? 0))
    .slice(0, 40)
    .join('')
    .trim();
}
