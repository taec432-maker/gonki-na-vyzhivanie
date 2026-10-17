import type { LinkChannel } from '../core/channel';
import { EFFECTS, EFFECT_IDS, type EffectId } from '../combat/effects';
import catalog from '../gifts/catalog.json';
import { DEFAULT_MAPPING, sanitizeMapping, type GiftMapping } from '../gifts/mapping';
import type { GameStatus } from '../game';

/** Подарок из списка Bridge (или запасного каталога). */
export interface GiftInfo {
  id: string;
  name: string;
  diamonds: number;
  icon: string | null;
}

const esc = (t: string): string => t.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Разбор ответа GET /api/tiktok/gifts?withIcons=1 — формат терпимый к вариантам полей. */
export function parseGiftList(raw: unknown): GiftInfo[] {
  const arr = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as { gifts?: unknown[] })?.gifts)
      ? (raw as { gifts: unknown[] }).gifts
      : Array.isArray((raw as { data?: unknown[] })?.data)
        ? (raw as { data: unknown[] }).data
        : [];
  const out: GiftInfo[] = [];
  for (const g of arr as Record<string, unknown>[]) {
    if (!g || typeof g !== 'object') continue;
    const id = String(g.id ?? g.giftId ?? g.gift_id ?? '');
    const name = String(g.name ?? g.giftName ?? g.gift_name ?? '');
    const diamonds = Number(g.diamondCount ?? g.diamond_count ?? g.diamonds ?? g.cost ?? 0);
    const img = g.image as { url_list?: string[]; url?: string } | undefined;
    const icon =
      (g.icon as string) ??
      (g.iconUrl as string) ??
      (g.giftPictureUrl as string) ??
      (g.picture as string) ??
      img?.url_list?.[0] ??
      img?.url ??
      null;
    if (!name) continue;
    out.push({
      id,
      name,
      diamonds: Number.isFinite(diamonds) ? diamonds : 0,
      icon: typeof icon === 'string' ? icon : null,
    });
  }
  return out.sort((a, b) => a.diamonds - b.diamonds || a.name.localeCompare(b.name));
}

function effectOptions(selected: string, withTier: boolean): string {
  const opts = EFFECT_IDS.map(
    (id) =>
      `<option value="${id}" ${id === selected ? 'selected' : ''}>${EFFECTS[id].icon} ${EFFECTS[id].label}</option>`,
  );
  if (withTier) opts.unshift(`<option value="" ${selected === '' ? 'selected' : ''}>— по тиру —</option>`);
  return opts.join('');
}

