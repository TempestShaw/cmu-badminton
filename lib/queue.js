// Queue rules: who is in which group, which group plays on which court.
// Every function is pure: it takes a state and returns a new one (or the same
// object when nothing changed), never touching storage, the network or the clock.

/**
 * @typedef {{ id: string, key: string, name: string, joinedAt: number }} Player
 *   `id` is the secret a phone holds; `key` is its public hash, safe to show.
 * @typedef {{ id: string, no: number, players: Player[], court: number|null,
 *   status: 'waiting'|'playing'|'done'|'removed', calledAt: number|null, finishedAt: number|null }} Group
 *   Groups are kept in line order; done and removed ones stay for the day's history.
 * @typedef {{ no: number, groupId: string|null, startedAt: number|null }} Court
 * @typedef {{ courts: Court[], groups: Group[], nextGroupNo: number,
 *   session: object|null, roster: object[] }} State  (session and roster: see session.js)
 */

import {
  GROUP_SIZE, isActive, isFull, openSpots, waitingGroups, startableGroups,
} from '../shared/rules.js';

// Shared with the browser (shared/rules.js); re-exported for the server's modules.
export {
  GROUP_SIZE, isActive, waitingGroups, startableGroups,
};

export const COURT_COUNT = 3;
export const MAX_NAME_LENGTH = 20;
// The rule people are told is one spot each. A second is quietly allowed for
// edge cases (a friend writes you into the next game while you're still
// playing); the host page flags anyone holding two. A third is refused.
export const MAX_SIGNUPS = 2;

/** A rule was broken; `code` is for the app, `message` is shown to people. */
export class QueueError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = 'QueueError';
    this.code = code;
    if (details) this.details = details;
  }
}

/** @returns {State} */
export function createInitialState(courtCount = COURT_COUNT) {
  return {
    courts: Array.from({ length: courtCount }, (_, i) => ({ no: i + 1, groupId: null, startedAt: null })),
    groups: [],
    nextGroupNo: 1,
    session: null,
    roster: [],
  };
}

// ---------------------------------------------------------------- helpers

export function activeGroupsOf(state, playerId) {
  return state.groups.filter((g) => isActive(g) && g.players.some((p) => p.id === playerId));
}

function replaceGroup(state, groupId, update) {
  return { ...state, groups: state.groups.map((g) => (g.id === groupId ? update(g) : g)) };
}

/** Trims and collapses spaces; refuses empty or overly long names. */
export function validateName(raw) {
  const name = typeof raw === 'string' ? raw.trim().replace(/\s+/g, ' ') : '';
  if (!name) throw new QueueError('invalid_name', 'Please enter your name');
  if ([...name].length > MAX_NAME_LENGTH) {
    throw new QueueError('invalid_name', `Names can be at most ${MAX_NAME_LENGTH} characters`);
  }
  return name;
}

function newGroup(state, now) {
  const group = {
    id: `g${state.nextGroupNo}-${now}`,
    no: state.nextGroupNo,
    players: [],
    status: 'waiting',
    court: null,
    calledAt: null,
    finishedAt: null,
  };
  return { state: { ...state, groups: [...state.groups, group], nextGroupNo: state.nextGroupNo + 1 }, group };
}

// A waiting group that just lost its last player leaves the line.
function dropEmptyWaiting(state, groupId) {
  const group = state.groups.find((g) => g.id === groupId);
  if (group && group.status === 'waiting' && group.players.length === 0) {
    return { ...state, groups: state.groups.filter((g) => g.id !== groupId) };
  }
  return state;
}

