import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { CURRENT_STAGE } from './stage';

/** Папка скриншотов текущего этапа: docs/screenshots/этап-N/. */
export function shotDir(): string {
  const dir = `docs/screenshots/этап-${CURRENT_STAGE}`;
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Собирает ошибки консоли и страницы — тест падает, если они есть. */
export function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

export async function waitReady(page: Page): Promise<void> {
  await page.waitForFunction(
    () => (window as unknown as { __game?: { ready: boolean } }).__game?.ready === true,
    null,
    {
      timeout: 120_000,
    },
  );
}

/** Какой GPU у браузера: SwiftShader (программный) или настоящий. */
export async function gpuInfo(page: Page): Promise<string> {
  return page.evaluate(() => {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2');
    if (!gl) return 'none';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER));
  });
}

/** Дописывает профиль кадра в test-results/perf.json (для CHANGELOG). */
export function recordPerf(name: string, data: Record<string, unknown>): void {
  mkdirSync('test-results', { recursive: true });
  const file = 'test-results/perf.json';
  const all = existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>) : {};
  all[name] = { ...data, at: new Date().toISOString() };
  writeFileSync(file, JSON.stringify(all, null, 2));
}

/** Дождаться, пока отрисуется ещё n кадров. */
export async function waitFrames(page: Page, n: number): Promise<void> {
  const start = await page.evaluate(() => (window as unknown as { __game: { frameCount: number } }).__game.frameCount);
  await page.waitForFunction(
    (target) => (window as unknown as { __game: { frameCount: number } }).__game.frameCount >= target,
    start + n,
    { timeout: 120_000 },
  );
}

/** Скриншот в JPEG (PNG 1080p весит 2 МБ — репозиторий разрастается). */
export async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: `${shotDir()}/${name}.jpg`, type: 'jpeg', quality: 86 });
}
