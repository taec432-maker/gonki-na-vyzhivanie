/**
 * Фиксированный шаг симуляции 60 Гц + коэффициент интерполяции для рендера.
 * Симуляция всегда шагает ровно на STEP секунд; рендер рисует состояние между
 * двумя последними шагами (alpha), поэтому картинка плавная при любом fps.
 */
export const STEP_HZ = 60;
export const STEP = 1 / STEP_HZ;

export class FixedStepper {
  private acc = 0;
  /** Сколько шагов максимум за один кадр — защита от «спирали смерти» после зависания вкладки. */
  maxStepsPerFrame = 6;
  /** Множитель скорости (для ускоренных тестов). */
  timeScale = 1;
  paused = false;

  /** Возвращает число шагов, которые нужно сделать в этом кадре. */
  advance(realDt: number): number {
    if (this.paused) return 0;
    this.acc += Math.min(realDt, 0.25) * this.timeScale;
    let steps = Math.floor(this.acc / STEP);
    const limit = Math.max(this.maxStepsPerFrame, Math.ceil(this.timeScale * 2));
    if (steps > limit) {
      steps = limit;
      this.acc = 0;
    } else {
      this.acc -= steps * STEP;
    }
    return steps;
  }

  /** Доля между предыдущим и текущим шагом, 0..1. */
  get alpha(): number {
    return Math.min(1, this.acc / STEP);
  }

  reset(): void {
    this.acc = 0;
  }
}
