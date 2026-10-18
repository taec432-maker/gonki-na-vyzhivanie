import type { VehicleSpec } from './types';
import formula from './formula.json';
import sports from './sports.json';
import supercar from './supercar.json';
import rally from './rally.json';
import muscle from './muscle.json';
import pickup from './pickup.json';
import jeep from './jeep.json';
import armored from './armored.json';
import hearse from './hearse.json';
import limo from './limo.json';
import tractor from './tractor.json';
import mower from './mower.json';
import cart from './cart.json';
import icecream from './icecream.json';
import garbage from './garbage.json';
import buggy from './buggy.json';

/** Все машины ростера, по номеру для чата. */
export const VEHICLES: VehicleSpec[] = [
  formula,
  sports,
  supercar,
  rally,
  muscle,
  pickup,
  jeep,
  armored,
  hearse,
  limo,
  tractor,
  mower,
  cart,
  icecream,
  garbage,
  buggy,
]
  .map((v) => v as VehicleSpec)
  .sort((a, b) => a.number - b.number);

export function vehicleById(id: string): VehicleSpec {
  const v = VEHICLES.find((x) => x.id === id);
  if (!v) throw new Error(`Нет машины ${id}`);
  return v;
}
