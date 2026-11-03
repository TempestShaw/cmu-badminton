// Drag and drop built on pointer events, so it works with fingers as well as a
// mouse (HTML5 drag events don't fire for touch on most phones). A drag only
// starts from a `.grip`, which leaves the rest of the list free to scroll.
//
// Markup it understands:
//   [data-drag="player"][data-player-key][data-group-id]  a person, moved between groups
//   [data-drag="group"][data-group-id]                    a whole group, reordered
//   [data-drop-group][data-group-id][data-open]           where a person can land
//                                                         (data-group-id="new" = new group)
import { markDropped } from './motion.js';

const START_PX = 6;
const EDGE_PX = 70;
const SCROLL_STEP = 14;

let active = null;
let deferred = null;

/** Runs fn now, or right after the current drag if one is in progress (redraws would yank the list). */
export function deferWhileDragging(fn) {
  if (active) deferred = fn;
  else fn();
}

function clearMarks(root) {
  root.querySelectorAll('.drop-target, .insert-before, .insert-after')
    .forEach((el) => el.classList.remove('drop-target', 'insert-before', 'insert-after'));
}

function playerTarget(drag, x, y) {
  const el = document.elementFromPoint(x, y)?.closest('[data-drop-group]');
  if (!el || !drag.root.contains(el)) return null;
  const groupId = el.dataset.groupId;
  const fits = groupId === 'new' || Number(el.dataset.open) > 0;
  if (groupId === drag.fromGroupId || !fits) return null;
  el.classList.add('drop-target');
  return { groupId };
}

// Groups are listed in one column, so the drop position is decided by height alone.
function groupTarget(drag, y) {
  const cards = [...drag.root.querySelectorAll('[data-drag="group"]')].filter((el) => el !== drag.item);
  if (!cards.length) return null;
  const before = cards.find((el) => {
    const rect = el.getBoundingClientRect();
    return y < rect.top + rect.height / 2;
  });
  if (before) before.classList.add('insert-before');
  else cards[cards.length - 1].classList.add('insert-after');
  return { beforeGroupId: before ? before.dataset.groupId : null };
}

function updateTarget(drag) {
  clearMarks(drag.root);
  drag.target = drag.kind === 'player' ? playerTarget(drag, drag.x, drag.y) : groupTarget(drag, drag.y);
}

function placeGhost(drag) {
  drag.ghost.style.transform = `translate(${drag.x - drag.offsetX}px, ${drag.y - drag.offsetY}px)`;
}

function start(drag) {
  const rect = drag.item.getBoundingClientRect();
  const ghost = drag.item.cloneNode(true);
  ghost.classList.add('drag-ghost');
  ghost.style.width = `${rect.width}px`;
  document.body.append(ghost);
  drag.ghost = ghost;
  drag.offsetX = drag.startX - rect.left;
  drag.offsetY = drag.startY - rect.top;
  drag.started = true;
  drag.item.classList.add('drag-source');
  drag.item.closest('[data-drop-group]')?.classList.add('drag-origin');
  document.body.classList.add('dragging', `dragging-${drag.kind}`);
  placeGhost(drag);
  navigator.vibrate?.(15);

  const scroll = () => {
    if (active !== drag) return;
    const step = drag.y < EDGE_PX ? -SCROLL_STEP : drag.y > window.innerHeight - EDGE_PX ? SCROLL_STEP : 0;
    if (step) {
      window.scrollBy(0, step);
      updateTarget(drag);
    }
    requestAnimationFrame(scroll);
  };
  requestAnimationFrame(scroll);
}

function finish(drag, drop) {
  window.removeEventListener('pointermove', drag.onMove);
  window.removeEventListener('pointerup', drag.onUp);
  window.removeEventListener('pointercancel', drag.onCancel);
  if (drag.started) {
    clearMarks(drag.root);
    drag.ghost.remove();
    drag.item.classList.remove('drag-source');
    drag.root.querySelector('.drag-origin')?.classList.remove('drag-origin');
    document.body.classList.remove('dragging', 'dragging-player', 'dragging-group');
  }
  active = null;
  if (drop && drag.started && drag.target) drop(drag);
  const pending = deferred;
  deferred = null;
  pending?.();
}

/**
 * @param {HTMLElement} root  the element holding the draggable cards
 * @param {{onPlayerDrop?: (move: {playerKey: string, fromGroupId: string, groupId: string}) => void,
 *          onGroupDrop?: (move: {groupId: string, beforeGroupId: string|null}) => void}} handlers
 */
export function enableDrag(root, { onPlayerDrop, onGroupDrop }) {
  root.addEventListener('pointerdown', (event) => {
    const grip = event.target.closest('.grip');
    const item = grip?.closest('[data-drag]');
    if (!item || !root.contains(item) || active || event.button > 0) return;
    event.preventDefault();

    const drag = {
      root,
      item,
      kind: item.dataset.drag,
      fromGroupId: item.dataset.groupId,
      startX: event.clientX,
      startY: event.clientY,
      x: event.clientX,
      y: event.clientY,
      started: false,
      target: null,
    };
    drag.onMove = (e) => {
      drag.x = e.clientX;
      drag.y = e.clientY;
      if (!drag.started) {
        if (Math.hypot(drag.x - drag.startX, drag.y - drag.startY) < START_PX) return;
        start(drag);
      }
      placeGhost(drag);
      updateTarget(drag);
    };
    drag.onUp = () => finish(drag, (d) => {
      if (d.kind === 'player') {
        markDropped('player', d.item.dataset.playerKey);
        onPlayerDrop?.({ playerKey: d.item.dataset.playerKey, fromGroupId: d.fromGroupId, groupId: d.target.groupId });
      } else {
        markDropped('group', d.item.dataset.groupId);
        onGroupDrop?.({ groupId: d.item.dataset.groupId, beforeGroupId: d.target.beforeGroupId });
      }
    });
    drag.onCancel = () => finish(drag, null);
    window.addEventListener('pointermove', drag.onMove);
    window.addEventListener('pointerup', drag.onUp);
    window.addEventListener('pointercancel', drag.onCancel);
    active = drag;
  });
}
