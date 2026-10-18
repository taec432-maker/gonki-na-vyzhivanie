/**
 * Файл настроек (кнопки «Сохранить в файл» / «Загрузить из файла» в панели).
 * Отдельный маленький модуль: панели не нужно тянуть за собой физику и сессию.
 */

/** Метка файла: чтобы по ошибке не загрузить чужой JSON. */
export const SETTINGS_FILE_TAG = 'gonki-na-vyzhivanie/settings';

/** Все настройки одним файлом: заезд, качество, Bridge, подарки, звук. */
export function exportSettings(settings: unknown): string {
  return JSON.stringify({ app: SETTINGS_FILE_TAG, version: 1, saved: new Date().toISOString(), settings }, null, 2);
}
