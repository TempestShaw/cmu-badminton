// The court-side screen: today's code and QR, the courts with a "Done playing"
// button each, the line (anyone can drag people around), and walk-up sign-up.
// Unlocked once with the host password; it then keeps a token instead.
import {
  api, h, createLive, storage, waiting, courtCard, renderStatus,
} from './core.js';
import { queueItems } from './queue-list.js';
import { enableDrag, deferWhileDragging } from './dnd.js';
import {
  partyError, groupOptions, fillSelect, peopleLabel, nameBoxes, fillNameSuggestions,
} from './together.js';
import { twoTapButton } from './two-tap.js';
import { alertDialog, reportProblem } from './dialogs.js';
import { setupVoice, announce } from './kiosk-voice.js';
import { historyItems } from './history.js';

const $ = (id) => document.getElementById(id);
const kiosk = { token: storage.get('kioskToken') || null, code: null, codeStamp: undefined };
const rerender = () => render(live.state);

function setError(message) {
  $('error').textContent = message;
}

function lock(message = '') {
  kiosk.token = null;
  storage.set('kioskToken', '');
  $('unlock').hidden = false;
  $('board').hidden = true;
  $('voice').hidden = true;
  $('unlock-error').textContent = message;
}

function showBoard() {
  $('unlock').hidden = true;
  $('board').hidden = false;
  $('voice').hidden = false;
}

async function act(body, onError = setError) {
  onError('');
  try {
    const { state, result } = await api.action(body, { kioskToken: kiosk.token });
    live.push(state);
    return result ?? {};
  } catch (error) {
    if (error.code === 'not_kiosk') lock('This screen got locked (maybe the host password changed). Unlock it again.');
    else if (error.code === 'signup_limit') alertDialog('Already signed up', error.message);
    else onError(error.message);
    return null;
  }
}

// Today's code

function renderCode() {
  const { code } = kiosk;
  $('day-code').textContent = code ?? '—';
  $('no-session-note').hidden = Boolean(code);
  $('qr').hidden = !code;
  $('site-url').textContent = code ? `Scan, or open ${location.host} and type the code` : '';
  if (!code || typeof window.qrcode !== 'function') return;
  const qr = window.qrcode(0, 'M');
  qr.addData(`${location.origin}/?code=${code}`);
  qr.make();
  $('qr').innerHTML = qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
}

async function refreshCode() {
  if (!kiosk.token) return;
  const result = await act({ type: 'sessionInfo' });
  if (!result) return;
  kiosk.code = result.code;
  renderCode();
}

// Board

function groupControls(state, group) {
  const anyFree = state.courts.some((c) => !c.groupId);
  return h('div', { class: 'row group-actions' },
    anyFree ? twoTapButton({
      id: `start-${group.id}`,
      label: 'Start now',
      confirmLabel: `Tap again: start with ${group.players.length}`,
      className: 'secondary',
      rerender,
      onConfirm: () => act({ type: 'start', groupId: group.id }),
    }) : null,
    twoTapButton({
      id: `disband-${group.id}`,
      label: 'Remove group',
      confirmLabel: 'Tap again to remove',
      className: 'ghost',
      rerender,
      onConfirm: () => act({ type: 'disband', groupId: group.id }),
    }));
}

const walkupBoxes = nameBoxes($('walkup-names'));

function renderWalkup(state) {
  fillNameSuggestions($('roster-names'), state);
  const count = walkupBoxes.names().length;
  $('walkup-submit').textContent = count ? `Sign up ${peopleLabel(count)}` : 'Sign up';
  fillSelect($('walkup-group'), groupOptions(state, count));
}

function render(state) {
  if (!state || !kiosk.token) return;
  // Only the code's version is public; fetch the code itself when it changes.
  const stamp = state.session ? `${state.session.id}:${state.session.codeVersion}` : null;
  if (stamp !== kiosk.codeStamp) {
    kiosk.codeStamp = stamp;
    refreshCode();
  }
  $('courts').replaceChildren(...state.courts.map((court) => courtCard(state, court, {
    extra: (group) => (group ? twoTapButton({
      id: `finish-${court.no}-${group.id}`,
      label: 'Done playing',
      confirmLabel: 'Tap again to confirm',
      rerender,
      onConfirm: () => act({ type: 'finish', courtNo: court.no, groupId: group.id }),
    }) : null),
  })));
  $('queue-empty').hidden = waiting(state).length > 0;
  $('queue').replaceChildren(...queueItems(state, {
    canDragPlayer: () => true,
    groupExtra: (group) => groupControls(state, group),
  }));
  const history = historyItems(state);
  $('history-empty').hidden = history.length > 0;
  $('history').replaceChildren(...history);
  renderWalkup(state);
  announce(state);
}

// Events

$('unlock').addEventListener('submit', async (event) => {
  event.preventDefault();
  $('unlock-error').textContent = '';
  try {
    const { state, result } = await api.action({ type: 'verify' }, { hostPin: $('unlock-pin').value });
    kiosk.token = result.kioskToken;
    kiosk.code = result.code;
    storage.set('kioskToken', kiosk.token);
    $('unlock-pin').value = '';
    showBoard();
    renderCode();
    live.push(state);
    render(state);
  } catch (error) {
    $('unlock-error').textContent = error.message;
  }
});

$('walkup-names').addEventListener('input', () => { if (live.state) renderWalkup(live.state); });

$('walkup').addEventListener('submit', async (event) => {
  event.preventDefault();
  const names = walkupBoxes.names();
  const showWalkupError = (message) => { $('walkup-error').textContent = message; };
  const problem = partyError(names.length);
  if (problem) {
    showWalkupError(problem);
    return;
  }
  const done = await act({ type: 'joinTogether', names, groupId: $('walkup-group').value }, showWalkupError);
  if (done) {
    walkupBoxes.clear();
    renderWalkup(live.state);
  }
});

$('report').addEventListener('click', () => reportProblem({ context: 'court screen' }));
setupVoice($('voice'));

enableDrag($('queue'), {
  onPlayerDrop: ({ playerKey, fromGroupId, groupId }) => act({ type: 'movePlayer', playerKey, fromGroupId, groupId }),
});

let wakeLock = null;
async function stayAwake() {
  try {
    if (!wakeLock && 'wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    }
  } catch {
    wakeLock = null;
  }
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') stayAwake(); });

const live = createLive((state) => deferWhileDragging(() => render(state)), (status) => renderStatus($('sync'), status));
if (kiosk.token) showBoard();
else lock();
stayAwake();
