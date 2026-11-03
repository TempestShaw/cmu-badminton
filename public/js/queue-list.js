// The "In line" list, shared by every page. Each page decides who may be
// dragged and adds its own controls; the markup matches what dnd.js expects.
import { h, waiting, GROUP_SIZE } from './core.js';

const grip = (label) => h('span', { class: 'grip', title: label, 'aria-label': label, role: 'img' }, '⠿');

function badgeFor(group, { isMine, isFirst }) {
  const missing = GROUP_SIZE - group.players.length;
  if (isMine) return h('span', { class: 'badge next', text: 'Your group' });
  if (isFirst) return h('span', { class: 'badge next', text: 'Up next' });
  return h('span', { class: 'badge', text: missing > 0 ? `${missing} open` : 'Full' });
}

function playerSlot(player, group, opts) {
  const draggable = opts.canDragPlayer?.(player, group) ?? false;
  const classes = ['slot'];
  if (player.key === opts.mineKey) classes.push('you');
  else if (opts.friendKeys?.has(player.key)) classes.push('friend');
  return h('div', {
    class: classes.join(' '),
    'data-drag': draggable ? 'player' : null,
    'data-player-key': player.key,
    'data-group-id': group.id,
  },
  draggable ? grip(`Drag ${player.name} to another group`) : null,
  h('span', { class: 'name', text: player.name }),
  opts.playerExtra?.(player, group));
}

/**
 * @param {object} state
 * @param {{mineKey?: string, friendKeys?: Set<string>, canDragPlayer?: Function, canDragGroups?: boolean,
 *          playerExtra?: Function, openSlot?: Function, groupExtra?: Function, isMine?: Function}} opts
 * @returns {HTMLElement[]} list items, plus a "new group" drop zone shown while dragging a person
 */
export function queueItems(state, opts = {}) {
  const queue = waiting(state);
  const [first] = queue;
  const items = queue.map((group, index) => {
    const isMine = opts.isMine?.(group) ?? false;
    const slots = Array.from({ length: GROUP_SIZE }, (_, i) => (group.players[i]
      ? playerSlot(group.players[i], group, opts)
      : opts.openSlot?.(group) ?? h('div', { class: 'slot open', text: 'Open' })));
    return h('li', {
      class: `qgroup${isMine ? ' mine' : ''}`,
      'data-drop-group': '',
      'data-group-id': group.id,
      'data-open': String(GROUP_SIZE - group.players.length),
      'data-drag': opts.canDragGroups ? 'group' : null,
    },
    h('div', { class: 'qhead' },
      opts.canDragGroups ? grip(`Drag Group ${group.no} to reorder`) : null,
      h('span', { class: 'title num', text: `Group ${group.no}` }),
      badgeFor(group, { isMine, isFirst: group === first })),
    h('div', { class: 'slots' }, slots),
    opts.groupExtra?.(group, index, queue.length));
  });
  const dropNew = h('li', { class: 'dropzone', 'data-drop-group': '', 'data-group-id': 'new', 'data-open': String(GROUP_SIZE) },
    'Drop here to start a new group');
  return [...items, dropNew];
}
