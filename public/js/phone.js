// The phone page: check in with today's code, join a group, sign up friends,
// see where you are in line, and get an alert when it's your turn.
import {
  api, h, createLive, storage, playerId, setPlayerId, keyOf, isActive, waiting, startable, courtCard, renderStatus, GROUP_SIZE,
} from './core.js';
import {
  registerWorker, pushStatus, enablePush, linkSubscription, sendTestPush, pushPanel, unlockAudio, showTurnAlert, keepAwake,
  wantsHomeScreen, homeScreenSteps,
} from './notify.js';
import { queueItems } from './queue-list.js';
import { enableDrag, deferWhileDragging } from './dnd.js';
import { loadFriends, addFriends, pruneFriends, forgetFriends } from './friends.js';
import { setupTogether, renderTogether } from './phone-together.js';
import { twoTapButton } from './two-tap.js';
import { openDialog, alertDialog, pickDialog, reportProblem } from './dialogs.js';
import { setupInstall } from './install.js';
import { historyItems } from './history.js';
import { setupPullToRefresh } from './pull-refresh.js';
import { createLookPicker } from './look-picker.js';
import { animateRedraw, animateCourts } from './motion.js';

const $ = (id) => document.getElementById(id);
// Don't flash "you're up" at someone who opens the page long after being called.
const ALERT_WINDOW_MS = 5 * 60 * 1000;
// People in line refresh often; someone just looking refreshes slowly. The
// "you're up" alert itself comes by push, so it doesn't depend on this.
const IN_LINE_POLL_MS = 8000;
const WATCHING_POLL_MS = 20000;

// ---------------------------------------------------------------- state

// This phone's player: `id` is its secret, `key` the public hash shown in the line.
const me = { id: playerId(), key: null };
const ui = { busy: false, push: { status: null, busy: false, error: '', note: '' }, vapidKey: null };
let friends = loadFriends();

// The QR code on the court screen carries today's code; keep it out of the address bar.
const params = new URLSearchParams(location.search);
if (params.has('code')) {
  storage.set('code', params.get('code'));
  history.replaceState(null, '', location.pathname);
}

const nameInput = $('name');
const codeInput = $('code');
nameInput.value = storage.get('name') ?? '';
codeInput.value = storage.get('code') ?? '';
nameInput.addEventListener('input', () => storage.set('name', nameInput.value));
document.addEventListener('pointerdown', unlockAudio, { once: true });

// ---------------------------------------------------------------- helpers

const friendKeys = () => new Set(friends.map((f) => f.key));
const myMember = (state) => state.roster.find((m) => m.key === me.key) ?? null;
const myGroups = (state) => state.groups.filter((g) => isActive(g) && g.players.some((p) => p.key === me.key));
const freeCourt = (state) => state.courts.find((c) => !c.groupId) ?? null;
const rerender = () => { if (live.state) render(live.state); };

// ---------------------------------------------------------------- sending actions

function showError(message) {
  $('action-error').textContent = message;
}

function explain(error, onOther) {
  if (error.code === 'signup_limit') alertDialog('Already signed up', error.message);
  else onOther(error.message);
}

async function act(body, onError = showError) {
  if (ui.busy) return null;
  ui.busy = true;
  showError('');
  try {
    const { state, result } = await api.action({ playerId: me.id, ...body });
    live.push(state);
    return result ?? {};
  } catch (error) {
    explain(error, onError);
    live.refresh();
    return null;
  } finally {
    ui.busy = false;
  }
}

// ---------------------------------------------------------------- check-in

// After claiming a name (e.g. one a friend wrote down), this phone becomes that player.
async function adopt(memberId) {
  setPlayerId(memberId);
  me.id = memberId;
  me.key = await keyOf(memberId);
  linkSubscription(memberId).catch(() => {});
}

