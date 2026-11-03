// The host page: start and end the day, today's code, every queue tool
// (reorder, remove, start any group), fixes for mistakes (undo an ended or
// removed game, send a group back to the line, rename or release a check-in,
// restore a cleared day) and the bug-report inbox.
import {
  api, h, createLive, waiting, courtCard, renderStatus,
} from './core.js';
import { queueItems } from './queue-list.js';
import { enableDrag, deferWhileDragging } from './dnd.js';
import { twoTapButton } from './two-tap.js';
import { historyItems } from './history.js';
import { promptDialog } from './dialogs.js';
import { setupPullToRefresh } from './pull-refresh.js';

const $ = (id) => document.getElementById(id);
const PIN_KEY = 'bq.hostPin';
const INBOX_REFRESH_MS = 60 * 1000;
// The server keeps a cleared day this long, so the Undo button shows as long.
const UNDO_DAY_MS = 30 * 60 * 1000;

const host = { pin: null, code: null, sessionId: undefined, inbox: [], undoDayUntil: 0 };
const rerender = () => render(live.state);

function readPin() {
  try { return sessionStorage.getItem(PIN_KEY); } catch { return null; }
}
function savePin(value) {
  try { sessionStorage.setItem(PIN_KEY, value); } catch { /* keep it in memory only */ }
}
function forgetPin() {
  try { sessionStorage.removeItem(PIN_KEY); } catch { /* nothing kept */ }
}

async function act(body) {
  $('error').textContent = '';
  try {
    const { state, result } = await api.action(body, { hostPin: host.pin });
    if (result && 'code' in result) host.code = result.code;
    if (body.type === 'startDay' || body.type === 'endDay') host.undoDayUntil = Date.now() + UNDO_DAY_MS;
    if (body.type === 'restoreDay') host.undoDayUntil = 0;
    live.push(state);
    rerender();
    return result ?? {};
  } catch (error) {
    $('error').textContent = error.message;
    return null;
  }
}

// Shown for a while after this page cleared the day, in case that was a mistake.
function undoDayButton() {
  if (host.undoDayUntil < Date.now()) return null;
  return twoTapButton({
    id: 'undo-day', label: 'Undo: bring back the cleared day', confirmLabel: 'Tap again to bring it back', className: 'secondary', rerender,
    onConfirm: () => act({ type: 'restoreDay' }),
  });
}

