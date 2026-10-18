import { Color, Vector3, type PerspectiveCamera } from 'three';
import type { CarView } from '../render/carView';

interface Tag {
  el: HTMLElement;
  name: HTMLElement;
  hp: HTMLElement;
  hpFill: HTMLElement;
  carId: number;
  x: number;
  y: number;
  w: number;
  h: number;
  dist: number;
  visible: boolean;
  lastText: string;
  lastHp: number;
}

const tmp = new Vector3();

/** Цвет текста ника: цвет машины, но не темнее порога — чтобы читался на тёмной плашке. */
export function readableColor(hex: string): string {
  const c = new Color(hex);
  const lum = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  if (lum < 0.35) c.lerp(new Color('#ffffff'), 0.55 - lum);
  return `#${c.getHexString()}`;
}

/**
 * Ники над машинами (раздел 6 ТЗ, этап 2): HTML-плашки поверх canvas —
 * чёткий текст с обводкой, масштаб по дистанции (не мельче 18 px на 1080p),
 * раздвигаются при наложении и приглушаются под панелями HUD.
 */
export class NameTags {
  private readonly root: HTMLElement;
  private readonly tags = new Map<number, Tag>();
  /** Прямоугольники HUD, на которые ники не должны залезать. */
  private avoid: DOMRect[] = [];
  private avoidTimer = 0;
  showHp = false;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.id = 'nametags';
    parent.append(this.root);
  }

  private create(view: CarView): Tag {
    const el = document.createElement('div');
    el.className = 'nametag';
    const name = document.createElement('span');
    name.className = 'nt-name';
    const hp = document.createElement('span');
    hp.className = 'nt-hp';
    const hpFill = document.createElement('i');
    hp.append(hpFill);
    el.append(name, hp);
    this.root.append(el);
    const t: Tag = {
      el,
      name,
      hp,
      hpFill,
      carId: view.car.id,
      x: 0,
      y: 0,
      w: 0,
      h: 0,
      dist: 0,
      visible: false,
      lastText: '',
      lastHp: -1,
    };
    el.style.setProperty('--car', view.car.color);
    name.style.color = readableColor(view.car.color);
    return t;
  }

  /** Синхронизировать с набором машин. */
  sync(views: ReadonlyMap<number, CarView>): void {
    for (const [id, t] of this.tags)
      if (!views.has(id)) {
        t.el.remove();
        this.tags.delete(id);
      }
    for (const [id, v] of views) if (!this.tags.has(id)) this.tags.set(id, this.create(v));
  }

  setAvoid(elements: (HTMLElement | null)[]): void {
    this.avoid = elements
      .filter((e): e is HTMLElement => !!e && e.offsetParent !== null)
      .map((e) => e.getBoundingClientRect());
  }

  update(
    dt: number,
    camera: PerspectiveCamera,
    views: ReadonlyMap<number, CarView>,
    avoidEls: (HTMLElement | null)[],
  ): void {
    this.avoidTimer -= dt;
    if (this.avoidTimer <= 0) {
      this.setAvoid(avoidEls);
      this.avoidTimer = 0.2;
    }
    const W = this.root.clientWidth || window.innerWidth;
    const H = this.root.clientHeight || window.innerHeight;
    const k1080 = H / 1080;
    const list: Tag[] = [];
    for (const [id, v] of views) {
      const t = this.tags.get(id);
      if (!t) continue;
      const car = v.car;
      if (v.hidden || (car.race.out && !car.phys.ghost && v.model.root.visible === false)) {
        t.visible = false;
        t.el.style.display = 'none';
        continue;
      }
      tmp.copy(v.pos);
      tmp.y += car.spec.nameTagHeight * car.phys.scale;
      const dist = camera.position.distanceTo(tmp);
      tmp.project(camera);
      const visible = tmp.z < 1 && tmp.z > -1 && Math.abs(tmp.x) < 1.15 && Math.abs(tmp.y) < 1.15 && dist < 260;
      t.visible = visible;
      if (!visible) {
        t.el.style.display = 'none';
        continue;
      }
      t.el.style.display = '';
      t.dist = dist;
      // Масштаб по дистанции: ближе — крупнее, но не мельче 0.72 (≈ 19 px на 1080p).
      const scale = Math.max(0.72, Math.min(1.25, 26 / Math.max(1, dist) + 0.55)) * k1080;
      t.x = (tmp.x * 0.5 + 0.5) * W;
      t.y = (-tmp.y * 0.5 + 0.5) * H;
      if (t.lastText !== car.name) {
        t.lastText = car.name;
        t.name.textContent = car.name;
      }
      t.w = (t.el.offsetWidth || 120) * scale;
      t.h = (t.el.offsetHeight || 30) * scale;
      t.el.style.setProperty('--s', scale.toFixed(3));
      list.push(t);
    }
    // Ближние — сверху; дальние, наехавшие на ближних, отодвигаем вверх.
    list.sort((a, b) => a.dist - b.dist);
    for (let i = 0; i < list.length; i++) {
      const a = list[i] as Tag;
      for (let j = 0; j < i; j++) {
        const b = list[j] as Tag;
        const overlapX = Math.abs(a.x - b.x) < (a.w + b.w) / 2;
        const overlapY = Math.abs(a.y - b.y) < (a.h + b.h) / 2;
        if (overlapX && overlapY) a.y = b.y - (a.h + b.h) / 2 - 2;
      }
    }
    for (let i = 0; i < list.length; i++) {
      const t = list[i] as Tag;
      const left = t.x - t.w / 2;
      const top = t.y - t.h;
      const underHud = this.avoid.some(
        (r) => left < r.right && left + t.w > r.left && top < r.bottom && top + t.h > r.top,
      );
      t.el.style.transform = `translate(${t.x.toFixed(1)}px, ${t.y.toFixed(1)}px) translate(-50%, -100%) scale(var(--s))`;
      t.el.style.opacity = underHud ? '0.18' : '1';
      t.el.style.zIndex = String(100 - i);
      // Полоска HP (этап 4).
      const v = views.get(t.carId);
      if (v && this.showHp) {
        const hp = Math.round(Math.max(0, v.car.hp / v.car.maxHp) * 100);
        if (hp !== t.lastHp) {
          t.lastHp = hp;
          t.hpFill.style.width = `${hp}%`;
          t.hpFill.style.background = hp > 50 ? '#3ecf6e' : hp > 25 ? '#ffcc00' : '#ff4040';
        }
        t.hp.style.display = '';
      } else t.hp.style.display = 'none';
    }
  }

  /** Для тестов: видимые плашки и их размеры на экране. */
  measure(): { name: string; height: number; fontPx: number; visible: boolean }[] {
    return [...this.tags.values()].map((t) => {
      const r = t.el.getBoundingClientRect();
      const fs = parseFloat(getComputedStyle(t.name).fontSize) * Number(t.el.style.getPropertyValue('--s') || 1);
      return { name: t.lastText, height: r.height, fontPx: fs, visible: t.visible && t.el.style.opacity !== '0.18' };
    });
  }

  clear(): void {
    for (const t of this.tags.values()) t.el.remove();
    this.tags.clear();
  }
}