// groupId is 'new', 'auto' (first group with room) or a group's id. The party
// always stays together, so the group needs room for all of them, and nobody
// may end up in the same group twice.
function pickTargetGroup(state, groupId, now, party) {
  const fits = (g) => openSpots(g) >= party.length && !g.players.some((p) => party.some((x) => x.id === p.id));
  if (groupId === 'new') return newGroup(state, now);
  if (groupId === 'auto') {
    const open = waitingGroups(state).find(fits);
    return open ? { state, group: open } : newGroup(state, now);
  }
  const group = state.groups.find((g) => g.id === groupId);
  if (!group || group.status !== 'waiting') {
    throw new QueueError('group_unavailable', 'That group is already playing or no longer exists');
  }
  const twice = party.find((x) => group.players.some((p) => p.id === x.id));
  if (twice) throw new QueueError('already_in_group', `${twice.name} is already in Group ${group.no}`);
  if (openSpots(group) < party.length) {
    throw new QueueError('group_full', party.length === 1
      ? `That group already has ${GROUP_SIZE} players`
      : `Group ${group.no} only has room for ${openSpots(group)} more`);
  }
  return { state, group };
}

// ---------------------------------------------------------------- courts

function assignToCourt(state, groupId, courtNo, now) {
  const withGroup = replaceGroup(state, groupId, (g) => ({ ...g, status: 'playing', court: courtNo, calledAt: now }));
  return {
    ...withGroup,
    courts: withGroup.courts.map((c) => (c.no === courtNo ? { ...c, groupId, startedAt: now } : c)),
  };
}

// Puts free courts to use in line order. A short group keeps one free court
// for itself (they start it when ready, grabbing whoever is around); full
// groups behind it take the other free courts, never the one it's holding.
export function autoFill(state, now) {
  let next = state;
  let held = 0;
  for (const group of waitingGroups(state)) {
    const free = next.courts.filter((c) => !c.groupId);
    if (free.length <= held) break;
    if (isFull(group)) next = assignToCourt(next, group.id, free[0].no, now);
    else if (group.players.length > 0) held += 1;
  }
  return next;
}


// Puts a group on court even when it's short. Without a courtNo it takes the
// lowest-numbered free court, so two groups starting at once never collide.
// Full groups behind it then take any other free courts.
export function startGroup(state, { groupId, courtNo, now }) {
  const group = state.groups.find((g) => g.id === groupId);
  if (!group || group.status !== 'waiting') throw new QueueError('group_unavailable', 'That group isn\'t in line');
  if (group.players.length === 0) throw new QueueError('group_empty', 'That group has no players');
  if (courtNo === undefined) {
    const free = state.courts.find((c) => !c.groupId);
    if (!free) throw new QueueError('no_free_court', 'All courts are in use right now');
    return autoFill(assignToCourt(state, groupId, free.no, now), now);
  }
  const court = state.courts.find((c) => c.no === courtNo);
  if (!court) throw new QueueError('invalid_court', 'No such court');
  if (court.groupId) throw new QueueError('court_busy', `Court ${courtNo} is still in use`);
  return autoFill(assignToCourt(state, groupId, courtNo, now), now);
}

// groupId is the group the person saw on that court. If someone else already
// pressed the button, the court has moved on and this becomes a no-op instead
// of ending the next group's game.
export function finishCourt(state, { courtNo, groupId, now }) {
  const court = state.courts.find((c) => c.no === courtNo);
  if (!court) throw new QueueError('invalid_court', 'No such court');
  if (!court.groupId || court.groupId !== groupId) return state;

  const finished = replaceGroup(state, groupId, (g) => ({ ...g, status: 'done', finishedAt: now }));
  const freed = {
    ...finished,
    courts: finished.courts.map((c) => (c.no === courtNo ? { ...c, groupId: null, startedAt: null } : c)),
  };
  return autoFill(freed, now);
}

// ---------------------------------------------------------------- joining and leaving

