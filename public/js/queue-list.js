// The "In line" list, shared by every page. Each page decides who may be
// dragged and adds its own controls; the markup matches what dnd.js expects.
import { h, waiting, startable, GROUP_SIZE } from './core.js';
import { lookStyle } from './looks.js';

const grip = (label) => h('span', { class: 'grip', title: label, 'aria-label': label, role: 'img' }, '⠿');

function badgeFor(group, { isMine, isUp }) {
  const missing = GROUP_SIZE - group.players.length;
  if (isMine) return h('span', { class: 'badge next', text: 'Your group' });
  if (isUp) return h('span', { class: 'badge next', text: 'Up next' });
  return h('span', { class: 'badge', text: missing > 0 ? `${missing} open` : 'Full' });
}

function playerSlot(player, group, opts, looks) {
  const draggable = opts.canDragPlayer?.(player, group) ?? false;
  const style = lookStyle(looks.get(player.key));
  const tap = opts.onPlayerTap ? () => opts.onPlayerTap(player, group) : null;
  const picked = opts.isPicked?.(player, group) ?? false;
  const classes = ['slot'];
  if (player.key === opts.mineKey) classes.push('you');
  else if (opts.friendKeys?.has(player.key)) classes.push('friend');
  if (style) classes.push('styled');
  if (tap) classes.push('pickable');
  if (picked) classes.push('picked');
  return h('div', {
    class: classes.join(' '),
    style,
    // Tappable on the court screen's Edit mode (see kiosk-edit.js).
    role: tap ? 'button' : null,
    tabindex: tap ? '0' : null,
    'aria-pressed': tap ? String(picked) : null,
    onclick: tap,
    onkeydown: tap ? (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); tap(); } } : null,
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
 *          playerExtra?: Function, openSlot?: Function, groupExtra?: Function, isMine?: Function,
 *          onPlayerTap?: Function, isPicked?: Function}} opts
 * @returns {HTMLElement[]} list items, plus a "new group" drop zone shown while dragging a person
 */
export function queueItems(state, opts = {}) {
  const queue = waiting(state);
  const [first] = queue;
  // First in line, plus any short group holding a free court of its own.
  const up = new Set([first?.id, ...startable(state).map((g) => g.id)]);
  // Each player's chosen bubble style, from today's roster.
  const looks = new Map((state.roster ?? []).map((m) => [m.key, m.look]));
  const items = queue.map((group, index) => {
    const isMine = opts.isMine?.(group) ?? false;
    const slots = Array.from({ length: GROUP_SIZE }, (_, i) => (group.players[i]
      ? playerSlot(group.players[i], group, opts, looks)
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
      badgeFor(group, { isMine, isUp: up.has(group.id) })),
    h('div', { class: 'slots' }, slots),
    opts.groupExtra?.(group, index, queue.length));
  });
  const dropNew = h('li', { class: 'dropzone', 'data-drop-group': '', 'data-group-id': 'new', 'data-open': String(GROUP_SIZE) },
    'Drop here to start a new group');
  return [...items, dropNew];
}
