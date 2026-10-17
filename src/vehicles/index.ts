import type { VehicleSpec } from './types';
import sports from './sports.json';
import muscle from './muscle.json';
import supercar from './supercar.json';
import mower from './mower.json';

/** Все машины ростера, по номеру для чата. */
export const VEHICLES: VehicleSpec[] = [sports, muscle, supercar, mower]
  .map((v) => v as VehicleSpec)
  .sort((a, b) => a.number - b.number);

export function vehicleById(id: string): VehicleSpec {
  const v = VEHICLES.find((x) => x.id === id);
  if (!v) throw new Error(`Нет машины ${id}`);
  return v;
}
