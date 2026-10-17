/**
 * Каталог эффектов (раздел 7 ТЗ). Числа — стартовые, редактируются в маппинге подарков:
 * «сила» (power) масштабирует длительность/количество/урон в зависимости от эффекта.
 */
export type EffectId =
  | 'nitro'
  | 'rocket'
  | 'repair'
  | 'oil'
  | 'repairOrOil'
  | 'shield'
  | 'mines'
  | 'emp'
  | 'monster'
  | 'armageddon'
  | 'teleport'
  | 'nails'
  | 'ghost'
  | 'magnet'
  | 'joke'
  | 'swapcar'
  | 'revive';

/** Внутренние состояния машины, которые накладывают эффекты (не выбираются в маппинге). */
export type StatusId = EffectId | 'oiled' | 'emped' | 'punctured' | 'mower' | 'magnetized';

export interface EffectInfo {
  id: EffectId;
  label: string;
  /** Короткое пояснение для панели. */
  hint: string;
  /** Длительность (с) при силе 1, 0 — мгновенный. */
  duration: number;
  /** Иконка (эмодзи) для ленты. */
  icon: string;
}

export const EFFECTS: Record<EffectId, EffectInfo> = {
  nitro: { id: 'nitro', label: 'Нитро', hint: '+40 % мощности, пламя из выхлопа', duration: 2, icon: '🔥' },
  rocket: {
    id: 'rocket',
    label: 'Ракета',
    hint: 'самонаводящаяся на ближайшего впереди, 25 урона',
    duration: 0,
    icon: '🚀',
  },
  repair: { id: 'repair', label: 'Ремонт', hint: '+40 HP', duration: 0, icon: '🔧' },
  oil: { id: 'oil', label: 'Масло', hint: 'пятно позади на 20 с, проезд — занос 1,5 с', duration: 20, icon: '🛢️' },
  repairOrOil: {
    id: 'repairOrOil',
    label: 'Ремонт / Масло',
    hint: 'побит (HP < 70) — ремонт, цел — масло под соперников',
    duration: 0,
    icon: '🔧',
  },
  shield: { id: 'shield', label: 'Щит', hint: 'неуязвимость, синий кокон', duration: 8, icon: '🛡️' },
  mines: { id: 'mines', label: 'Мины', hint: '×3 позади, 35 урона', duration: 0, icon: '💣' },
  emp: { id: 'emp', label: 'ЭМИ', hint: 'все соперники глохнут на 2,5 с', duration: 2.5, icon: '⚡' },
  monster: { id: 'monster', label: 'Монстр', hint: '×2 размер, неуязвим, таран = 60 урона', duration: 10, icon: '👹' },
  armageddon: {
    id: 'armageddon',
    label: 'Армагеддон',
    hint: 'метеоритный дождь: всем, кроме дарителя, 50 урона; даритель +1 позиция',
    duration: 0,
    icon: '☄️',
  },
  teleport: { id: 'teleport', label: 'Телепорт', hint: '+1 позиция', duration: 0, icon: '🌀' },
  nails: { id: 'nails', label: 'Гвозди', hint: 'прокол всех позади: −30 % скорости на 6 с', duration: 6, icon: '📌' },
  ghost: { id: 'ghost', label: 'Призрак', hint: 'проезд сквозь машины 5 с', duration: 5, icon: '👻' },
  magnet: { id: 'magnet', label: 'Магнит', hint: 'стягивает соперников к себе', duration: 3, icon: '🧲' },
  joke: { id: 'joke', label: 'Шутка', hint: 'соперники на газонокосилках 8 с', duration: 8, icon: '🤡' },
  swapcar: { id: 'swapcar', label: 'Смена машины', hint: 'своя машина → случайная редкая', duration: 0, icon: '🎲' },
  revive: {
    id: 'revive',
    label: 'Воскрешение',
    hint: 'только в «Выживании»: вернуть себя в гонку',
    duration: 0,
    icon: '✨',
  },
};

export const EFFECT_IDS = Object.keys(EFFECTS) as EffectId[];

export function isEffectId(v: unknown): v is EffectId {
  return typeof v === 'string' && v in EFFECTS;
}
