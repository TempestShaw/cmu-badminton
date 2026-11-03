// Today's session: the code people type to join, and the roster of who is
// here. Names are unique for the day, so "Amy" always means the same person,
// whether she checked in herself or a friend wrote her down. Pure functions,
// like queue.js.
import {
  QueueError, createInitialState, validateName, activeGroupsOf, isActive, joinTogether,
} from './queue.js';

// A phone can hold spots for this many friends who haven't checked in themselves.
export const MAX_FRIENDS = 3;
export const CODE_LENGTH = 4;
// No 0/O, 1/I/L: the code is read off a screen across a court.
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export const normalizeCode = (code) => (typeof code === 'string' ? code.replace(/\s+/g, '').toUpperCase() : '');
export const nameKey = (name) => name.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();

export const memberById = (state, id) => state.roster.find((m) => m.id === id) ?? null;
export const memberByName = (state, name) => state.roster.find((m) => nameKey(m.name) === nameKey(name)) ?? null;

function requireSession(state) {
  if (!state.session) throw new QueueError('no_session', 'Today\'s session hasn\'t started yet. Ask the host.');
}

export function startDay(state, { sessionId, code, now }) {
  return { ...createInitialState(state.courts.length), session: { id: sessionId, code, startedAt: now, codeVersion: 1 } };
}

/** Ends the day: courts, line and check-ins clear, and phones show that nothing is running. */
export function endDay(state) {
  return createInitialState(state.courts.length);
}

/** New code for anyone still arriving, e.g. after it was shared outside the hall. */
export function changeCode(state, { code }) {
  requireSession(state);
  // The version is public, so the court screen knows to fetch the new code.
  return { ...state, session: { ...state.session, code, codeVersion: (state.session.codeVersion ?? 1) + 1 } };
}

function renameMember(state, id, name) {
  if (memberById(state, id).name === name) return state;
  const rename = (p) => (p.id === id ? { ...p, name } : p);
  return {
    ...state,
    roster: state.roster.map(rename),
    groups: state.groups.map((g) => (isActive(g) ? { ...g, players: g.players.map(rename) } : g)),
  };
}

// This phone becomes `holder` (the same person on a new phone, or a friend who
// was written down by someone else). Its old entry goes if it isn't in line.
function claimMember(state, holder, mine) {
  if (mine && activeGroupsOf(state, mine.id).length) {
    throw new QueueError('still_in_line', `You're in line as ${mine.name}. Leave the line before switching names.`);
  }
  return {
    ...state,
    roster: state.roster
      .filter((m) => m.id !== mine?.id)
      .map((m) => (m.id === holder.id ? { ...m, claimed: true } : m)),
  };
}

/**
 * Joins today's session. A name already on the roster is refused unless the
 * person confirms it's them (`claim`), so two different Amys can't merge by accident.
 */
export function checkIn(state, { playerId, playerKey, name, code, claim = false, now }) {
  requireSession(state);
  if (normalizeCode(code) !== state.session.code) {
    throw new QueueError('bad_code', 'That isn\'t today\'s code. It\'s shown on the court screen.');
  }
  const cleanName = validateName(name);
  const mine = memberById(state, playerId);
  const holder = memberByName(state, cleanName);

  if (holder && holder.id === playerId) return renameMember(state, playerId, cleanName);
  if (holder) {
    if (!claim) {
      throw new QueueError('name_taken', holder.claimed
        ? `Someone called ${holder.name} already checked in today.`
        : `${holder.name} was already signed up by a friend.`,
      { name: holder.name, claimed: holder.claimed });
    }
    return claimMember(state, holder, mine);
  }
  if (mine) return renameMember(state, playerId, cleanName);
  const member = { id: playerId, key: playerKey, name: cleanName, claimed: true, createdBy: null, checkedInAt: now };
  return { ...state, roster: [...state.roster, member] };
}

// ---------------------------------------------------------------- host corrections

