import { LinkChannel, relayUrlFor } from '../core/channel';

/** Прозрачный оверлей для второго Browser Source в OBS. Лидерборд и лента — на этапе 7. */
document.documentElement.style.background = 'transparent';
document.body.style.background = 'transparent';
const channel = new LinkChannel('overlay', relayUrlFor(location));
channel.send('hello', null);
