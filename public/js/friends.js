// People this phone signed up for someone else. Their ids live only on this
// phone, which makes it the one place that can take them out of line again.
import { storage, keyOf, isActive } from './core.js';

const STORAGE_KEY = 'friends';

const isFriend = (f) => f && typeof f.id === 'string' && typeof f.key === 'string' && typeof f.name === 'string';

function save(list) {
  storage.set(STORAGE_KEY, JSON.stringify(list));
}

/** @returns {{id: string, key: string, name: string}[]} */
export function loadFriends() {
  try {
    const list = JSON.parse(storage.get(STORAGE_KEY) ?? '[]');
    return Array.isArray(list) ? list.filter(isFriend) : [];
  } catch {
    return [];
  }
}

export async function addFriends(people) {
  const withKeys = await Promise.all(people.map(async (p) => ({ id: p.id, name: p.name, key: await keyOf(p.id) })));
  const next = [...loadFriends(), ...withKeys];
  save(next);
  return next;
}

/** Forgets friends whose game is over or who were taken out of line. */
export function pruneFriends(state, friends) {
  const activeKeys = new Set(state.groups.filter(isActive).flatMap((g) => g.players.map((p) => p.key)));
  const kept = friends.filter((f) => activeKeys.has(f.key));
  if (kept.length !== friends.length) save(kept);
  return kept;
}

/** For when someone else takes over this phone. */
export function forgetFriends() {
  save([]);
}