/** Signs up 1–4 people into one group, e.g. someone adding their friends. */
export function joinTogether(state, { players, groupId = 'auto', now }) {
  if (!Array.isArray(players) || players.length === 0 || players.length > GROUP_SIZE) {
    throw new QueueError('invalid_party', `Sign up 1 to ${GROUP_SIZE} people at a time`);
  }
  if (new Set(players.map((p) => p.playerId)).size !== players.length) {
    throw new QueueError('invalid_party', 'The same person is listed twice');
  }
  const joining = players.map(({ playerId, playerKey, name }) => {
    const cleanName = validateName(name);
    if (!playerId || !playerKey) throw new QueueError('invalid_player', 'Missing player ID');
    return { id: playerId, key: playerKey, name: cleanName, joinedAt: now };
  });
  const { state: withTarget, group } = pickTargetGroup(state, groupId, now, joining);
  for (const player of joining) {
    const current = activeGroupsOf(state, player.id);
    if (current.length >= MAX_SIGNUPS) {
      const where = current.map((g) => `Group ${g.no}`).join(' and ');
      throw new QueueError('signup_limit',
        `${player.name} is already signed up (${where}). Sign up again after that game.`);
    }
  }
  const joined = replaceGroup(withTarget, group.id, (g) => ({ ...g, players: [...g.players, ...joining] }));
  return autoFill(joined, now);
}

export function join(state, { playerId, playerKey, name, groupId = 'auto', now }) {
  return joinTogether(state, { players: [{ playerId, playerKey, name }], groupId, now });
}

// Without a groupId, takes the person out of their first waiting spot.
export function leave(state, { playerId, groupId, now }) {
  const groups = activeGroupsOf(state, playerId);
  const group = groupId
    ? groups.find((g) => g.id === groupId)
    : groups.find((g) => g.status === 'waiting') ?? groups[0];
  if (!group) throw new QueueError('not_joined', 'You\'re not in the queue');
  if (group.status !== 'waiting') {
    throw new QueueError('already_playing', 'You\'re already on court. Tap “Done playing” when you finish.');
  }
  const without = replaceGroup(state, group.id, (g) => ({ ...g, players: g.players.filter((p) => p.id !== playerId) }));
  return autoFill(dropEmptyWaiting(without, group.id), now);
}

// ---------------------------------------------------------------- rearranging the line

/** Moves one waiting player to another waiting group, or to a new group at the back. */
export function movePlayer(state, { playerKey, fromGroupId, toGroupId, now }) {
  const holds = (g) => g.players.some((p) => p.key === playerKey);
  const anywhere = state.groups.find((g) => g.status === 'waiting' && holds(g))
    ?? state.groups.find((g) => isActive(g) && holds(g));
  const from = fromGroupId ? state.groups.find((g) => g.id === fromGroupId && holds(g)) : anywhere;
  if (!from && anywhere) {
    // Someone else moved them a moment ago (two screens dragging at once): don't move them again.
    const name = anywhere.players.find((p) => p.key === playerKey).name;
    throw new QueueError('moved_already', `${name} was just moved by someone else. The line has been updated.`);
  }
  if (!from) throw new QueueError('player_not_found', 'That player isn\'t in line anymore');
  if (from.status !== 'waiting') throw new QueueError('already_playing', 'That player is already on court');
  if (from.id === toGroupId) return state;

  const player = from.players.find((p) => p.key === playerKey);
  const without = replaceGroup(state, from.id, (g) => ({ ...g, players: g.players.filter((p) => p.key !== playerKey) }));
  const { state: withTarget, group } = pickTargetGroup(without, toGroupId, now, [player]);
  const moved = replaceGroup(withTarget, group.id, (g) => ({ ...g, players: [...g.players, player] }));
  return autoFill(dropEmptyWaiting(moved, from.id), now);
}

// Court screen "Edit" picks: people picked from waiting groups, each with the
// group they were picked from. If anyone has moved since (someone else was
// rearranging too), the whole change is refused and the error names them, so
// the screen can refresh and try again: never half a change.
function findPicks(state, picks, verb) {
  const found = picks.map(({ playerKey, fromGroupId }) => {
    const from = state.groups.find((g) => g.id === fromGroupId && g.status === 'waiting');
    return { playerKey, from, player: from?.players.find((p) => p.key === playerKey) };
  });
  const gone = found.filter((m) => !m.player);
  if (gone.length) {
    const names = gone.map((m) => (state.roster ?? []).find((r) => r.key === m.playerKey)?.name ?? 'Someone');
    throw new QueueError('moved_already',
      `${names.join(', ')} moved or left a moment ago, so nobody was ${verb}. The line has been updated.`,
      { playerKeys: gone.map((m) => m.playerKey) });
  }
  return found;
}