function renderToday(state) {
  const box = $('today');
  if (!state.session) {
    box.replaceChildren(
      h('div', { class: 'notice', text: 'No session running. Starting one creates today\'s code for people to check in with.' }),
      h('div', { class: 'row' },
        h('button', { type: 'button', onclick: () => act({ type: 'startDay' }) }, 'Start today\'s session'),
        undoDayButton()));
    return;
  }
  const started = new Date(state.session.startedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const doubled = state.roster.filter((m) => doubleKeys(state).has(m.key)).map((m) => m.name);
  // replaceChildren() would print a skipped (null) piece as the word "null".
  box.replaceChildren(...[
    h('div', { class: 'day-code num', text: host.code ?? '…' }),
    h('div', { class: 'small muted', text: `${state.roster.length} checked in · started ${started}` }),
    doubled.length ? h('button', {
      type: 'button', class: 'link alert-off',
      onclick: () => { $('roster-panel').open = true; $('roster-panel').scrollIntoView({ block: 'start' }); },
    }, `⚠ Signed up twice: ${doubled.join(', ')}`) : null,
    h('div', { class: 'row' },
      twoTapButton({
        id: 'new-code', label: 'New code', confirmLabel: 'Tap again for a new code', className: 'secondary', rerender,
        onConfirm: () => act({ type: 'newCode' }),
      }),
      twoTapButton({
        id: 'new-day', label: 'Start a new day', confirmLabel: 'Tap again: clear everything', className: 'secondary', rerender,
        onConfirm: () => act({ type: 'startDay' }),
      }),
      h('button', { type: 'button', class: 'danger', onclick: endDay }, 'End today'),
      undoDayButton()),
    h('div', { class: 'notice', text: 'New code: when the code got shared outside the hall; everyone checked in stays. Start a new day: clears everything and makes a new code. End today: clears everything and closes sign-ups until the next session. A day also ends on its own 18 hours after it started.' }),
  ].filter(Boolean));
}

// Clearing the day for everyone takes the password again, so nobody can do it
// from a host page left open on a shared computer.
async function endDay() {
  const confirmPin = await promptDialog({
    title: 'End today?',
    note: 'Courts, the line and check-ins clear for everyone. You can undo it within 30 minutes.',
    label: 'Host password',
    type: 'password',
    maxlength: 64,
    confirmLabel: 'End today',
    confirmKind: 'danger',
  });
  if (confirmPin) await act({ type: 'endDay', confirmPin });
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
  const doubles = doubleKeys(state);
  $('queue-empty').hidden = waiting(state).length > 0;
  $('queue').replaceChildren(...queueItems(state, {
    canDragPlayer: () => true,
    canDragGroups: true,
    playerExtra: (player, group) => [
      doubles.has(player.key) ? h('span', { class: 'badge double', title: 'Signed up twice', text: '2×' }) : null,
      h('button', {
        class: 'ghost remove', type: 'button', 'aria-label': `Remove ${player.name}`,
        onclick: () => act({ type: 'remove', groupId: group.id, playerKey: player.key }),
      }, '✕'),
    ],
    groupExtra: (group, index, count) => groupControls(state, group, index, count),
  }));
}

// Checked-in people: fix a typo, or take back a check-in.

async function renamePlayer(member) {
  const name = await promptDialog({ title: `Rename ${member.name}`, label: 'Correct name', value: member.name });
  if (name && name !== member.name) act({ type: 'rename', playerKey: member.key, name });
}

const spotsOf = (state, key) => state.groups.filter((g) => (g.status === 'waiting' || g.status === 'playing')
  && g.players.some((p) => p.key === key));
const spotLabel = (g) => (g.status === 'playing' ? `Court ${g.court}` : `Group ${g.no}`);

// Players are told "one spot each"; a second is allowed quietly, so the host keeps an eye on it.
function doubleKeys(state) {
  return new Set(state.roster.filter((m) => spotsOf(state, m.key).length > 1).map((m) => m.key));
}

function whereIs(state, member) {
  const spots = spotsOf(state, member.key);
  if (!spots.length) return 'Not in line';
  const where = spots.map(spotLabel).join(' · ');
  return spots.length > 1 ? `Signed up twice: ${where}` : where;
}

function renderRoster(state) {
  const doubles = doubleKeys(state);
  $('roster-count').textContent = String(state.roster.length);
  // Double sign-ups first, then everyone else by name.
  const members = [...state.roster].sort((a, b) => (doubles.has(b.key) - doubles.has(a.key)) || a.name.localeCompare(b.name));
  $('roster').replaceChildren(...members.map((member) => h('li', { class: 'friend-row' },
    h('div', {},
      h('div', { class: 'name', text: member.name }),
      h('div', { class: doubles.has(member.key) ? 'small alert-off' : 'small muted', text: whereIs(state, member) })),
    h('div', { class: 'row' },
      h('button', { type: 'button', class: 'ghost', onclick: () => renamePlayer(member) }, 'Rename'),
      twoTapButton({
        id: `release-${member.key}`, label: 'Remove', confirmLabel: 'Tap again', className: 'ghost', rerender,
        onConfirm: () => act({ type: 'release', playerKey: member.key }),
      })))));
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
  $('roster-panel').hidden = !state.session;
  if (state.session) renderRoster(state);
  $('courts').replaceChildren(...state.courts.map((court) => courtCard(state, court, {
    extra: (group) => (group ? h('div', { class: 'court-actions' },
      twoTapButton({
        id: `finish-${court.no}-${group.id}`, label: 'End game', confirmLabel: 'Tap again to end', className: 'secondary', rerender,
        onConfirm: () => act({ type: 'finish', courtNo: court.no, groupId: group.id }),
      }),
      // Started the wrong group? Free the court and put them back at the front of the line.
      twoTapButton({
        id: `back-${group.id}`, label: 'Back to line', confirmLabel: 'Tap again', className: 'secondary', rerender,
        onConfirm: () => act({ type: 'backToLine', groupId: group.id }),
      })) : null),
  })));
  renderQueue(state);
  // Ended or removed by mistake? Undo puts them back on their court, or at the front of the line.
  const history = historyItems(state, {
    extra: (group) => h('div', { class: 'row' }, twoTapButton({
      id: `reopen-${group.id}`, label: group.status === 'removed' ? 'Bring back' : 'Undo end', confirmLabel: 'Tap again', className: 'ghost', rerender,
      onConfirm: () => act({ type: 'reopen', groupId: group.id }),
    })),
  });
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
  $('sign-out').hidden = false;
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
// On a shared computer: forget the password here and go back to the sign-in box.
$('sign-out').addEventListener('click', () => {
  forgetPin();
  location.reload();
});

enableDrag($('queue'), {
  onPlayerDrop: ({ playerKey, fromGroupId, groupId }) => act({ type: 'movePlayer', playerKey, fromGroupId, groupId }),
  onGroupDrop: ({ groupId, beforeGroupId }) => act({ type: 'reorder', groupId, beforeGroupId }),
});

const live = createLive((state) => deferWhileDragging(() => render(state)), (status) => renderStatus($('sync'), status), { interval: () => 5000 });
setupPullToRefresh(live.refresh);
const remembered = readPin();
if (remembered) login(remembered).catch(() => {});
setInterval(loadInbox, INBOX_REFRESH_MS);
