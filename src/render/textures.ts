import { CanvasTexture, LinearSRGBColorSpace, RepeatWrapping, SRGBColorSpace, type Texture } from 'three';
import { Rng } from '../core/rng';

/**
 * Процедурные PBR-текстуры (свои, без лицензий): асфальт, трава, песок, снег…
 * Генерируются один раз при загрузке на canvas; детерминированно по seed.
 */
export interface PbrSet {
  map: Texture;
  roughnessMap: Texture;
  normalMap: Texture;
}

type Rgb = [number, number, number];

function hexToRgb(hex: string): Rgb {
  const v = parseInt(hex.replace('#', ''), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

/** Тайлящийся value-noise с октавами. */
function makeNoise(size: number, seed: number, octaves: number, base: number): Float32Array {
  const rng = new Rng(seed);
  const out = new Float32Array(size * size);
  let amp = 1;
  let total = 0;
  for (let o = 0; o < octaves; o++) {
    const cells = base << o;
    const grid = new Float32Array(cells * cells);
    for (let i = 0; i < grid.length; i++) grid[i] = rng.next();
    const k = cells / size;
    for (let y = 0; y < size; y++) {
      const gy = y * k;
      const y0 = Math.floor(gy);
      const fy = gy - y0;
      const sy = fy * fy * (3 - 2 * fy);
      const r0 = (y0 % cells) * cells;
      const r1 = ((y0 + 1) % cells) * cells;
      for (let x = 0; x < size; x++) {
        const gx = x * k;
        const x0 = Math.floor(gx);
        const fx = gx - x0;
        const sx = fx * fx * (3 - 2 * fx);
        const c0 = x0 % cells;
        const c1 = (x0 + 1) % cells;
        const a = (grid[r0 + c0] as number) + ((grid[r0 + c1] as number) - (grid[r0 + c0] as number)) * sx;
        const b = (grid[r1 + c0] as number) + ((grid[r1 + c1] as number) - (grid[r1 + c0] as number)) * sx;
        out[y * size + x] = (out[y * size + x] as number) + (a + (b - a) * sy) * amp;
      }
    }
    total += amp;
    amp *= 0.5;
  }
  for (let i = 0; i < out.length; i++) out[i] = (out[i] as number) / total;
  return out;
}

function canvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D, ImageData] {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
  return [c, ctx, ctx.createImageData(size, size)];
}

function normalFromHeight(h: Float32Array, size: number, strength: number): HTMLCanvasElement {
  const [c, ctx, img] = canvas(size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const l = h[y * size + ((x - 1 + size) % size)] as number;
      const r = h[y * size + ((x + 1) % size)] as number;
      const u = h[((y - 1 + size) % size) * size + x] as number;
      const d = h[((y + 1) % size) * size + x] as number;
      let nx = (l - r) * strength;
      let ny = (u - d) * strength;
      let nz = 1;
      const len = Math.hypot(nx, ny, nz);
      nx /= len;
      ny /= len;
      nz /= len;
      const k = (y * size + x) * 4;
      img.data[k] = (nx * 0.5 + 0.5) * 255;
      img.data[k + 1] = (ny * 0.5 + 0.5) * 255;
      img.data[k + 2] = (nz * 0.5 + 0.5) * 255;
      img.data[k + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

function tex(c: HTMLCanvasElement, srgb: boolean, repeat = true): Texture {
  const t = new CanvasTexture(c);
  t.colorSpace = srgb ? SRGBColorSpace : LinearSRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = RepeatWrapping;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

export interface GroundStyle {
  color: string;
  /** Второй цвет (пятна, прожилки). */
  color2: string;
  /** Контраст пятен. */
  mottle: number;
  /** Мелкие «камешки» (асфальт, гравий): доля пикселей. */
  speckle: number;
  roughness: [number, number];
  normal: number;
}

const cache = new Map<string, PbrSet>();

/** Однородная поверхность (трава, песок, снег, грунт, бетон, асфальт без разметки). */
export function groundTexture(key: string, st: GroundStyle, size = 512, seed = 7): PbrSet {
  const ck = `${key}:${size}`;
  const hit = cache.get(ck);
  if (hit) return hit;
  const big = makeNoise(size, seed, 5, 4);
  const fine = makeNoise(size, seed + 1, 3, 64);
  const rng = new Rng(seed + 2);
  const c1 = hexToRgb(st.color);
  const c2 = hexToRgb(st.color2);
  const [cm, ctxm, imgm] = canvas(size);
  const [cr, ctxr, imgr] = canvas(size);
  const height = new Float32Array(size * size);
  for (let i = 0; i < size * size; i++) {
    const b = big[i] as number;
    const f = fine[i] as number;
    const m = Math.min(1, Math.max(0, (b - 0.5) * st.mottle + 0.5));
    let shade = 0.82 + f * 0.36;
    let h = f * 0.6 + b * 0.4;
    if (st.speckle > 0 && rng.next() < st.speckle) {
      const k = rng.next();
      shade *= k < 0.5 ? 0.55 : 1.35;
      h += 0.35;
    }
    const k4 = i * 4;
    imgm.data[k4] = Math.min(255, (c1[0] + (c2[0] - c1[0]) * m) * shade);
    imgm.data[k4 + 1] = Math.min(255, (c1[1] + (c2[1] - c1[1]) * m) * shade);
    imgm.data[k4 + 2] = Math.min(255, (c1[2] + (c2[2] - c1[2]) * m) * shade);
    imgm.data[k4 + 3] = 255;
    const rough = st.roughness[0] + (st.roughness[1] - st.roughness[0]) * (0.5 * f + 0.5 * m);
    imgr.data[k4] = imgr.data[k4 + 1] = imgr.data[k4 + 2] = rough * 255;
    imgr.data[k4 + 3] = 255;
    height[i] = h;
  }
  ctxm.putImageData(imgm, 0, 0);
  ctxr.putImageData(imgr, 0, 0);
  const set: PbrSet = {
    map: tex(cm, true),
    roughnessMap: tex(cr, false),
    normalMap: tex(normalFromHeight(height, size, st.normal), false),
  };
  cache.set(ck, set);
  return set;
}

export const GROUND_STYLES: Record<string, GroundStyle> = {
  asphalt: { color: '#3b3d40', color2: '#2c2e31', mottle: 1.4, speckle: 0.06, roughness: [0.78, 0.95], normal: 2.2 },
  wet: { color: '#26282b', color2: '#1b1c1e', mottle: 1.6, speckle: 0.05, roughness: [0.08, 0.35], normal: 1.6 },
  grass: { color: '#4d6b2c', color2: '#6b7d38', mottle: 2.2, speckle: 0.0, roughness: [0.85, 1], normal: 3 },
  sand: { color: '#c7a26a', color2: '#b38a55', mottle: 1.6, speckle: 0.02, roughness: [0.85, 1], normal: 1.4 },
  dirt: { color: '#7a6248', color2: '#5e4a36', mottle: 1.8, speckle: 0.04, roughness: [0.8, 1], normal: 2.6 },
  snow: { color: '#e9eef4', color2: '#cfd9e6', mottle: 1.2, speckle: 0.0, roughness: [0.55, 0.8], normal: 1.2 },
  ice: { color: '#b9d3e6', color2: '#93b6cf', mottle: 1.6, speckle: 0.0, roughness: [0.03, 0.15], normal: 0.6 },
  concrete: { color: '#7f7d79', color2: '#6a6864', mottle: 1.4, speckle: 0.03, roughness: [0.75, 0.92], normal: 1.4 },
  metal: { color: '#5d6066', color2: '#4a4d52', mottle: 1, speckle: 0.0, roughness: [0.35, 0.6], normal: 0.8 },
  rock: { color: '#7d7166', color2: '#5b524a', mottle: 2.4, speckle: 0.03, roughness: [0.8, 1], normal: 4 },
};

/**
 * Дорога с разметкой: u — поперёк дороги (0..1), v — вдоль (одна плитка = 16 м).
 * Белые линии по краям, прерывистая по центру.
 */
export function roadTexture(
  style: 'asphalt' | 'wet' | 'dirt' | 'snow' | 'ice' | 'sand' | 'grass' | 'metal',
  marks: boolean,
): PbrSet {
  const ck = `road:${style}:${marks}`;
  const hit = cache.get(ck);
  if (hit) return hit;
  const groundStyle = GROUND_STYLES[style] ?? (GROUND_STYLES.asphalt as GroundStyle);
  const base = groundTexture(style, groundStyle, 1024, 11);
  if (!marks) {
    cache.set(ck, base);
    return base;
  }
  const size = 1024;
  const draw = (src: Texture, paint: (ctx: CanvasRenderingContext2D) => void, srgb: boolean): Texture => {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d') as CanvasRenderingContext2D;
    ctx.drawImage(src.image as HTMLCanvasElement, 0, 0);
    paint(ctx);
    return tex(c, srgb);
  };
  const lines = (ctx: CanvasRenderingContext2D, color: string): void => {
    ctx.fillStyle = color;
    const edge = size * 0.035;
    ctx.fillRect(size * 0.03, 0, edge * 0.6, size);
    ctx.fillRect(size * 0.97 - edge * 0.6, 0, edge * 0.6, size);
    for (let k = 0; k < 2; k++) ctx.fillRect(size * 0.4965, k * (size / 2), size * 0.012, size * 0.25);
  };
  const set: PbrSet = {
    map: draw(base.map, (ctx) => lines(ctx, 'rgba(225,225,215,0.92)'), true),
    roughnessMap: draw(base.roughnessMap, (ctx) => lines(ctx, 'rgb(150,150,150)'), false),
    normalMap: base.normalMap,
  };
  cache.set(ck, set);
  return set;
}