async function confirmSamePerson({ name, claimed }) {
  const choice = await openDialog({
    title: claimed ? `${name} is already here` : `A friend signed up ${name}`,
    body: [claimed
      ? `Someone checked in as ${name} today. If that was you on another phone, carry on here. If you're a different ${name}, add a last initial instead.`
      : `If that's you, this phone takes over ${name}'s spot so you can manage it and get the alerts.`],
    actions: [
      { label: `I'm someone else`, value: 'rename', kind: 'secondary' },
      { label: `Yes, I'm ${name}`, value: 'claim' },
    ],
  });
  if (choice === 'claim') return checkIn(true);
  if (choice === 'rename') nameInput.select();
  return null;
}

async function checkIn(claim = false) {
  $('checkin-error').textContent = '';
  try {
    const { state, result } = await api.action({
      type: 'checkIn', playerId: me.id, name: nameInput.value, code: codeInput.value, claim,
    });
    storage.set('code', codeInput.value.trim());
    if (result?.memberId && result.memberId !== me.id) await adopt(result.memberId);
    live.push(state);
    render(state);
  } catch (error) {
    if (error.code === 'name_taken') confirmSamePerson(error.details);
    else $('checkin-error').textContent = error.message;
  }
}

async function switchPerson() {
  const choice = await openDialog({
    title: 'Switch person on this phone?',
    body: ['Your spots in line stay. You can check in again under another name.'],
    actions: [{ label: 'Cancel', value: 'cancel', kind: 'secondary' }, { label: 'Switch', value: 'switch' }],
  });
  if (choice !== 'switch') return;
  setPlayerId(crypto.randomUUID());
  forgetFriends();
  location.reload();
}

// ---------------------------------------------------------------- your group

function matesLine(group) {
  const mates = group.players.filter((p) => p.key !== me.key).map((p) => p.name);
  return mates.length ? `With ${mates.join(', ')}` : 'It\'s just you so far';
}

// `self` is the phone's owner; friends get the same facts in the third person.
function queueStatus(state, group, { self = true } = {}) {
  if (group.status === 'playing') return `On Court ${group.court}`;
  const ahead = waiting(state).findIndex((g) => g.id === group.id);
  const missing = GROUP_SIZE - group.players.length;
  if (missing > 0) return `${missing} more needed to play`;
  if (ahead === 0) return self ? 'You\'re first in line: you\'re on when a court frees up' : 'First in line';
  const groups = `${ahead} ${ahead === 1 ? 'group' : 'groups'} ahead`;
  return self ? `${groups} of you` : groups;
}

function playingCard(group) {
  return h('div', { class: 'me playing' },
    h('div', { class: 'headline', text: `Court ${group.court}` }),
    h('div', { class: 'sub', text: `Group ${group.no} is playing · ${matesLine(group)}` }),
    h('div', { class: 'row' }, twoTapButton({
      id: `finish-${group.id}`,
      label: 'We\'re done',
      confirmLabel: 'Tap again to end the game',
      rerender,
      onConfirm: () => act({ type: 'finish', courtNo: group.court, groupId: group.id }),
    })));
}

// Tapping beats dragging on a small screen: list the groups this person could move to.
async function moveToGroup(state, player, fromGroup, { self }) {
  const options = waiting(state)
    .filter((g) => g.id !== fromGroup.id && g.players.length < GROUP_SIZE && !g.players.some((p) => p.key === player.key))
    .map((g) => ({
      value: g.id,
      label: `Group ${g.no}`,
      detail: `${GROUP_SIZE - g.players.length} open · ${g.players.map((p) => p.name).join(', ')}`,
    }));
  const choice = await pickDialog({
    title: self ? 'Switch to which group?' : `Move ${player.name} to which group?`,
    body: options.length ? null : 'Every other group is full right now.',
    options: [...options, { value: 'new', label: 'New group at the back', detail: 'Start a fresh group at the end of the line' }],
  });
  if (choice) act({ type: 'movePlayer', playerKey: player.key, fromGroupId: fromGroup.id, groupId: choice });
}

