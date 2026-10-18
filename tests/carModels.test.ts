import { Box3, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { buildCarModel } from '../src/render/carModel';
import { VEHICLES } from '../src/vehicles';

/**
 * Процедурные модели не выходят за габариты машины: «вывернутое» сечение кузова
 * однажды растянуло фургон мороженщика на 400 м поперёк кадра.
 */
describe('Процедурные модели машин', () => {
  for (const spec of VEHICLES)
    it(`«${spec.name}» — в пределах своих габаритов`, () => {
      const model = buildCarModel(spec, '#ff7a00');
      const size = new Box3().setFromObject(model.root).getSize(new Vector3());
      expect(size.x).toBeLessThan(spec.dims.width * 1.6);
      expect(size.z).toBeLessThan(spec.dims.length * 1.4);
      expect(size.y).toBeLessThan(spec.dims.height * 2.2);
    });
});
