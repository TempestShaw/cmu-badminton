// Getting word to a phone that someone's group is up: Web Push when the
// device supports it, plus sound, vibration and a full-screen banner while the
// page is open.
import { api, h } from './core.js';

const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

// iPhones get web push only in a Home Screen app, from iOS 16.4.
function iosVersion() {
  const match = navigator.userAgent.match(/OS (\d+)_(\d+)/);
  return match ? Number(match[1]) + Number(match[2]) / 100 : 0;
}
export const wantsHomeScreen = () => isIos() && !isStandalone() && iosVersion() >= 16.04;

// Highlighted words: `key` looks like the thing to tap, `em` is the point to notice.
const key = (text) => h('span', { class: 'key' }, text);
const em = (text) => h('strong', { class: 'hl' }, text);

// Where the Share button is depends on the browser.
function shareStep() {
  const ua = navigator.userAgent;
  if (/CriOS/.test(ua)) return ['Tap ', key('Share'), ' next to the address bar (top right)'];
  if (/EdgiOS|FxiOS/.test(ua)) return ['Open the browser menu (☰ or ⋯) and tap ', key('Share')];
  return ['Tap ', key('Share'), ' at the bottom of Safari (the square with an arrow)'];
}

export function homeScreenSteps() {
  return h('ol', { class: 'steps' },
    h('li', {}, ...shareStep()),
    h('li', {}, 'Choose ', key('Add to Home Screen'), ', then tap ', key('Add')),
    h('li', {}, 'Open ', em('CMU Rec BMT'), ' from your Home Screen and check in there with today\'s code'));
}

function base64ToBytes(base64) {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

export async function registerWorker() {
  if (!('serviceWorker' in navigator)) return null;
  try {
    return await navigator.serviceWorker.register('/sw.js');
  } catch {
    return null;
  }
}

/** Where this device stands: 'on' | 'off' | 'denied' | 'needs-home-screen' | 'unsupported' | 'unconfigured'. */
export async function pushStatus(vapidKey) {
  if (!vapidKey) return 'unconfigured';
  if (!pushSupported()) return isIos() && !isStandalone() ? 'needs-home-screen' : 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) return 'unsupported';
  return (await reg.pushManager.getSubscription()) ? 'on' : 'off';
}

export async function enablePush(vapidKey, playerId) {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Notifications weren\'t allowed. You can turn them on in your phone settings.');
  const reg = await navigator.serviceWorker.ready;
  const subscription = (await reg.pushManager.getSubscription())
    ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64ToBytes(vapidKey) });
  await api.subscribe(playerId, subscription.toJSON());
}

/** After this phone takes over a name, point its notifications at that player. No-op until they're on. */
export async function linkSubscription(playerId) {
  if (!pushSupported() || Notification.permission !== 'granted') return;
  const reg = await navigator.serviceWorker.getRegistration();
  const subscription = await reg?.pushManager.getSubscription();
  if (subscription) await api.subscribe(playerId, subscription.toJSON());
}

// Sent after a delay so there's time to lock the phone first.
export const TEST_DELAY_SECONDS = 10;

export async function sendTestPush() {
  const reg = await navigator.serviceWorker.getRegistration();
  const subscription = await reg?.pushManager.getSubscription();
  if (!subscription) throw new Error('Notifications aren\'t set up on this phone yet');
  await api.pushTest(subscription.toJSON(), TEST_DELAY_SECONDS);
}

/** Renders the notification panel for the current status. */
export function pushPanel(status, { onEnable, onTest, busy, error, note }) {
  const panel = h('section', { class: 'panel' });
  if (status === 'on') {
    panel.append(
      h('div', { class: 'notice', text: '✓ Notifications are on.' }),
      onTest ? h('div', { class: 'row' }, h('button', { class: 'secondary', type: 'button', onclick: onTest, disabled: busy }, busy ? 'Lock your phone now…' : 'Send a test in 10 seconds')) : null,
    );
  } else if (status === 'off') {
    panel.append(
      h('div', { text: 'Turn on notifications and your phone will ring when it\'s your turn, so you don\'t have to keep watching the screen.' }),
      h('button', { onclick: onEnable, disabled: busy }, busy ? 'Setting up…' : 'Turn on notifications'),
    );
  } else if (status === 'needs-home-screen') {
    panel.append(
      h('div', { text: 'On iPhone, alerts reach a locked phone only from the Home Screen app:' }),
      homeScreenSteps(),
      h('div', { class: 'notice', text: 'When it asks “Is that you?”, tap Yes, then turn on notifications there.' }),
      h('div', { class: 'notice', text: 'Skipping this is fine: while this page is open, it still beeps and vibrates when it\'s your turn.' }),
    );
  } else if (status === 'denied') {
    panel.append(h('div', { class: 'notice', text: 'Notifications are blocked. To get them, allow notifications for this site in your phone settings.' }));
  } else if (status === 'unsupported') {
    panel.append(h('div', { class: 'notice', text: 'This browser can\'t receive push notifications. Keep this page open and it will beep and vibrate when it\'s your turn.' }));
  } else {
    return null;
  }
  if (note) panel.append(h('div', { class: 'notice', text: note }));
  if (error) panel.append(h('div', { class: 'error', text: error }));
  return panel;
}

// Audio needs a tap before it may play; any tap on the page unlocks it.
let audio = null;
export function unlockAudio() {
  if (audio) return;
  try {
    audio = new AudioContext();
  } catch {
    audio = null;
  }
}

function beep() {
  if (!audio) return;
  const start = audio.currentTime;
  [0, 0.35, 0.7].forEach((offset) => {
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, start + offset);
    gain.gain.exponentialRampToValueAtTime(0.4, start + offset + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + offset + 0.28);
    osc.connect(gain).connect(audio.destination);
    osc.start(start + offset);
    osc.stop(start + offset + 0.3);
  });
}

export function showTurnAlert(group, { title = 'You\'re up!' } = {}) {
  navigator.vibrate?.([400, 150, 400, 150, 400]);
  beep();
  const close = () => overlay.remove();
  const overlay = h('div', { class: 'alert', role: 'alertdialog', 'aria-live': 'assertive' },
    h('div', { text: title }),
    h('div', { class: 'big', text: `Court ${group.court}` }),
    h('div', { text: `Group ${group.no} · ${group.players.map((p) => p.name).join(', ')}` }),
    h('button', { onclick: close }, 'Got it'));
  document.body.append(overlay);
}

let wakeLock = null;
/** Keeps the screen on while the person is queued; browsers may refuse. */
export async function keepAwake(wanted) {
  try {
    if (wanted && !wakeLock && document.visibilityState === 'visible' && 'wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } else if (!wanted && wakeLock) {
      await wakeLock.release();
    }
  } catch {
    wakeLock = null;
  }
}