// A short group holding a free court may start it; full groups go on by
// themselves, and anyone further back just waits their turn.
function startNote(state, group) {
  const free = freeCourt(state);
  if (!free || group.players.length >= GROUP_SIZE) return { court: null, note: null };
  if (!startable(state).some((g) => g.id === group.id)) return { court: null, note: null };
  return { court: free, note: 'A court is free and it\'s your turn. Short of players? Grab someone and start.' };
}

function waitingCard(state, group, isSecond) {
  const { court, note } = startNote(state, group);
  return h('div', { class: 'me' },
    isSecond ? h('div', { class: 'small muted', text: 'Also signed up' }) : null,
    h('div', { class: 'headline num', text: `Group ${group.no}` }),
    h('div', { class: 'sub', text: queueStatus(state, group) }),
    h('div', { class: 'small muted', text: matesLine(group) }),
    note ? h('div', { class: 'notice', text: note }) : null,
    h('div', { class: 'row' },
      court ? twoTapButton({
        id: `start-${group.id}`,
        label: 'Start now',
        confirmLabel: `Tap again to start with ${group.players.length}`,
        rerender,
        onConfirm: () => act({ type: 'start', groupId: group.id }),
      }) : null,
      h('button', {
        class: 'secondary', type: 'button', onclick: () => moveToGroup(state, { key: me.key, name: 'you' }, group, { self: true }),
      }, 'Switch group'),
      h('button', {
        class: 'secondary', type: 'button', onclick: () => act({ type: 'leave', groupId: group.id }),
      }, 'Leave this group')));
}

// Right after joining is when people care about alerts, so ask in the card.
function alertLine() {
  const { status, busy } = ui.push;
  if (status === 'off') {
    return h('button', { type: 'button', class: 'alert-me', disabled: busy, onclick: turnOnAlerts },
      busy ? 'Setting up…' : '🔔 Alert me when it\'s our turn');
  }
  const warnings = {
    'needs-home-screen': 'Alerts can\'t reach a locked phone from the browser. Add this to your Home Screen (steps below), or keep this page open.',
    denied: 'Notifications are blocked for this site, so a locked phone won\'t ring. Keep this page open, or allow notifications in settings.',
    unsupported: 'This browser can\'t get alerts on a locked phone. Keep this page open and it will ring when it\'s your turn.',
  };
  return warnings[status] ? h('div', { class: 'alert-off', text: warnings[status] }) : null;
}

function renderMe(state, groups) {
  const cards = groups.map((group, i) => (group.status === 'playing'
    ? playingCard(group)
    : waitingCard(state, group, i > 0)));
  const line = cards.length && groups[0].status === 'waiting' ? alertLine() : null;
  if (line) cards[0].append(line);
  $('me').replaceChildren(...cards);
}

// ---------------------------------------------------------------- friends and the line

function renderFriends(state) {
  const rows = friends.flatMap((friend) => state.groups
    .filter((g) => isActive(g) && g.players.some((p) => p.key === friend.key))
    .map((group) => h('li', { class: 'friend-row' },
      h('div', {},
        h('div', { class: 'name', text: friend.name }),
        h('div', { class: 'small muted', text: `Group ${group.no} · ${queueStatus(state, group, { self: false })}` })),
      group.status === 'waiting'
        ? h('div', { class: 'row' },
          h('button', { class: 'ghost', type: 'button', onclick: () => moveToGroup(state, friend, group, { self: false }) }, 'Move'),
          h('button', { class: 'ghost', type: 'button', onclick: () => act({ type: 'leave', playerId: friend.id, groupId: group.id }) }, 'Take out'))
        : null)));
  $('friends').replaceChildren(...(rows.length
    ? [h('div', { class: 'panel' }, h('h2', { text: 'Friends you signed up' }), h('ul', { class: 'friend-list' }, rows))]
    : []));
}

