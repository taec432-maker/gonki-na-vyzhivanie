// Ретранслятор сообщений между страницами игры (/, /control, /overlay).
// Нужен, когда игра открыта в OBS, а панель — в Chrome: это разные браузеры.
import { WebSocketServer } from 'ws';

export function attachRelay(server) {
  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname !== '/relay') return;
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });
  wss.on('connection', (ws) => {
    ws.on('message', (data) => {
      const text = data.toString();
      if (text.length > 1_000_000) return;
      for (const client of wss.clients) if (client !== ws && client.readyState === 1) client.send(text);
    });
  });
  return wss;
}