// Takes the picked people out of their groups; groups left empty leave the line.
function withoutPicks(state, found) {
  const taken = found.reduce((s, m) => replaceGroup(s, m.from.id,
    (g) => ({ ...g, players: g.players.filter((p) => p.key !== m.playerKey) })), state);
  return { taken, tidy: (s) => [...new Set(found.map((m) => m.from.id))].reduce(dropEmptyWaiting, s) };
}

/** Court screen "Edit": moves up to four picked people into one group with room, or a new one, all at once. */
export function movePlayers(state, { moves, toGroupId, now }) {
  // People already in the target group just stay put.
  const movers = findPicks(state, moves, 'moved').filter((m) => m.from.id !== toGroupId);
  if (movers.length === 0) return state;
  const party = movers.map((m) => m.player);
  const { taken, tidy } = withoutPicks(state, movers);
  const { state: withTarget, group } = pickTargetGroup(taken, toGroupId, now, party);
  const moved = replaceGroup(withTarget, group.id, (g) => ({ ...g, players: [...g.players, ...party] }));
  return autoFill(tidy(moved), now);
}

/**
 * Court screen "Edit": takes up to four picked people out of the line, all at
 * once. They stay checked in and can sign up again.
 */
export function removePlayers(state, { picks, now }) {
  const { taken, tidy } = withoutPicks(state, findPicks(state, picks, 'removed'));
  return autoFill(tidy(taken), now);
}

/** Calls off a waiting group, e.g. they already played with people who dropped in. Kept for the history. */
export function disbandGroup(state, { groupId, now }) {
  const group = state.groups.find((g) => g.id === groupId);
  if (!group || group.status !== 'waiting') throw new QueueError('group_unavailable', 'Only groups still in line can be removed');
  return autoFill(replaceGroup(state, groupId, (g) => ({ ...g, status: 'removed', finishedAt: now })), now);
}

/** Host only: takes one person out of a waiting group. */
export function removePlayer(state, { groupId, playerKey, now }) {
  const group = state.groups.find((g) => g.id === groupId);
  if (!group || group.status !== 'waiting') {
    throw new QueueError('group_unavailable', 'Players can only be removed from groups still in line');
  }
  if (!group.players.some((p) => p.key === playerKey)) {
    throw new QueueError('player_not_found', 'That player isn\'t in this group');
  }
  const without = replaceGroup(state, groupId, (g) => ({ ...g, players: g.players.filter((p) => p.key !== playerKey) }));
  return autoFill(dropEmptyWaiting(without, groupId), now);
}

/** Host only: swaps a waiting group with its neighbour (the ↑ / ↓ buttons). */
export function moveGroup(state, { groupId, direction, now }) {
  if (direction !== -1 && direction !== 1) throw new QueueError('invalid_direction', 'Direction must be up or down');
  const waiting = waitingGroups(state);
  const index = waiting.findIndex((g) => g.id === groupId);
  if (index === -1) throw new QueueError('group_unavailable', 'Only groups still in line can be moved');
  const swapWith = waiting[index + direction];
  if (!swapWith) return state;

  const a = state.groups.findIndex((g) => g.id === groupId);
  const b = state.groups.findIndex((g) => g.id === swapWith.id);
  const groups = state.groups.map((g, i) => (i === a ? state.groups[b] : i === b ? state.groups[a] : g));
  return autoFill({ ...state, groups }, now);
}

/** Host only: puts a waiting group right before another one, or last when beforeGroupId is null (dragging). */
export function reorderGroup(state, { groupId, beforeGroupId, now }) {
  const group = state.groups.find((g) => g.id === groupId);
  if (!group || group.status !== 'waiting') throw new QueueError('group_unavailable', 'Only groups still in line can be moved');
  if (beforeGroupId === groupId) return state;

  const rest = state.groups.filter((g) => g.id !== groupId);
  const index = beforeGroupId === null
    ? rest.length
    : rest.findIndex((g) => g.id === beforeGroupId && g.status === 'waiting');
  if (index === -1) throw new QueueError('group_unavailable', 'Only groups still in line can be moved');
  const groups = [...rest.slice(0, index), group, ...rest.slice(index)];
  return groups.every((g, i) => g === state.groups[i]) ? state : autoFill({ ...state, groups }, now);
}