function renderQueue(state, member, groups) {
  const keys = friendKeys();
  const canDrag = (player) => Boolean(member) && (player.key === me.key || keys.has(player.key));
  const canJoin = Boolean(member) && groups.length === 0;
  // Waiting in exactly one group: tapping an open spot elsewhere moves you there.
  const moveFrom = groups.length === 1 && groups[0].status === 'waiting' ? groups[0] : null;
  // The line is far from the top of the page, so say what went wrong right here.
  const lineError = (message) => alertDialog('Couldn\'t do that', message);
  const openSpot = (label, body) => h('button', { class: 'slot open', type: 'button', onclick: () => act(body, lineError) }, label);
  animateRedraw($('queue'), [...queueItems(state, {
    mineKey: me.key,
    friendKeys: keys,
    isMine: (group) => groups.some((g) => g.id === group.id),
    canDragPlayer: canDrag,
    openSlot: (group) => {
      if (canJoin) return openSpot('+ Join', { type: 'join', groupId: group.id });
      if (moveFrom && group.id !== moveFrom.id) {
        return openSpot('+ Move here', { type: 'movePlayer', playerKey: me.key, fromGroupId: moveFrom.id, groupId: group.id });
      }
      return null;
    },
    // ✕ on your own name leaves that group (a second tap confirms).
    playerExtra: (player, group) => (player.key === me.key && group.status === 'waiting' ? twoTapButton({
      id: `leave-${group.id}`,
      label: '✕',
      confirmLabel: 'Leave?',
      ariaLabel: `Leave Group ${group.no}`,
      className: 'ghost remove leave',
      rerender,
      onConfirm: () => act({ type: 'leave', groupId: group.id }, lineError),
    }) : null),
  })]);
  $('drag-hint').hidden = !waiting(state).some((g) => g.players.some(canDrag));

  const extra = $('queue-extra');
  extra.replaceChildren();
  if (!waiting(state).length) extra.append(h('div', { class: 'empty-state', text: 'No one in line yet.' }));
  if (canJoin) {
    extra.append(h('button', { class: 'secondary new-group', type: 'button', onclick: () => act({ type: 'join', groupId: 'new' }) }, '+ Start a new group'));
  }
}

// ---------------------------------------------------------------- alerts

async function turnOnAlerts() {
  ui.push = { ...ui.push, busy: true, error: '' };
  renderPush();
  try {
    await enablePush(ui.vapidKey, me.id);
    ui.push = { status: 'on', busy: false, error: '', note: 'Alerts are on. Try “Send a test in 10 seconds” and lock your phone.' };
  } catch (error) {
    ui.push = { status: await pushStatus(ui.vapidKey), busy: false, error: error.message, note: '' };
  }
  renderPush();
}

// Push state changed: redraw everything (the group card shows alert status too).
function renderPush() {
  if (live.state) render(live.state);
  else drawPushPanel(null);
}

function drawPushPanel(state) {
  const inLine = state ? myGroups(state).some((g) => g.status === 'waiting') : false;
  // While someone is in line, the card already asks or warns; keep the panel for steps and tests.
  const showPanel = ui.push.status && !(inLine && ['off', 'denied', 'unsupported'].includes(ui.push.status));
  const panel = showPanel && pushPanel(ui.push.status, {
    busy: ui.push.busy,
    error: ui.push.error,
    note: ui.push.note,
    onTest: async () => {
      ui.push = { ...ui.push, busy: true, error: '', note: 'Lock your phone now. The test arrives in about 10 seconds.' };
      renderPush();
      try {
        await sendTestPush();
        ui.push = { ...ui.push, busy: false, note: 'Sent. Did it show on your lock screen? If not, check this site\'s notification settings and Focus / Do Not Disturb.' };
      } catch (error) {
        ui.push = { ...ui.push, busy: false, error: error.message };
      }
      renderPush();
    },
    onEnable: turnOnAlerts,
  });
  $('push').replaceChildren(...(panel ? [panel] : []));
}

// Rings once per group this person is in. Friends get their own alerts on their own phones.
function maybeAlert(state, groups) {
  const called = groups.filter((g) => g.status === 'playing');
  const seen = (storage.get('alerted') ?? '').split(',').filter(Boolean);
  const fresh = called.find((g) => !seen.includes(g.id));
  if (!fresh) return;
  storage.set('alerted', [...seen, fresh.id].slice(-10).join(','));
  // Don't alarm someone who opens the page long after being called.
  if (Date.now() - fresh.calledAt > ALERT_WINDOW_MS) return;
  showTurnAlert(fresh);
}

