import './styles/game.css';
import { readParams } from './core/params';
import { Game } from './game';

const canvas = document.getElementById('scene') as HTMLCanvasElement;
const loader = document.getElementById('loader') as HTMLElement;
const bar = document.getElementById('loader-bar') as HTMLElement;
const label = document.getElementById('loader-label') as HTMLElement;

const params = readParams();
const game = new Game(canvas, params);
(window as unknown as { __game: Game }).__game = game;

game
  .start((k, text) => {
    bar.style.width = `${Math.round(k * 100)}%`;
    label.textContent = text;
  })
  .then(() => loader.classList.add('hidden'))
  .catch((e: unknown) => {
    label.textContent = `Ошибка загрузки: ${String(e)}`;
    console.error(e);
  });
