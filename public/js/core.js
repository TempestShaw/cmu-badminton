// Shared by every page: talking to the API, polling, identity and a tiny
// element builder. Names from other people only ever reach the DOM as text.

const POLL_MS = 3000;
// A screen left open with nothing happening (say, overnight) slows right down.
const IDLE_SLOW_AFTER_MS = 10 * 60 * 1000;
const IDLE_SLOW_POLL_MS = 30 * 1000;
const IDLE_SLEEP_AFTER_MS = 60 * 60 * 1000;
const IDLE_SLEEP_POLL_MS = 5 * 60 * 1000;
// Phones coming back from the background often fail a request or two while the
// network wakes up: retry quickly and only call it offline if it keeps failing.
const RETRY_BASE_MS = 1000;
const FAILURES_BEFORE_OFFLINE = 3;
const STORAGE_PREFIX = 'bq.';
// After a new deploy, an open page reloads once nobody has touched it for this long.
const UPDATE_IDLE_MS = 30 * 1000;
const UPDATE_CHECK_MS = 5 * 1000;

export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else if (key === 'class') el.className = value;
    else if (key === 'text') el.textContent = value;
    else el.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

// ---------------------------------------------------------------- staying up to date
// Every reply names the deployment that sent it. A page left open (the court
// screen, a phone in a pocket) reloads itself once a newer one is live, but
// only when nobody is mid-tap, typing, dragging or looking at a dialog.
let firstVersion = null;
let updateTimer = null;
let lastInputAt = Date.now();
for (const type of ['pointerdown', 'keydown', 'input']) {
  addEventListener(type, () => { lastInputAt = Date.now(); }, { capture: true, passive: true });
}

const busy = () => Date.now() - lastInputAt < UPDATE_IDLE_MS
  || ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)
  || Boolean(document.querySelector('dialog[open]'))
  || document.body.classList.contains('dragging');

function noteVersion(version) {
  firstVersion ??= version;
  if (version === firstVersion || updateTimer) return;
  updateTimer = setInterval(() => { if (!busy()) location.reload(); }, UPDATE_CHECK_MS);
}

// A phone waking up can leave a request hanging forever; give up and retry instead.
const REQUEST_TIMEOUT_MS = 8000;

async function request(url, options = {}) {
  let response;
  try {
    response = await fetch(url, { ...options, signal: AbortSignal.timeout?.(REQUEST_TIMEOUT_MS) });
  } catch {
    throw new Error("Can't reach the server. Check your connection.");
  }
  const json = await response.json().catch(() => null);
  if (json?.version) noteVersion(json.version);
  if (!json?.success) {
    const error = new Error(json?.error?.message || `Server error (${response.status})`);
    error.code = json?.error?.code ?? null;
    error.details = json?.error?.details ?? null;
    throw error;
  }
  return json.data;
}

const authHeaders = ({ hostPin, kioskToken } = {}) => ({
  ...(hostPin ? { 'x-host-pin': hostPin } : {}),
  ...(kioskToken ? { 'x-kiosk-token': kioskToken } : {}),
});

