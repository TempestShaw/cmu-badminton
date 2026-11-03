// Every change to the queue goes through runAction: check who is asking, check
// the input, then apply a pure transition from queue.js / session.js to the
// stored state, retrying if someone else wrote in between.
import { randomInt, randomUUID } from 'node:crypto';
import * as queue from './queue.js';
import * as session from './session.js';
import { HttpError } from './http.js';
import {
  playerKeyOf, isHostPin, isKioskToken, kioskTokenFor,
} from './auth.js';
import {
  checkPlayerId, checkGroupId, checkOptionalGroupId, checkPlayerKey, checkNames, checkCourt, checkOptionalCourt,
} from './validate.js';

// A rush of simultaneous taps collides on the single state key; random,
// growing pauses spread the retries out so everyone gets through.
const MAX_ATTEMPTS = 20;
const BACKOFF_BASE_MS = 25;
const BACKOFF_CAP_MS = 400;
// A day nobody ended by hand ends on its own, so tomorrow nobody sees yesterday's line.
const SESSION_MAX_MS = 18 * 60 * 60 * 1000;

const randomBackoff = (attempt) => new Promise((resolve) => {
  setTimeout(resolve, Math.random() * Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** attempt));
});

function generateCode() {
  const { CODE_ALPHABET, CODE_LENGTH } = session;
  return Array.from({ length: CODE_LENGTH }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');
}

// ---------------------------------------------------------------- permission checks
// These depend on the current state, so they run inside the transitions.

function requireMember(state, playerId) {
  const member = playerId === undefined ? null : session.memberById(state, checkPlayerId(playerId));
  if (!member) throw new HttpError(403, 'not_checked_in', 'Check in with today\'s code first');
  return member;
}

// Phones may act on their own group only; the court screen and host on any.
function requireGroupMember(state, ctx, playerId, groupId) {
  if (ctx.kiosk) return;
  const member = requireMember(state, playerId);
  const group = state.groups.find((g) => g.id === groupId);
  if (!group?.players.some((p) => p.id === member.id)) {
    throw new HttpError(403, 'not_in_group', 'Only people in that group (or the court screen) can do that');
  }
}

// Phones may move themselves and friends they signed up.
function requireMovable(state, playerId, playerKey) {
  const actor = requireMember(state, playerId);
  const target = state.roster.find((m) => m.key === playerKey);
  if (!target || (target.id !== actor.id && target.createdBy !== actor.key)) {
    throw new HttpError(403, 'not_yours', 'You can only move yourself or friends you signed up');
  }
}

// ---------------------------------------------------------------- actions
/**
 * access: 'public' (finer checks inside), 'kiosk' (court screen or host), 'host'.
 * build(body, ctx) validates the input and returns the state transition;
 * result(prev, next, body) adds data the caller needs beyond the new state.
 */
const ACTIONS = {
  // --- phones
  checkIn: {
    access: 'public',
    build: (b, { now }) => {
      const playerId = checkPlayerId(b.playerId);
      if (typeof b.code !== 'string') throw new queue.QueueError('bad_code', 'That isn\'t today\'s code. It\'s shown on the court screen.');
      return (s) => session.checkIn(s, {
        playerId, playerKey: playerKeyOf(playerId), name: b.name, code: b.code, claim: b.claim === true, now,
      });
    },
    // The id this phone should use from now on (it changes when claiming a name).
    result: (prev, next, b) => ({ memberId: session.memberByName(next, b.name)?.id ?? null }),
  },
  join: {
    access: 'public',
    build: (b, { now }) => {
      const playerId = checkPlayerId(b.playerId);
      const groupId = checkGroupId(b.groupId ?? 'auto', { allowSpecial: true });
      return (s) => session.signUpParty(s, { actorId: requireMember(s, playerId).id, includeMe: true, groupId, now });
    },
  },
  // Several people at once: from a phone (maybe including its owner) or the court screen.
  joinTogether: {
    access: 'public',
    build: (b, { now, ctx, newId }) => {
      const names = checkNames(b.names);
      const groupId = checkGroupId(b.groupId ?? 'auto', { allowSpecial: true });
      // Ids for names nobody has checked in under yet.
      const fresh = names.map(() => {
        const id = newId();
        return { id, key: playerKeyOf(id) };
      });
      if (ctx.kiosk && b.playerId === undefined) {
        return (s) => session.signUpParty(s, { kiosk: true, names, fresh, groupId, now });
      }
      const playerId = checkPlayerId(b.playerId);
      return (s) => session.signUpParty(s, {
        actorId: requireMember(s, playerId).id, includeMe: b.includeMe === true, names, fresh, groupId, now,
      });
    },
    // Ids of people this request wrote down, so the phone can manage them later.
    result: (prev, next) => ({
      created: next.roster.filter((m) => !prev.roster.some((p) => p.id === m.id)).map(({ id, name }) => ({ id, name })),
    }),
  },
  // Holding someone's id (yours, or a friend's you wrote down) lets you take them out.
  leave: {
    access: 'public',
    build: (b) => {
      const playerId = checkPlayerId(b.playerId);
      const groupId = checkOptionalGroupId(b.groupId);
      return (s) => queue.leave(s, { playerId: requireMember(s, playerId).id, groupId });
    },
  },
  movePlayer: {
    access: 'public',
    build: (b, { now, ctx }) => {
      const playerKey = checkPlayerKey(b.playerKey);
      const fromGroupId = checkOptionalGroupId(b.fromGroupId);
      const toGroupId = b.groupId === 'new' ? 'new' : checkGroupId(b.groupId);
      return (s) => {
        if (!ctx.kiosk) requireMovable(s, b.playerId, playerKey);
        return queue.movePlayer(s, { playerKey, fromGroupId, toGroupId, now });
      };
    },
  },
  finish: {
    access: 'public',
    build: (b, { now, ctx }) => {
      const courtNo = checkCourt(b.courtNo);
      const groupId = checkGroupId(b.groupId);
      return (s) => {
        // Already finished by someone else: nothing to do, and nothing to check.
        if (s.courts.find((c) => c.no === courtNo)?.groupId !== groupId) return s;
        requireGroupMember(s, ctx, b.playerId, groupId);
        return queue.finishCourt(s, { courtNo, groupId, now });
      };
    },
  },
  // Starts a group on a free court even if it's short; whoever is around fills in.
  start: {
    access: 'public',
    build: (b, { now, ctx }) => {
      const groupId = checkGroupId(b.groupId);
      // Usually left out: the server hands out the next free court, so two
      // groups starting at once never pick the same one.
      const courtNo = checkOptionalCourt(b.courtNo);
      return (s) => {
        requireGroupMember(s, ctx, b.playerId, groupId);
        // Phones keep the line's order; the court screen and host handle exceptions.
        const next = queue.nextStartable(s);
        if (!ctx.kiosk && next && next.id !== groupId) {
          throw new queue.QueueError('not_first',
            `Group ${next.no} is first in line, so they start first. Ask at the court screen if they've agreed to let you go.`);
        }
        return queue.startGroup(s, { groupId, courtNo, now });
      };
    },
  },

  // --- court screen (and host)
  disband: {
    access: 'kiosk',
    build: (b, { now }) => {
      const groupId = checkGroupId(b.groupId);
      return (s) => queue.disbandGroup(s, { groupId, now });
    },
  },
  // Today's code, which only the court screen and host may see.
  sessionInfo: {
    access: 'kiosk',
    build: () => (s) => s,
    result: (prev, next) => ({ code: next.session?.code ?? null }),
  },

  // --- host
  remove: {
    access: 'host',
    build: (b) => {
      const groupId = checkGroupId(b.groupId);
      const playerKey = typeof b.playerKey === 'string' ? b.playerKey : '';
      return (s) => queue.removePlayer(s, { groupId, playerKey });
    },
  },
  move: {
    access: 'host',
    build: (b) => {
      const groupId = checkGroupId(b.groupId);
      return (s) => queue.moveGroup(s, { groupId, direction: b.direction });
    },
  },
  reorder: {
    access: 'host',
    build: (b) => {
      const groupId = checkGroupId(b.groupId);
      const beforeGroupId = b.beforeGroupId == null ? null : checkGroupId(b.beforeGroupId);
      return (s) => queue.reorderGroup(s, { groupId, beforeGroupId });
    },
  },
  startDay: {
    access: 'host',
    build: (b, { now, newId, newCode }) => {
      const sessionId = newId();
      const code = newCode();
      return (s) => session.startDay(s, { sessionId, code, now });
    },
    result: (prev, next) => ({ code: next.session.code }),
  },
  endDay: {
    access: 'host',
    build: () => (s) => (s.session ? session.endDay(s) : s),
  },
  newCode: {
    access: 'host',
    build: (b, { newCode }) => {
      const code = newCode();
      return (s) => session.changeCode(s, { code });
    },
    result: (prev, next) => ({ code: next.session.code }),
  },
  // Lets the host page (and a court screen being unlocked) check the PIN.
  verify: {
    access: 'host',
    build: () => (s) => s,
    result: (prev, next) => ({ kioskToken: kioskTokenFor(process.env.HOST_PIN), code: next.session?.code ?? null }),
  },
};

// ---------------------------------------------------------------- running an action

/** Reads the stored state; an old day past its time comes back already ended. */
export async function loadState(store, now = Date.now()) {
  const raw = await store.loadRaw();
  // States saved before sessions existed lack the newer fields.
  const state = { ...queue.createInitialState(), ...(raw ? JSON.parse(raw) : {}) };
  const expired = state.session && now - state.session.startedAt > SESSION_MAX_MS;
  return { raw, state: expired ? session.endDay(state) : state };
}

/**
 * Applies one action with optimistic concurrency: read, transform, then write
 * only if nobody else wrote in between; otherwise wait a moment and redo it on
 * the fresh state. Randomness and waiting are injectable for testing.
 * @returns {Promise<{state: object, effects: object[], result: object|null}>}
 */
export async function runAction(store, body, {
  hostPin, kioskToken, now = Date.now(), newId = randomUUID, newCode = generateCode, backoff = randomBackoff,
} = {}) {
  const spec = Object.hasOwn(ACTIONS, body.type) ? ACTIONS[body.type] : null;
  if (!spec) throw new HttpError(400, 'unknown_action', 'Unsupported action');
  const host = isHostPin(hostPin);
  const ctx = { host, kiosk: host || isKioskToken(kioskToken) };
  if (spec.access === 'host' && !ctx.host) throw new HttpError(403, 'not_host', 'Wrong host PIN');
  if (spec.access === 'kiosk' && !ctx.kiosk) {
    throw new HttpError(403, 'not_kiosk', 'This screen needs to be unlocked with the host password');
  }
  const transition = spec.build(body, { now, ctx, newId, newCode });
  const finish = (prev, next, effects) => ({ state: next, effects, result: spec.result?.(prev, next, body) ?? null });

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const { raw, state } = await loadState(store, now);
    const next = transition(state);
    if (next === state) return finish(state, state, []);
    if (await store.compareAndSet(raw, JSON.stringify(next))) {
      return finish(state, next, queue.diffEffects(state, next));
    }
    await backoff(attempt);
  }
  throw new HttpError(503, 'busy', 'Too many people tapped at once. Please try again.');
}
