// The host page: start and end the day, today's code, every queue tool
// (reorder, remove, start any group), and the bug-report inbox.
import {
  api, h, createLive, waiting, courtCard, renderStatus,
} from './core.js';
import { queueItems } from './queue-list.js';
import { enableDrag, deferWhileDragging } from './dnd.js';
import { twoTapButton } from './two-tap.js';
import { historyItems } from './history.js';

const $ = (id) => document.getElementById(id);
const PIN_KEY = 'bq.hostPin';
const INBOX_REFRESH_MS = 60 * 1000;

const host = { pin: null, code: null, sessionId: undefined, inbox: [] };
const rerender = () => render(live.state);

function readPin() {
  try { return sessionStorage.getItem(PIN_KEY); } catch { return null; }
}
function savePin(value) {
  try { sessionStorage.setItem(PIN_KEY, value); } catch { /* keep it in memory only */ }
}

async function act(body) {
  $('error').textContent = '';
  try {
    const { state, result } = await api.action(body, { hostPin: host.pin });
    if (result && 'code' in result) host.code = result.code;
    live.push(state);
    rerender();
    return result ?? {};
  } catch (error) {
    $('error').textContent = error.message;
    return null;
  }
}

function renderToday(state) {
  const box = $('today');
  if (!state.session) {
    box.replaceChildren(
      h('div', { class: 'notice', text: 'No session running. Starting one creates today\'s code for people to check in with.' }),
      h('div', { class: 'row' }, h('button', { type: 'button', onclick: () => act({ type: 'startDay' }) }, 'Start today\'s session')));
    return;
  }
  const started = new Date(state.session.startedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  box.replaceChildren(
    h('div', { class: 'day-code num', text: host.code ?? '…' }),
    h('div', { class: 'small muted', text: `${state.roster.length} checked in · started ${started}` }),
    h('div', { class: 'row' },
      twoTapButton({
        id: 'new-code', label: 'New code', confirmLabel: 'Tap again for a new code', className: 'secondary', rerender,
        onConfirm: () => act({ type: 'newCode' }),
      }),
      twoTapButton({
        id: 'new-day', label: 'Start a new day', confirmLabel: 'Tap again: clear everything', className: 'secondary', rerender,
        onConfirm: () => act({ type: 'startDay' }),
      }),
      twoTapButton({
        id: 'end-day', label: 'End today', confirmLabel: 'Tap again to end the day', className: 'danger', rerender,
        onConfirm: () => act({ type: 'endDay' }),
      })),
    h('div', { class: 'notice', text: 'New code: when the code got shared outside the hall; everyone checked in stays. Start a new day: clears everything and makes a new code. End today: clears everything and closes sign-ups until the next session. A day also ends on its own 18 hours after it started.' }));
}

function groupControls(state, group, index, count) {
  const freeCourts = state.courts.filter((c) => !c.groupId);
  return h('div', { class: 'row group-actions' },
    h('button', { class: 'ghost', type: 'button', disabled: index === 0, 'aria-label': 'Move up',
      onclick: () => act({ type: 'move', groupId: group.id, direction: -1 }) }, '↑ Up'),
    h('button', { class: 'ghost', type: 'button', disabled: index === count - 1, 'aria-label': 'Move down',
      onclick: () => act({ type: 'move', groupId: group.id, direction: 1 }) }, '↓ Down'),
    freeCourts.length ? h('button', { class: 'secondary', type: 'button',
      onclick: () => act({ type: 'start', groupId: group.id }) }, 'Start now') : null,
    twoTapButton({
      id: `disband-${group.id}`, label: 'Remove group', confirmLabel: 'Tap again to remove', className: 'ghost', rerender,
      onConfirm: () => act({ type: 'disband', groupId: group.id }),
    }));
}

function renderQueue(state) {
  $('queue-empty').hidden = waiting(state).length > 0;
  $('queue').replaceChildren(...queueItems(state, {
    canDragPlayer: () => true,
    canDragGroups: true,
    playerExtra: (player, group) => h('button', {
      class: 'ghost remove', type: 'button', 'aria-label': `Remove ${player.name}`,
      onclick: () => act({ type: 'remove', groupId: group.id, playerKey: player.key }),
    }, '✕'),
    groupExtra: (group, index, count) => groupControls(state, group, index, count),
  }));
}

// Inbox: bug reports sent from any page.

function renderInbox() {
  $('inbox-empty').hidden = host.inbox.length > 0;
  $('inbox').replaceChildren(...host.inbox.map((item) => h('li', { class: 'inbox-item' },
    h('div', { class: 'row spread' },
      h('span', { class: 'small muted', text: item.name || 'Anonymous' }),
      h('span', { class: 'small muted', text: new Date(item.at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) })),
    h('div', { class: 'inbox-message', text: item.message }),
    h('div', { class: 'small muted', text: [item.page, item.context].filter(Boolean).join(' · ') }),
    item.userAgent ? h('div', { class: 'small muted ua', text: item.userAgent }) : null,
    h('div', { class: 'row' }, h('button', { type: 'button', class: 'ghost', onclick: () => deleteItem(item.id) }, 'Delete')))));
}

async function loadInbox() {
  if (!host.pin) return;
  $('inbox-error').textContent = '';
  try {
    host.inbox = await api.inbox(host.pin);
    renderInbox();
  } catch (error) {
    $('inbox-error').textContent = error.message;
  }
}

async function deleteItem(id) {
  try {
    await api.deleteInbox(host.pin, id);
    host.inbox = host.inbox.filter((item) => item.id !== id);
    renderInbox();
  } catch (error) {
    $('inbox-error').textContent = error.message;
  }
}

function render(state) {
  if (!state || !host.pin) return;
  // Another host may have started a new day; fetch the new code.
  const stamp = state.session ? `${state.session.id}:${state.session.codeVersion}` : null;
  if (stamp !== host.sessionId) {
    const known = host.sessionId !== undefined;
    host.sessionId = stamp;
    if (known) act({ type: 'verify' });
  }
  renderToday(state);
  $('courts').replaceChildren(...state.courts.map((court) => courtCard(state, court, {
    extra: (group) => (group ? twoTapButton({
      id: `finish-${court.no}-${group.id}`, label: 'End game', confirmLabel: 'Tap again to end', className: 'secondary', rerender,
      onConfirm: () => act({ type: 'finish', courtNo: court.no, groupId: group.id }),
    }) : null),
  })));
  renderQueue(state);
  const history = historyItems(state);
  $('history-empty').hidden = history.length > 0;
  $('history').replaceChildren(...history);
}

async function login(candidate) {
  const { state, result } = await api.action({ type: 'verify' }, { hostPin: candidate });
  host.pin = candidate;
  host.code = result.code;
  host.sessionId = state.session ? `${state.session.id}:${state.session.codeVersion}` : null;
  savePin(candidate);
  $('login').hidden = true;
  $('panel').hidden = false;
  live.push(state);
  render(state);
  loadInbox();
}

$('login').addEventListener('submit', async (event) => {
  event.preventDefault();
  $('login-error').textContent = '';
  try {
    await login($('pin').value);
  } catch (error) {
    $('login-error').textContent = error.message;
  }
});
$('inbox-refresh').addEventListener('click', loadInbox);

enableDrag($('queue'), {
  onPlayerDrop: ({ playerKey, fromGroupId, groupId }) => act({ type: 'movePlayer', playerKey, fromGroupId, groupId }),
  onGroupDrop: ({ groupId, beforeGroupId }) => act({ type: 'reorder', groupId, beforeGroupId }),
});

const live = createLive((state) => deferWhileDragging(() => render(state)), (status) => renderStatus($('sync'), status), { interval: () => 5000 });
const remembered = readPin();
if (remembered) login(remembered).catch(() => {});
setInterval(loadInbox, INBOX_REFRESH_MS);
