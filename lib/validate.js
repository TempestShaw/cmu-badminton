// Shape checks for everything that arrives over the network. Rule checks
// (is the group full, is it your turn) live in queue.js and session.js.
import { GROUP_SIZE } from './queue.js';
import { HttpError } from './http.js';

const PLAYER_ID_PATTERN = /^[A-Za-z0-9-]{16,64}$/;
const GROUP_ID_PATTERN = /^[A-Za-z0-9-]{1,40}$/;
const PLAYER_KEY_PATTERN = /^[0-9a-f]{16}$/;
const MAX_COURT = 20;

export function checkPlayerId(value) {
  if (typeof value !== 'string' || !PLAYER_ID_PATTERN.test(value)) {
    throw new HttpError(400, 'invalid_player', 'Missing player ID');
  }
  return value;
}

/** A group id; with allowSpecial, also 'auto' (first group with room) or 'new'. */
export function checkGroupId(value, { allowSpecial = false } = {}) {
  if (allowSpecial && (value === 'auto' || value === 'new')) return value;
  if (typeof value !== 'string' || !GROUP_ID_PATTERN.test(value)) {
    throw new HttpError(400, 'invalid_group', 'Invalid group');
  }
  return value;
}

export const checkOptionalGroupId = (value) => (value === undefined ? undefined : checkGroupId(value));

export function checkPlayerKey(value) {
  if (typeof value !== 'string' || !PLAYER_KEY_PATTERN.test(value)) {
    throw new HttpError(400, 'invalid_player', 'Invalid player');
  }
  return value;
}

/** Up to a group's worth of names; each is cleaned up later by validateName. */
export function checkNames(names) {
  if (names === undefined) return [];
  if (!Array.isArray(names) || names.length > GROUP_SIZE || names.some((n) => typeof n !== 'string')) {
    throw new HttpError(400, 'invalid_party', `Sign up 1 to ${GROUP_SIZE} people at a time`);
  }
  return names;
}

/** Court screen "Edit": 1 to 4 picked people, each with the group they were picked from. */
export function checkPicks(value) {
  const ok = Array.isArray(value) && value.length >= 1 && value.length <= GROUP_SIZE
    && value.every((m) => m && typeof m === 'object' && PLAYER_KEY_PATTERN.test(m.playerKey ?? '')
      && typeof m.fromGroupId === 'string' && GROUP_ID_PATTERN.test(m.fromGroupId))
    && new Set(value.map((m) => m.playerKey)).size === value.length;
  if (!ok) throw new HttpError(400, 'invalid_picks', `Pick 1 to ${GROUP_SIZE} different people`);
  return value.map(({ playerKey, fromGroupId }) => ({ playerKey, fromGroupId }));
}

export function checkCourt(value) {
  if (!Number.isInteger(value) || value < 1 || value > MAX_COURT) {
    throw new HttpError(400, 'invalid_court', 'Invalid court');
  }
  return value;
}

export const checkOptionalCourt = (value) => (value === undefined ? undefined : checkCourt(value));
