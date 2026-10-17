import type { Quaternion, Vector3 } from 'three';
import { InstancedMesh, Matrix4, Object3D, DynamicDrawUsage, type Scene } from 'three';
import { buildWheelGeometries } from './carModel';
import { carMaterials } from './materials';

/**
 * Все колёса всех машин — два draw call'а (шины и диски) через инстансинг.
 */
export class WheelRenderer {
  readonly tires: InstancedMesh;
  readonly rims: InstancedMesh;
  private readonly capacity: number;
  private used = 0;
  private readonly dummy = new Object3D();
  private readonly m = new Matrix4();

  constructor(scene: Scene, capacity = 4 * 24) {
    const { tire, rim } = buildWheelGeometries();
    this.capacity = capacity;
    this.tires = new InstancedMesh(tire, carMaterials.rubber(), capacity);
    this.rims = new InstancedMesh(rim, carMaterials.rim(), capacity);
    for (const im of [this.tires, this.rims]) {
      im.instanceMatrix.setUsage(DynamicDrawUsage);
      im.castShadow = true;
      im.receiveShadow = true;
      im.frustumCulled = false;
      im.count = 0;
      scene.add(im);
    }
  }

  begin(): void {
    this.used = 0;
  }

  /** Добавить колесо: мировая поза машины + локальная позиция колеса. */
  push(
    carPos: Vector3,
    carQuat: Quaternion,
    carScale: number,
    lx: number,
    ly: number,
    lz: number,
    steer: number,
    spin: number,
    radius: number,
    width: number,
    mirror: boolean,
  ): void {
    if (this.used >= this.capacity) return;
    const d = this.dummy;
    d.position
      .set(lx * carScale, ly, lz * carScale)
      .applyQuaternion(carQuat)
      .add(carPos);
    d.quaternion.copy(carQuat);
    d.rotateY(steer);
    d.rotateX(-spin);
    if (mirror) d.rotateY(Math.PI);
    d.scale.set(width * carScale, radius * carScale, radius * carScale);
    d.updateMatrix();
    this.m.copy(d.matrix);
    this.tires.setMatrixAt(this.used, this.m);
    this.rims.setMatrixAt(this.used, this.m);
    this.used++;
  }

  end(): void {
    this.tires.count = this.rims.count = this.used;
    this.tires.instanceMatrix.needsUpdate = true;
    this.rims.instanceMatrix.needsUpdate = true;
  }
}