// ---------------------------------------------------------------- host corrections

// Puts a group back at the front of the line (ahead of every waiting group).
function toFrontOfLine(state, group) {
  const rest = state.groups.filter((g) => g.id !== group.id);
  const firstWaiting = rest.findIndex((g) => g.status === 'waiting');
  const index = firstWaiting === -1 ? rest.length : firstWaiting;
  return { ...state, groups: [...rest.slice(0, index), group, ...rest.slice(index)] };
}

/**
 * Host only: undoes "End game" or "Remove group" pressed by mistake. An ended
 * game goes back on its court if that court is still free; otherwise (and for
 * removed groups) the group goes back to the front of the line.
 */
export function reopenGroup(state, { groupId, now }) {
  const group = state.groups.find((g) => g.id === groupId);
  if (!group || (group.status !== 'done' && group.status !== 'removed')) {
    throw new QueueError('group_unavailable', 'Only finished or removed groups can be brought back');
  }
  const court = group.status === 'done' ? state.courts.find((c) => c.no === group.court) : null;
  if (court && !court.groupId) {
    // Same court, same start time: the game simply never ended.
    const back = replaceGroup(state, groupId, (g) => ({ ...g, status: 'playing', finishedAt: null }));
    return { ...back, courts: back.courts.map((c) => (c.no === court.no ? { ...c, groupId, startedAt: group.calledAt ?? now } : c)) };
  }
  return toFrontOfLine(state, { ...group, status: 'waiting', court: null, calledAt: null, finishedAt: null });
}

/** Host only: a group was started by mistake; free its court and put it back at the front of the line. */
export function returnToLine(state, { groupId }) {
  const group = state.groups.find((g) => g.id === groupId);
  if (!group || group.status !== 'playing') throw new QueueError('group_unavailable', 'That group isn\'t on a court');
  const freed = { ...state, courts: state.courts.map((c) => (c.groupId === groupId ? { ...c, groupId: null, startedAt: null } : c)) };
  return toFrontOfLine(freed, { ...group, status: 'waiting', court: null, calledAt: null });
}

// ---------------------------------------------------------------- notifications and public view

// Who needs a notification after a change: groups that just got a court;
// short groups that just got a court held for them (they start it
// themselves); and the group that just became first in line.
export function diffEffects(prev, next) {
  const prevStatus = new Map(prev.groups.map((g) => [g.id, g.status]));
  const called = next.groups
    .filter((g) => g.status === 'playing' && prevStatus.get(g.id) !== 'playing' && prevStatus.get(g.id) !== 'done')
    .map((g) => ({ kind: 'called', group: g }));

  const heldBefore = new Set(startableGroups(prev).filter((g) => !isFull(g)).map((g) => g.id));
  const held = startableGroups(next).filter((g) => !isFull(g));
  const courtFree = held.filter((g) => !heldBefore.has(g.id)).map((g) => ({ kind: 'courtFree', group: g }));

  const [prevFirst] = waitingGroups(prev);
  const [nextFirst] = waitingGroups(next);
  const newFirst = nextFirst && nextFirst.id !== prevFirst?.id && !held.some((g) => g.id === nextFirst.id);
  return [...called, ...courtFree, ...(newFirst ? [{ kind: 'upNext', group: nextFirst }] : [])];
}

// What everyone may see: player ids stay on the server (the derived key lets
// each phone recognise itself) and today's code stays off public screens.
export function toPublic(state) {
  return {
    rev: state.rev ?? 0,
    courts: state.courts,
    groups: state.groups.map((g) => ({ ...g, players: g.players.map(({ key, name }) => ({ key, name })) })),
    session: state.session
      ? { id: state.session.id, startedAt: state.session.startedAt, codeVersion: state.session.codeVersion ?? 1 }
      : null,
    roster: (state.roster ?? []).map(({ key, name, look }) => ({ key, name, look })),
  };
}
