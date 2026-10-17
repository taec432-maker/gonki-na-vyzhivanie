import {
  BufferAttribute,
  BufferGeometry,
  DynamicDrawUsage,
  Mesh,
  MeshStandardMaterial,
  Vector3,
  type Scene,
} from 'three';

/**
 * Следы шин (раздел 2 ТЗ): кольцевой буфер полосок-«декалей» на асфальте, один draw call.
 * Колесо оставляет след, когда проскальзывает (занос, торможение, старт).
 */
const MAX = 3000;

export class SkidMarks {
  private readonly pos = new Float32Array(MAX * 4 * 3);
  private readonly alpha = new Float32Array(MAX * 4);
  private readonly geo = new BufferGeometry();
  readonly mesh: Mesh;
  private next = 0;
  private readonly last = new Map<string, Vector3>();
  private readonly tmp = new Vector3();

  constructor(scene: Scene) {
    const index = new Uint32Array(MAX * 6);
    for (let i = 0; i < MAX; i++) {
      const v = i * 4;
      index.set([v, v + 1, v + 2, v + 1, v + 3, v + 2], i * 6);
    }
    this.geo.setIndex(new BufferAttribute(index, 1));
    this.geo.setAttribute('position', new BufferAttribute(this.pos, 3).setUsage(DynamicDrawUsage));
    this.geo.setAttribute('alpha', new BufferAttribute(this.alpha, 1).setUsage(DynamicDrawUsage));
    const mat = new MeshStandardMaterial({
      color: '#0a0a0a',
      roughness: 0.6,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -3,
    });
    mat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float alpha;\nvarying float vSkid;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSkid = alpha;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vSkid;')
        .replace('#include <dithering_fragment>', '#include <dithering_fragment>\ngl_FragColor.a *= vSkid;');
    };
    this.mesh = new Mesh(this.geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
    this.mesh.renderOrder = 1;
    scene.add(this.mesh);
  }

  /** Добавить след колеса: key — «машина:колесо», p — точка контакта, right — ось колеса. */
  add(key: string, p: Vector3, right: Vector3, width: number, strength: number): void {
    const prev = this.last.get(key);
    if (!prev || prev.distanceToSquared(p) > 9) {
      this.last.set(key, p.clone());
      return;
    }
    if (prev.distanceToSquared(p) < 0.25) return;
    const i = this.next;
    this.next = (this.next + 1) % MAX;
    const hw = width / 2;
    const v = i * 12;
    const lift = 0.03;
    this.tmp.copy(right).multiplyScalar(hw);
    this.pos.set(
      [
        prev.x - this.tmp.x,
        prev.y + lift,
        prev.z - this.tmp.z,
        prev.x + this.tmp.x,
        prev.y + lift,
        prev.z + this.tmp.z,
      ],
      v,
    );
    this.pos.set(
      [p.x - this.tmp.x, p.y + lift, p.z - this.tmp.z, p.x + this.tmp.x, p.y + lift, p.z + this.tmp.z],
      v + 6,
    );
    const a = Math.min(0.75, 0.25 + strength * 0.6);
    this.alpha.set([a, a, a, a], i * 4);
    prev.copy(p);
    const pa = this.geo.getAttribute('position') as BufferAttribute;
    pa.needsUpdate = true;
    (this.geo.getAttribute('alpha') as BufferAttribute).needsUpdate = true;
  }

  /** Колесо перестало скользить — разорвать полосу. */
  lift(key: string): void {
    this.last.delete(key);
  }

  clear(): void {
    this.pos.fill(0);
    this.alpha.fill(0);
    this.last.clear();
    this.next = 0;
    (this.geo.getAttribute('position') as BufferAttribute).needsUpdate = true;
    (this.geo.getAttribute('alpha') as BufferAttribute).needsUpdate = true;
  }
}
