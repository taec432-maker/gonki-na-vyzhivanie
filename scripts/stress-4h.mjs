// Стресс-тест непрерывной работы (этап 7 ТЗ): игра крутится N минут с мок-зрителями —
// чат, «машина N», подарки всех тиров, лайки, иногда шквал подарков. Каждые 30 минут —
// замер памяти после сборки мусора (heap), счётчики DOM и обработчиков, время кадра;
// в начале, в середине и в конце — полный снимок heap (файл .heapsnapshot).
// Замеры — каждые 10 минут (--sample), чтобы видеть тренд, а не отдельные точки.
//
// Запуск (нужен собранный dist и свободный порт):
//   node scripts/stress-4h.mjs --minutes 240 --port 8092 --out stress-results
// Итог: <out>/report.json и <out>/report.md (таблица для CHANGELOG).
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, createWriteStream } from 'node:fs';
import { chromium } from '@playwright/test';

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .join(' ')
    .split('--')
    .filter(Boolean)
    .map((p) => p.trim().split(/\s+/))
    .map(([k, v]) => [k, v ?? 'true']),
);
const minutes = Number(args.minutes ?? 240);
const port = Number(args.port ?? 8092);
const out = args.out ?? 'stress-results';
const sampleEvery = Number(args.sample ?? 10) * 60_000;
mkdirSync(out, { recursive: true });

const server = spawn('node', ['scripts/serve.mjs', '--port', String(port)], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 1500));

const browser = await chromium.launch({
  args: [
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
    '--js-flags=--expose-gc',
    // Как в OBS: звук играет без щелчка — проверяем и его на утечки.
    '--autoplay-policy=no-user-gesture-required',
  ],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`${new Date().toISOString()} ${m.text()}`);
});
page.on('pageerror', (e) => errors.push(`${new Date().toISOString()} ${e.message}`));
await page.goto(`http://127.0.0.1:${port}/?seed=4242&bridge=off&fresh&quality=broadcast`);
await page.waitForFunction(() => window.__game?.ready, null, { timeout: 120_000 });
const cdp = await page.context().newCDPSession(page);
await cdp.send('HeapProfiler.enable');
await cdp.send('Performance.enable');

const started = Date.now();
const elapsedMin = () => (Date.now() - started) / 60_000;
const samples = [];

async function snapshotFile(name) {
  const file = `${out}/${name}.heapsnapshot`;
  const stream = createWriteStream(file);
  const onChunk = (e) => stream.write(e.chunk);
  cdp.on('HeapProfiler.addHeapSnapshotChunk', onChunk);
  await cdp.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false });
  cdp.off('HeapProfiler.addHeapSnapshotChunk', onChunk);
  await new Promise((r) => stream.end(r));
  return file;
}

async function sample(label, full = false) {
  await cdp.send('HeapProfiler.collectGarbage');
  const heap = await cdp.send('Runtime.getHeapUsage');
  const { metrics } = await cdp.send('Performance.getMetrics');
  const m = Object.fromEntries(metrics.map((x) => [x.name, x.value]));
  const st = await page.evaluate(() => {
    const g = window.__game;
    const s = g.status();
    return {
      race: s.race,
      phase: s.phase,
      track: s.track,
      cars: s.cars,
      cpuMs: s.cpuMs,
      simMs: s.simMs,
      frameMs: s.frameMs,
      drawCalls: s.drawCalls,
      players: g.session.players.size,
      queue: s.queue.length,
      geometries: g.renderer.renderer.info.memory.geometries,
      textures: g.renderer.renderer.info.memory.textures,
      programs: g.renderer.renderer.info.programs?.length ?? 0,
      audio: s.audio.state,
      feed: g.feed.history.length,
      sceneObjects: (() => {
        let n = 0;
        g.renderer.scene.traverse(() => n++);
        return n;
      })(),
    };
  });
  const row = {
    label,
    minute: +elapsedMin().toFixed(1),
    heapMB: +(heap.usedSize / 1048576).toFixed(1),
    domNodes: m.Nodes,
    listeners: m.JSEventListeners,
    ...st,
    snapshot: full ? await snapshotFile(label) : null,
  };
  samples.push(row);
  console.info(JSON.stringify(row));
  writeFileSync(`${out}/report.json`, JSON.stringify({ minutes, samples, errors }, null, 2));
}

