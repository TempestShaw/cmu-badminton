// The day's finished games, plus groups that were called off, newest first.
// No play times on purpose: just which court, when it ended and who played.
import { h } from './core.js';

const timeOf = (ms) => new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

export function finishedGames(state) {
  return state.groups
    .filter((g) => g.status === 'done' || g.status === 'removed')
    .sort((a, b) => (b.finishedAt ?? 0) - (a.finishedAt ?? 0));
}

/**
 * @param {{highlightKeys?: Set<string>, extra?: (group: object) => Node|null}} opts
 *   highlightKeys: players to highlight (this phone and its friends); extra: e.g. the host's Undo button
 */
export function historyItems(state, { highlightKeys = new Set(), extra } = {}) {
  return finishedGames(state).map((group) => {
    const removed = group.status === 'removed';
    const mine = group.players.some((p) => highlightKeys.has(p.key));
    return h('li', { class: `history-item${mine ? ' mine' : ''}${removed ? ' removed' : ''}`, 'data-group-id': group.id },
      h('div', { class: 'row spread' },
        h('span', { class: 'title num', text: `Group ${group.no}` }),
        h('span', { class: 'badge', text: removed ? 'Removed' : `Court ${group.court}` })),
      h('div', { class: 'names', text: group.players.map((p) => p.name).join(', ') || 'No one' }),
      h('div', { class: 'small muted', text: `${removed ? 'Removed' : 'Ended'} ${timeOf(group.finishedAt)}` }),
      extra?.(group));
  });
}