/** Раздел панели «Подарки»: тест-подарки, Bridge, маппинг. */
export function mountGifts(root: HTMLElement, channel: LinkChannel): (s: GameStatus) => void {
  root.insertAdjacentHTML(
    'beforeend',
    `<section>
      <h2>TikTok Bridge</h2>
      <div class="row"><span id="br-state" class="pill">—</span><span id="br-live" class="muted"></span></div>
      <div class="row">
        <label>Адрес <input id="br-host" size="12" /></label>
        <label>Порт <input id="br-port" size="5" /></label>
        <select id="br-mode"><option value="auto">авто (только с 127.0.0.1)</option><option value="on">включён</option><option value="off">выключен</option></select>
        <button id="br-apply">Применить</button>
      </div>
      <div class="muted" id="br-info"></div>
    </section>
    <section>
      <h2>Подарки и лайки (тест)</h2>
      <div class="row"><label>От кого <select id="gf-who"><option value="">случайный в заезде</option></select></label></div>
      <div class="row">
        <label>Алмазов <input type="number" id="gf-dia" value="10" min="1" style="width:80px" /></label>
        <label>Комбо × <input type="number" id="gf-cnt" value="1" min="1" max="99" style="width:60px" /></label>
        <button class="primary" id="gf-send">Подарить</button>
      </div>
      <div class="row" id="gf-tiers"></div>
      <div class="row"><button id="gf-likes">Лайки ×50</button><span class="muted" id="gf-likebar"></span></div>
    </section>
    <section style="grid-column: 1 / -1">
      <h2>Подарки → эффекты</h2>
      <div class="row muted">Сначала ищется подарок по имени/ID (таблица справа), иначе — тир по стоимости одного сообщения (алмазы × комбо).</div>
      <div class="row" style="align-items:flex-start; gap:24px">
        <div><b>Тиры по алмазам</b><table id="mp-tiers"></table></div>
        <div style="flex:1; min-width:420px"><b>Подарки</b> <span class="muted" id="mp-src"></span>
          <div class="row"><input id="mp-filter" placeholder="поиск" size="14" /><button id="mp-reload">Обновить список из Bridge</button></div>
          <div style="max-height:420px; overflow:auto"><table id="mp-gifts"></table></div></div>
      </div>
      <div class="row">
        <label>Лайков на общий нитро <input type="number" id="mp-likes" min="10" style="width:90px" /></label>
        <label>Нитро, с <input type="number" id="mp-likesec" min="0.5" step="0.5" style="width:70px" /></label>
      </div>
      <div class="row">
        <button class="primary" id="mp-save">Сохранить маппинг</button>
        <button id="mp-export">Экспорт JSON</button>
        <label class="pill" style="cursor:pointer">Импорт JSON <input type="file" id="mp-import" accept=".json,application/json" hidden /></label>
        <button class="danger" id="mp-reset">По умолчанию</button>
        <span id="mp-msg" class="muted"></span>
      </div>
    </section>`,
  );
  const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
  let mapping: GiftMapping | null = null;
  let gifts: GiftInfo[] = (catalog.gifts as { id: string; name: string; diamonds: number }[]).map((g) => ({
    ...g,
    icon: null,
  }));
  let giftsFrom = 'запасной список (Bridge недоступен)';
  let bridgeLoaded = false;
  let host = '127.0.0.1';
  let port = 3100;

  // Быстрые кнопки по тирам.
  const tierBtns = $('gf-tiers');
  for (const d of [1, 10, 50, 100, 300, 500, 1000, 5000]) {
    const b = document.createElement('button');
    b.textContent = `${d} 💎`;
    b.addEventListener('click', () => {
      $<HTMLInputElement>('gf-dia').value = String(d);
      send();
    });
    tierBtns.append(b);
  }
  const send = (): void =>
    channel.send('mock-gift', {
      userId: $<HTMLSelectElement>('gf-who').value,
      diamonds: Number($<HTMLInputElement>('gf-dia').value),
      count: Number($<HTMLInputElement>('gf-cnt').value),
      giftName: 'Тестовый подарок',
    });
  $('gf-send').addEventListener('click', send);
  $('gf-likes').addEventListener('click', () => channel.send('mock-likes', { count: 50 }));
  $('br-apply').addEventListener('click', () =>
    channel.send('bridge', {
      host: $<HTMLInputElement>('br-host').value.trim(),
      port: Number($<HTMLInputElement>('br-port').value),
      enabled: $<HTMLSelectElement>('br-mode').value,
    }),
  );

  const renderTiers = (): void => {
    if (!mapping) return;
    $('mp-tiers').innerHTML =
      '<tr><th>от</th><th>до</th><th>эффект</th><th>сила</th></tr>' +
      mapping.tiers
        .map(
          (t, i) => `<tr><td><input data-t="${i}" data-k="min" value="${t.min}" style="width:60px" /></td>
          <td><input data-t="${i}" data-k="max" value="${t.max >= 1e8 ? '∞' : t.max}" style="width:70px" /></td>
          <td><select data-t="${i}" data-k="effect">${effectOptions(t.effect, false)}</select></td>
          <td><input data-t="${i}" data-k="power" value="${t.power}" style="width:50px" /></td></tr>`,
        )
        .join('');
  };
  const renderGifts = (): void => {
    if (!mapping) return;
    const f = $<HTMLInputElement>('mp-filter').value.trim().toLowerCase();
    $('mp-src').textContent = `— ${giftsFrom}`;
    $('mp-gifts').innerHTML =
      '<tr><th></th><th>подарок</th><th>💎</th><th>эффект</th><th>сила</th></tr>' +
      gifts
        .filter((g) => !f || g.name.toLowerCase().includes(f))
        .map((g) => {
          const o = mapping?.overrides.find(
            (x) => (g.id && x.giftId === g.id) || x.giftName?.toLowerCase() === g.name.toLowerCase(),
          );
          return `<tr><td>${g.icon ? `<img src="${esc(g.icon)}" width="24" height="24" referrerpolicy="no-referrer" />` : ''}</td>
            <td>${esc(g.name)}</td><td>${g.diamonds}</td>
            <td><select data-g="${esc(g.id)}" data-n="${esc(g.name)}" data-k="effect">${effectOptions(o?.effect ?? '', true)}</select></td>
            <td><input data-g="${esc(g.id)}" data-n="${esc(g.name)}" data-k="power" value="${o?.power ?? 1}" style="width:50px" /></td></tr>`;
        })
        .join('');
  };
  $('mp-filter').addEventListener('input', renderGifts);

  // Правки таблиц сразу в локальную копию маппинга.
  root.addEventListener('change', (e) => {
    const el = e.target as HTMLInputElement | HTMLSelectElement;
    if (!mapping) return;
    if (el.dataset.t !== undefined) {
      const t = mapping.tiers[Number(el.dataset.t)];
      if (!t) return;
      const k = el.dataset.k;
      if (k === 'effect') t.effect = el.value as EffectId;
      else if (k === 'min') t.min = Number(el.value) || 0;
      else if (k === 'max') t.max = el.value.trim() === '∞' ? 999999999 : Number(el.value) || 0;
      else if (k === 'power') t.power = Number(el.value) || 1;
    } else if (el.dataset.g !== undefined) {
      const id = el.dataset.g ?? '';
      const name = el.dataset.n ?? '';
      const idx = mapping.overrides.findIndex(
        (x) => (id && x.giftId === id) || x.giftName?.toLowerCase() === name.toLowerCase(),
      );
      const row = root.querySelectorAll<HTMLElement>(`[data-n="${CSS.escape(name)}"]`);
      const effect = (row[0] as HTMLSelectElement | undefined)?.value ?? '';
      const power = Number((row[1] as HTMLInputElement | undefined)?.value) || 1;
      if (!effect) {
        if (idx >= 0) mapping.overrides.splice(idx, 1);
      } else {
        const o = { ...(id ? { giftId: id } : {}), giftName: name, effect: effect as EffectId, power };
        if (idx >= 0) mapping.overrides[idx] = o;
        else mapping.overrides.push(o);
      }
    } else if (el.id === 'mp-likes') mapping.likes.target = Number(el.value) || 500;
    else if (el.id === 'mp-likesec') mapping.likes.nitroSeconds = Number(el.value) || 3;
  });

  const msg = (t: string): void => {
    $('mp-msg').textContent = t;
    setTimeout(() => ($('mp-msg').textContent = ''), 4000);
  };
  $('mp-save').addEventListener('click', () => {
    if (!mapping) return;
    mapping = sanitizeMapping(mapping);
    channel.send('gifts', mapping);
    renderTiers();
    msg('Сохранено в игре.');
  });
  $('mp-reset').addEventListener('click', () => {
    mapping = sanitizeMapping(DEFAULT_MAPPING);
    channel.send('gifts', mapping);
    renderTiers();
    renderGifts();
    msg('Маппинг по умолчанию.');
  });
  $('mp-export').addEventListener('click', () => {
    if (!mapping) return;
    const blob = new Blob([JSON.stringify(mapping, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'gonki-podarki.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  $<HTMLInputElement>('mp-import').addEventListener('change', async (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    try {
      mapping = sanitizeMapping(JSON.parse(await file.text()));
      channel.send('gifts', mapping);
      renderTiers();
      renderGifts();
      msg('Импортировано и сохранено в игре.');
    } catch {
      msg('Не получилось прочитать файл — это точно JSON маппинга?');
    }
  });

  const loadGifts = async (): Promise<void> => {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 3000);
      const r = await fetch(`http://${host}:${port}/api/tiktok/gifts?withIcons=1`, { signal: ctrl.signal });
      clearTimeout(t);
      const list = parseGiftList(await r.json());
      if (list.length) {
        gifts = list;
        giftsFrom = `из Bridge: ${list.length} шт.`;
      }
    } catch {
      giftsFrom = 'запасной список (Bridge недоступен)';
    }
    renderGifts();
  };
  $('mp-reload').addEventListener('click', () => void loadGifts());

  const STATE: Record<string, [string, string]> = {
    connected: ['подключён', 'ok'],
    connecting: ['подключается…', ''],
    disconnected: ['нет связи', 'bad'],
    foreign: ['чужой сервер!', 'bad'],
    off: ['выключен (мок-режим)', ''],
  };
  let firstStatus = true;
  return (s: GameStatus) => {
    if (firstStatus) {
      firstStatus = false;
      mapping = sanitizeMapping(s.settings.gifts);
      host = s.settings.bridge.host;
      port = s.settings.bridge.port;
      $<HTMLInputElement>('br-host').value = host;
      $<HTMLInputElement>('br-port').value = String(port);
      $<HTMLSelectElement>('br-mode').value = s.settings.bridge.enabled;
      $<HTMLInputElement>('mp-likes').value = String(mapping.likes.target);
      $<HTMLInputElement>('mp-likesec').value = String(mapping.likes.nitroSeconds);
      renderTiers();
      renderGifts();
    }
    if (!bridgeLoaded && s.bridge?.state === 'connected') {
      bridgeLoaded = true;
      void loadGifts();
    }
    const st = STATE[s.bridge?.state ?? 'off'] ?? ['—', ''];
    $('br-state').textContent = `Bridge: ${st[0]}`;
    $('br-state').className = `pill ${st[1]}`;
    $('br-live').textContent =
      s.bridge?.state === 'connected'
        ? s.bridge.live === false
          ? 'TikTok не в эфире'
          : s.bridge.live
            ? 'TikTok в эфире'
            : ''
        : '';
    $('br-info').textContent = s.bridge
      ? `${s.bridge.url}${s.bridge.error ? ` — ${s.bridge.error}` : ''}${s.bridge.state !== 'connected' && s.bridge.retryIn ? ` · повтор через ${Math.round(s.bridge.retryIn / 1000)} с` : ''} · событий: ${s.bridge.events}`
      : 'Мок-режим: события только из этой панели.';
    $('gf-likebar').textContent =
      `нитро-бар: ${s.likes.bar}/${s.likes.target}${s.likes.bursts ? ` · ×${s.likes.bursts}` : ''}`;
    const who = $<HTMLSelectElement>('gf-who');
    const key = s.roster.map((p) => p.id).join(',');
    if (who.dataset.key !== key) {
      const cur = who.value;
      who.dataset.key = key;
      who.innerHTML =
        '<option value="">случайный в заезде</option>' +
        [...s.roster, ...s.queue].map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('');
      who.value = cur;
    }
  };
}