export const api = {
  state: () => request('/api/state'),
  /** @returns {Promise<{state: object, result: object|null}>} */
  action: (body, auth) => request('/api/action', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(auth) },
    body: JSON.stringify(body),
  }),
  pushTest: (subscription, delaySeconds) => request('/api/pushtest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ subscription, delaySeconds }),
  }),
  report: (report) => request('/api/report', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(report),
  }),
  inbox: (hostPin) => request('/api/report', { headers: authHeaders({ hostPin }) }).then((d) => d.items),
  deleteInbox: (hostPin, id) => request(`/api/report?id=${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: authHeaders({ hostPin }),
  }),
  vapidKey: () => request('/api/subscribe').then((d) => d.vapidPublicKey),
  subscribe: (playerId, subscription) => request('/api/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ playerId, subscription }),
  }),
};

/**
 * Polls while the page is visible; `push` lets an action's response update immediately.
 * `interval` decides how often: every poll is a CDN request, which the free plan counts.
 */
export function createLive(onState, onStatus = () => {}, { interval = () => POLL_MS } = {}) {
  let timer = null;
  let latest = null;
  let latestJson = '';
  let changedAt = Date.now();

  const nextDelay = () => {
    const idle = Date.now() - changedAt;
    const base = interval(latest);
    if (idle > IDLE_SLEEP_AFTER_MS) return Math.max(base, IDLE_SLEEP_POLL_MS);
    if (idle > IDLE_SLOW_AFTER_MS) return Math.max(base, IDLE_SLOW_POLL_MS);
    return base;
  };

  // Redrawing swaps out buttons, which can swallow a tap in progress, so only
  // redraw when something changed.
  const accept = (state) => {
    const json = JSON.stringify(state);
    latest = state;
    if (json !== latestJson) {
      latestJson = json;
      changedAt = Date.now();
      onState(state);
    }
    onStatus({ online: true, at: Date.now() });
  };
  let failures = 0;
  let run = 0;
  const tick = async () => {
    clearTimeout(timer);
    // Only the newest tick schedules the next one, so waking up never starts a second loop.
    const mine = ++run;
    try {
      accept(await api.state());
      failures = 0;
    } catch (error) {
      failures += 1;
      onStatus(failures >= FAILURES_BEFORE_OFFLINE
        ? { online: false, message: error.message }
        : { online: false, reconnecting: true, message: 'Reconnecting…' });
    }
    if (mine !== run || document.visibilityState !== 'visible') return;
    const delay = failures ? Math.min(RETRY_BASE_MS * 2 ** (failures - 1), nextDelay()) : nextDelay();
    timer = setTimeout(tick, delay);
  };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') tick();
    else clearTimeout(timer);
  });
  window.addEventListener('online', tick);
  window.addEventListener('pageshow', (event) => { if (event.persisted) tick(); });
  tick();
  return { push: accept, refresh: tick, get state() { return latest; } };
}

export const storage = {
  get(key) {
    try { return localStorage.getItem(STORAGE_PREFIX + key); } catch { return null; }
  },
  set(key, value) {
    try { localStorage.setItem(STORAGE_PREFIX + key, value); } catch { /* private mode: keep going without it */ }
  },
};

let memoryId = null;

/** A random id kept on this device; the server only ever shows its hash. */
export function playerId() {
  const stored = storage.get('playerId');
  if (stored) return stored;
  memoryId ??= crypto.randomUUID();
  storage.set('playerId', memoryId);
  return memoryId;
}

export async function keyOf(id) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(id));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
}

export const isActive = (g) => g.status === 'waiting' || g.status === 'playing';
export const waiting = (state) => state.groups.filter((g) => g.status === 'waiting');
/** Mirrors the server: the first groups in line, one per free court, may start early. */
export const startable = (state) => waiting(state).filter((g) => g.players.length > 0)
  .slice(0, state.courts.filter((c) => !c.groupId).length);
export const groupById = (state, id) => state.groups.find((g) => g.id === id) ?? null;
export const GROUP_SIZE = 4;

export function setPlayerId(id) {
  memoryId = id;
  storage.set('playerId', id);
}

// "Live" while updates arrive; says how old the data is once it gets stale
// (polling slows down when nothing changes, so a clock would look stuck).
const STALE_AFTER_MS = 60 * 1000;
const STATUS_REPAINT_MS = 5000;
const statusByElement = new WeakMap();

function paintStatus(el) {
  const { online, at, message, reconnecting } = statusByElement.get(el);
  const age = Date.now() - at;
  el.classList.toggle('offline', !online && !reconnecting);
  el.classList.toggle('stale', reconnecting || (online && age > STALE_AFTER_MS));
  if (!online) el.textContent = message;
  else el.textContent = age > STALE_AFTER_MS ? `Updated ${Math.round(age / 60000)} min ago` : 'Live';
}

export function renderStatus(el, status) {
  if (!statusByElement.has(el)) setInterval(() => paintStatus(el), STATUS_REPAINT_MS);
  statusByElement.set(el, status);
  paintStatus(el);
}

/** Court cards shared by the phone page and the host page. */
export function courtCard(state, court, { mineKey, extra } = {}) {
  const group = court.groupId ? groupById(state, court.groupId) : null;
  if (!group) {
    return h('div', { class: 'court empty' },
      h('div', { class: 'label', text: `Court ${court.no}` }),
      h('div', { class: 'names', text: 'Free' }),
      extra?.(null));
  }
  const mine = mineKey && group.players.some((p) => p.key === mineKey);
  return h('div', { class: `court${mine ? ' mine' : ''}` },
    h('div', { class: 'label', text: `Court ${court.no}` }),
    h('div', { class: 'group num', text: `Group ${group.no}` }),
    h('div', { class: 'names', text: group.players.map((p) => p.name).join(', ') }),
    extra?.(group));
}