// Мок-зрители: тот же путь, что и настоящие события Bridge (формат раздела 5 ТЗ).
async function viewersTick(t) {
  await page.evaluate((t) => {
    const g = window.__game;
    const m = g.mock;
    // Пул ~600 зрителей: одни и те же возвращаются, новые приходят.
    const pool = (window.__stressPool ??= Array.from({ length: 600 }, () => m.viewer()));
    // Зрители приходят и уходят: каждый ~7-й тик место в пуле занимает новый человек
    // (за 4 часа — около тысячи новых ников, как на живом эфире).
    if (Math.random() < 0.15) pool[Math.floor(Math.random() * pool.length)] = m.viewer();
    const pick = () => pool[Math.floor(Math.random() * pool.length)];
    const v = pick();
    const roll = Math.random();
    if (roll < 0.55)
      g.ingest(m.chat(v.userId, v.name, Math.random() < 0.2 ? `машина ${1 + Math.floor(Math.random() * 16)}` : 'го'));
    else if (roll < 0.8) {
      const tiers = [1, 1, 1, 5, 10, 30, 60, 100, 300, 500, 1000, 5000];
      const dia = tiers[Math.floor(Math.random() * tiers.length)];
      for (const e of m.gift(v.userId, v.name, 'Rose', dia, 1 + Math.floor(Math.random() * 3))) g.ingest(e);
    } else g.ingest(m.like(v.userId, v.name, 5 + Math.floor(Math.random() * 40)));
    // Каждые 15 минут — шквал: 40 подарков подряд.
    if (t % 900 === 0)
      for (let i = 0; i < 40; i++) for (const e of m.gift(pick().userId, pick().name, 'Rose', 10, 1)) g.ingest(e);
  }, t);
}

await sample('start', true);
let nextSample = sampleEvery;
let tick = 0;
const end = minutes * 60_000;
while (Date.now() - started < end) {
  tick++;
  // Симуляция — в реальном времени даже при медленном программном рендере.
  await page.evaluate(() => {
    const g = window.__game;
    // Кадр программного GPU — 0,3–1 с, а шаг кадра ограничен 0,1 с: ускоряем так,
    // чтобы симуляция шла в реальном времени (заездов за 4 часа — как в эфире).
    g.stepper.timeScale = Math.max(1, Math.min(16, g.meter.median() / 100));
    g.stepper.maxStepsPerFrame = 120;
  });
  if (tick % 2 === 0) await viewersTick(tick);
  if (Date.now() - started >= nextSample) {
    const half = Math.abs(Date.now() - started - end / 2) < sampleEvery / 2;
    await sample(`t${Math.round(elapsedMin())}`, half);
    nextSample += sampleEvery;
  }
  await new Promise((r) => setTimeout(r, 1000));
}
await sample('end', true);

// Итог: первый час после прогрева (30–90 мин, все трассы уже загружались) против
// последнего часа. Сравниваем средние: разные трассы весят по-разному, одна точка ничего не значит.
const measured = samples.filter((x) => x.label !== 'start');
const avg = (list, k) => list.reduce((a, x) => a + x[k], 0) / Math.max(1, list.length);
const warmFrom = Math.min(30, minutes / 8);
const early = measured.filter((x) => x.minute >= warmFrom && x.minute <= warmFrom + Math.max(10, minutes / 4));
const late = measured.filter((x) => x.minute >= minutes - Math.max(10, minutes / 4));
const growth = ((avg(late, 'heapMB') - avg(early, 'heapMB')) / avg(early, 'heapMB')) * 100;
const cpuRatio = avg(late, 'cpuMs') / Math.max(0.01, avg(early, 'cpuMs'));
const simRatio = avg(late, 'simMs') / Math.max(0.001, avg(early, 'simMs'));
const domGrowth = avg(late, 'domNodes') - avg(early, 'domNodes');
const races = (samples.at(-1)?.race ?? 0) + 1;
const ok = errors.length === 0 && growth < 20 && cpuRatio < 1.5 && simRatio < 1.5;
const md = [
  `# Стресс-тест ${minutes} мин`,
  '',
  '| Минута | Heap, МБ | DOM-узлов | Обработчиков | Геометрий | Текстур | Объектов сцены | Заезд | Трасса | Зрителей | Процессор на кадр, мс | Физика на шаг, мс |',
  '|---|---|---|---|---|---|---|---|---|---|---|---|',
  ...samples.map(
    (s) =>
      `| ${s.minute} | ${s.heapMB} | ${s.domNodes} | ${s.listeners} | ${s.geometries} | ${s.textures} | ${s.sceneObjects} | ${s.race + 1} | ${s.track} | ${s.players} | ${s.cpuMs} | ${s.simMs} |`,
  ),
  '',
  `Заездов: ${races}. Средний heap: ${avg(early, 'heapMB').toFixed(1)} МБ в начале → ${avg(late, 'heapMB').toFixed(1)} МБ в конце (${growth >= 0 ? '+' : ''}${growth.toFixed(1)} %).`,
  `Процессор на кадр: ×${cpuRatio.toFixed(2)}, физика на шаг: ×${simRatio.toFixed(2)}, DOM-узлов: ${domGrowth >= 0 ? '+' : ''}${domGrowth.toFixed(0)}.`,
  `Ошибок в консоли: ${errors.length}. Итог: ${ok ? 'утечек и деградации нет' : 'ЕСТЬ ПРОБЛЕМЫ'}.`,
];
writeFileSync(`${out}/report.md`, md.join('\n'));
writeFileSync(
  `${out}/report.json`,
  JSON.stringify({ minutes, samples, errors, growth, cpuRatio, simRatio, ok }, null, 2),
);
console.info(md.join('\n'));
await browser.close();
server.kill();
process.exit(ok ? 0 : 1);
