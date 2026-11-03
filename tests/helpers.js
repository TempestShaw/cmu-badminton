// Test helpers: a fresh in-memory day driven through the real action runner,
// so tests exercise the same checks and rules as the live site.
import { createHash, randomUUID } from 'node:crypto';
import { memoryStore } from '../lib/store.js';
import { runAction } from '../lib/actions.js';

export const PIN = 'test-pin';
process.env.HOST_PIN = PIN;
// Tests never talk to Ably.
delete process.env.ABLY_PUBLISH_KEY;
delete process.env.ABLY_SUBSCRIBE_KEY;

export const keyOf = (id) => createHash('sha256').update(id).digest('hex').slice(0, 16);
const noWait = async () => {};

/** Court by court: the number of the group playing there, or '-'. */
export const onCourts = (state) => state.courts
  .map((c) => (c.groupId ? state.groups.find((g) => g.id === c.groupId).no : '-')).join(',');

/** The line as "no:size" pairs, in order. */
export const line = (state) => state.groups
  .filter((g) => g.status === 'waiting').map((g) => `${g.no}:${g.players.length}`).join(' ');

/** Everyone in at most one waiting/playing group, unless `twice` allows it. */
export function spotsAreUnique(state) {
  const keys = state.groups.filter((g) => g.status === 'waiting' || g.status === 'playing')
    .flatMap((g) => g.players.map((p) => p.key));
  return new Set(keys).size === keys.length;
}

/** A started day with a clock that moves a second per action. */
export async function newDay() {
  const store = memoryStore();
  let clock = 1_800_000_000_000;
  const run = (body, auth = {}) => runAction(store, body, { now: (clock += 1000), backoff: noWait, ...auth });
  const host = (body) => run(body, { hostPin: PIN });
  const { code } = (await host({ type: 'startDay' })).result;
  const ids = new Map();

  async function person(name) {
    const id = randomUUID();
    await run({ type: 'checkIn', playerId: id, name, code });
    ids.set(name, id);
    return id;
  }

  /** Checks in `names` and puts them in one new group at the back; returns its id. */
  async function group(names) {
    const members = [];
    for (const name of names) members.push(await person(name));
    const first = await run({ type: 'join', playerId: members[0], groupId: 'new' });
    const id = first.state.groups.at(-1).id;
    for (const member of members.slice(1)) await run({ type: 'join', playerId: member, groupId: id });
    return id;
  }

  /** Three full groups, so all courts are busy. Returns their ids. */
  const fillCourts = async () => [
    await group(['A1', 'A2', 'A3', 'A4']),
    await group(['B1', 'B2', 'B3', 'B4']),
    await group(['C1', 'C2', 'C3', 'C4']),
  ];

  const state = async () => (await host({ type: 'verify' })).state;
  const idOf = (name) => ids.get(name);
  return {
    store, code, run, host, person, group, fillCourts, state, idOf, keyOfName: (name) => keyOf(idOf(name)),
  };
}

/** Runs `fn` and returns the QueueError/HttpError code it throws, or null. */
export async function errorCode(fn) {
  try {
    await fn();
    return null;
  } catch (error) {
    return error.code ?? error.message;
  }
}