/** Host only: fixes a typo in someone's name, everywhere it appears today. */
export function renamePlayer(state, { playerKey, name }) {
  const member = state.roster.find((m) => m.key === playerKey);
  if (!member) throw new QueueError('player_not_found', 'That person isn\'t checked in');
  const cleanName = validateName(name);
  const holder = memberByName(state, cleanName);
  if (holder && holder.id !== member.id) {
    throw new QueueError('name_taken', `Someone called ${holder.name} is already checked in today.`);
  }
  if (member.name === cleanName) return state;
  const rename = (p) => (p.id === member.id ? { ...p, name: cleanName } : p);
  return {
    ...state,
    roster: state.roster.map(rename),
    groups: state.groups.map((g) => ({ ...g, players: g.players.map(rename) })),
  };
}

/** A player's own name bubble style (`null` goes back to the plain one). */
export function setLook(state, { memberId, look }) {
  const member = memberById(state, memberId);
  if (!member) throw new QueueError('player_not_found', 'That person isn\'t checked in');
  if (JSON.stringify(member.look ?? null) === JSON.stringify(look)) return state;
  const restyle = (m) => {
    if (m.id !== member.id) return m;
    const { look: _old, ...rest } = m;
    return look ? { ...rest, look } : rest;
  };
  return { ...state, roster: state.roster.map(restyle) };
}

/**
 * Host only: takes back a check-in (a duplicate, or someone using another
 * person's name). They leave every group still in line, and the name is free
 * again for the right person. A game they're playing right now is left alone.
 */
export function releaseMember(state, { playerKey }) {
  const member = state.roster.find((m) => m.key === playerKey);
  if (!member) throw new QueueError('player_not_found', 'That person isn\'t checked in');
  const groups = state.groups
    .map((g) => (g.status === 'waiting' ? { ...g, players: g.players.filter((p) => p.id !== member.id) } : g))
    .filter((g) => g.status !== 'waiting' || g.players.length > 0);
  return { ...state, roster: state.roster.filter((m) => m.id !== member.id), groups };
}

function holdsSpots(state, creatorKey, alsoIds) {
  return state.roster.filter((m) => m.createdBy === creatorKey && !m.claimed
    && (alsoIds.has(m.id) || activeGroupsOf(state, m.id).length > 0));
}

/**
 * Signs up a party by name. Names already on today's roster mean those people;
 * new names become roster entries held by whoever wrote them down (`fresh`
 * supplies their ids). `kiosk` is the court screen, which needs no check-in.
 */
export function signUpParty(state, { actorId, kiosk = false, includeMe = false, names = [], fresh = [], groupId, now }) {
  requireSession(state);
  const actor = actorId ? memberById(state, actorId) : null;
  if (!kiosk && !actor) throw new QueueError('not_checked_in', 'Check in with today\'s code first');

  let next = state;
  const party = [];
  const add = (member) => {
    if (party.some((p) => p.playerId === member.id)) throw new QueueError('invalid_party', `${member.name} is listed twice`);
    party.push({ playerId: member.id, playerKey: member.key, name: member.name });
  };
  if (includeMe && actor) add(actor);
  names.forEach((raw, i) => {
    const cleanName = validateName(raw);
    const existing = memberByName(next, cleanName);
    if (existing) {
      add(existing);
      return;
    }
    const { id, key } = fresh[i];
    const member = { id, key, name: cleanName, claimed: false, createdBy: kiosk ? 'kiosk' : actor.key, checkedInAt: now };
    next = { ...next, roster: [...next.roster, member] };
    add(member);
  });

  if (!kiosk && holdsSpots(next, actor.key, new Set(party.map((p) => p.playerId))).length > MAX_FRIENDS) {
    throw new QueueError('too_many_friends',
      `One phone can hold spots for up to ${MAX_FRIENDS} friends. Ask them to check in on their own phones.`);
  }
  return joinTogether(next, { players: party, groupId, now });
}