// ---------------------------------------------------------------- page

// Redraws everything from the shared state; called on every change.
function render(state) {
  const member = state.session ? myMember(state) : null;
  $('no-session').hidden = Boolean(state.session);
  const homeFirst = Boolean(state.session) && !member && wantsHomeScreen() && !storage.get('skipHomeScreen');
  $('home-first').hidden = !homeFirst;
  $('checkin').hidden = !state.session || Boolean(member) || homeFirst;
  $('signed-in').hidden = !member;
  if (member) friends = pruneFriends(state, friends);
  const groups = member ? myGroups(state) : [];
  if (member) {
    $('me-name').textContent = member.name;
    renderMe(state, groups);
    renderFriends(state);
    $('join-panel').hidden = groups.length > 0;
    renderTogether(state, groups, member);
    drawPushPanel(state);
  }
  animateCourts($('courts'), [...state.courts.map((court) => courtCard(state, court, { mineKey: me.key }))]);
  renderQueue(state, member, groups);
  const history = historyItems(state, { highlightKeys: new Set([me.key, ...friendKeys()]) });
  $('history-panel').hidden = history.length === 0;
  $('history-count').textContent = String(history.length);
  animateRedraw($('history'), [...history]);
  updateLook(state, member);
  maybeAlert(state, groups);
  keepAwake(groups.length > 0 || friends.length > 0);
}

// ---------------------------------------------------------------- wiring

$('checkin').addEventListener('submit', (event) => {
  event.preventDefault();
  checkIn();
});
$('quick-join').addEventListener('click', () => act({ type: 'join', groupId: 'auto' }));
$('not-me').addEventListener('click', switchPerson);
$('home-first-steps').replaceChildren(homeScreenSteps());
$('skip-home').addEventListener('click', () => {
  storage.set('skipHomeScreen', '1');
  rerender();
});
$('report').addEventListener('click', () => {
  const state = live.state;
  const member = state ? myMember(state) : null;
  const groups = state ? myGroups(state).map((g) => `Group ${g.no} (${g.status})`).join(', ') : '';
  reportProblem({ name: member?.name ?? nameInput.value, context: `phone · ${groups || 'not in line'}` });
});

enableDrag($('queue'), {
  onPlayerDrop: ({ playerKey, fromGroupId, groupId }) => act({ type: 'movePlayer', playerKey, fromGroupId, groupId }),
});
setupInstall($('install'));

setupTogether({
  getState: () => live.state,
  myGroups,
  isBusy: () => ui.busy,
  submit: async (body) => {
    ui.busy = true;
    try {
      const { state, result } = await api.action({ playerId: me.id, ...body });
      const created = result?.created ?? [];
      if (created.length) friends = await addFriends(created);
      live.push(state);
    } finally {
      ui.busy = false;
    }
  },
  explain,
});

const updateLook = createLookPicker($('look-panel'), {
  send: (look) => api.action({ playerId: me.id, type: 'setLook', look })
    .then(({ state }) => live.push(state))
    .catch((error) => showError(error.message)),
});

const live = createLive(
  (state) => deferWhileDragging(() => { if (me.key) render(state); }),
  (status) => renderStatus($('sync'), status),
  { interval: (state) => (state && (myGroups(state).length || friends.length) ? IN_LINE_POLL_MS : WATCHING_POLL_MS) },
);
setupPullToRefresh(live.refresh);

// Start: work out who this phone is, then find out whether alerts can work here.
(async () => {
  me.key = await keyOf(me.id);
  if (live.state) render(live.state);
  await registerWorker();
  try {
    ui.vapidKey = await api.vapidKey();
    ui.push = { ...ui.push, status: await pushStatus(ui.vapidKey) };
  } catch {
    ui.push = { ...ui.push, status: null };
  }
  renderPush();
})();
