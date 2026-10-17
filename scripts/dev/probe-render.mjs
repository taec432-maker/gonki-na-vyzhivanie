import { chromium } from '@playwright/test';
const [w = '1920', h = '1080'] = process.argv.slice(2);
const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: +w, height: +h } });
await page.goto('http://127.0.0.1:8091/?seed=42&quality=broadcast');
await page.waitForFunction(() => window.__game?.ready, null, { timeout: 60000 });
await page.waitForTimeout(2000);
const res = await page.evaluate(async () => {
  const g = window.__game;
  const r = g.renderer;
  const gl = r.renderer.getContext();
  const px = new Uint8Array(4);
  const sync = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  const time = (fn, n = 3) => {
    sync();
    const t = performance.now();
    for (let i = 0; i < n; i++) {
      fn();
      sync();
    }
    return (performance.now() - t) / n;
  };
  const out = {};
  out.composer = time(() => r.composer.render(0.016));
  out.composerAgain = time(() => r.composer.render(0.016));
  out.plain = time(() => r.renderer.render(r.scene, r.camera));
  r.renderer.shadowMap.enabled = false;
  r.scene.traverse((o) => {
    if (o.material) o.material.needsUpdate = true;
  });
  r.renderer.render(r.scene, r.camera);
  out.plainNoShadow = time(() => r.renderer.render(r.scene, r.camera));
  const bg = r.scene.background;
  r.scene.background = null;
  out.noBg = time(() => r.renderer.render(r.scene, r.camera));
  r.scene.background = bg;
  return out;
});
console.info(JSON.stringify(res));
await browser.close();
