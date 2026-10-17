import { Raycaster, Vector3, type Object3D, type PerspectiveCamera, type Quaternion } from 'three';

/**
 * Камера за машиной с плавным догоном (критически демпфированная пружина).
 * Режиссёр (этап 1) решает, за кем следить; эта часть отвечает за плавность.
 */
export class ChaseCamera {
  readonly pos = new Vector3();
  readonly look = new Vector3();
  private readonly vel = new Vector3();
  private readonly lookVel = new Vector3();
  distance = 7.2;
  height = 2.9;
  lookAhead = 6;
  stiffness = 10;
  private initialized = false;
  private readonly tmp = new Vector3();
  private readonly fwd = new Vector3();
  private readonly ray = new Raycaster();
  private readonly from = new Vector3();
  private readonly dir = new Vector3();
  /** Постройки (краны, склады, контейнеры): камера не должна оказаться за ними. */
  occluders: Object3D[] = [];

  /** Мгновенно поставить камеру (смена цели без «перелёта» через полкарты). */
  snap(): void {
    this.initialized = false;
  }

  update(dt: number, cam: PerspectiveCamera, target: Vector3, q: Quaternion, speed: number, scale = 1): void {
    this.fwd.set(0, 0, -1).applyQuaternion(q);
    this.fwd.y = 0;
    this.fwd.normalize();
    const dist = (this.distance + Math.min(speed, 40) * 0.06) * Math.sqrt(scale);
    const desired = this.tmp.copy(target).addScaledVector(this.fwd, -dist);
    desired.y = target.y + this.height * Math.sqrt(scale);
    const lookAt = target.clone().addScaledVector(this.fwd, this.lookAhead);
    lookAt.y += 0.8;
    if (!this.initialized) {
      this.pos.copy(desired);
      this.look.copy(lookAt);
      this.vel.set(0, 0, 0);
      this.lookVel.set(0, 0, 0);
      this.initialized = true;
    }
    spring(this.pos, this.vel, desired, this.stiffness, dt);
    spring(this.look, this.lookVel, lookAt, this.stiffness * 1.6, dt);
    cam.position.copy(this.pos);
    // Между машиной и камерой постройка — камера подъезжает ближе (не прячет машину).
    if (this.occluders.length) {
      this.from.copy(target).setY(target.y + 1.2);
      this.dir.subVectors(this.pos, this.from);
      const len = this.dir.length();
      if (len > 0.5) {
        this.ray.set(this.from, this.dir.multiplyScalar(1 / len));
        this.ray.far = len;
        const hit = this.ray.intersectObjects(this.occluders, true)[0];
        if (hit) cam.position.copy(this.from).addScaledVector(this.dir, Math.max(1.5, hit.distance - 0.6));
      }
    }
    cam.lookAt(this.look);
  }
}

/** Критически демпфированная пружина к цели. */
export function spring(x: Vector3, v: Vector3, target: Vector3, k: number, dt: number): void {
  const omega = k;
  const exp = Math.exp(-omega * dt);
  const dx = x.clone().sub(target);
  const temp = v.clone().addScaledVector(dx, omega).multiplyScalar(dt);
  v.sub(temp.clone().multiplyScalar(omega)).multiplyScalar(exp);
  x.copy(target).add(dx.add(temp).multiplyScalar(exp));
}
