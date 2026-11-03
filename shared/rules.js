// Rules the server enforces and the pages show, kept in one place: the API
// (lib/) and the browser bundle (public/js/) both import this file, so what a
// phone offers can't drift from what the server allows. Plain data and pure
// functions only: no Node or browser APIs.

export const GROUP_SIZE = 4;

export const isActive = (group) => group.status === 'waiting' || group.status === 'playing';
export const isFull = (group) => group.players.length >= GROUP_SIZE;
export const openSpots = (group) => GROUP_SIZE - group.players.length;
/** A court the app may send a group to: no game from the line on it, and not marked in use by others. */
export const isOpenCourt = (court) => !court.groupId && !court.inUse;

/** The line, front first. */
export function waitingGroups(state) {
  return state.groups.filter((g) => g.status === 'waiting');
}

/**
 * The groups whose turn it is to start early: the first ones in line, one per
 * free court (full groups are already on, so these are the short ones holding
 * a court). Anyone further back waits; the order holds.
 */
export function startableGroups(state) {
  const free = state.courts.filter(isOpenCourt).length;
  return waitingGroups(state).filter((g) => g.players.length > 0).slice(0, free);
}

/** Name bubble styles a player may pick; public/js/looks.js draws each one. */
export const LOOK_COLORS = ['scarlet', 'tangerine', 'lemon', 'lime', 'mint', 'teal', 'sky', 'indigo', 'grape', 'pink', 'slate', 'sand'];
export const LOOK_TEXTURES = ['plain', 'dots', 'stripes', 'checks', 'waves', 'zigzag', 'confetti', 'shuttles'];
