// Motion that explains what changed when a list is redrawn: groups, names and
// finished games glide from where they were to where they are now (so someone
// switching groups visibly travels there), newcomers fade in, people who left
// fade out where they stood, and a court that changed fades in once. Only
// transform and opacity animate, so it stays smooth; nothing moves on first
// load, and it's all off for people who ask their device for less motion.
const GLIDE_MS = 240;
const FADE_IN_MS = 200;
const FADE_OUT_MS = 160;
const EASE = 'cubic-bezier(0.2, 0.8, 0.2, 1)';
// Something the user just dropped is already where they put it.
const DROPPED_MS = 1500;
const MIN_SHIFT_PX = 1;

const ITEMS = [
  { selector: '.qgroup[data-group-id]', key: (el) => `group:${el.dataset.groupId}` },
  { selector: '.slot[data-player-key]', key: (el) => `player:${el.dataset.playerKey}` },
  { selector: '.history-item[data-group-id]', key: (el) => `done:${el.dataset.groupId}` },
];

const dropped = new Map();

/** dnd.js calls this on drop, so the dropped person or group doesn't glide again. */
export function markDropped(kind, id) {
  dropped.set(`${kind}:${id}`, Date.now() + DROPPED_MS);
}

const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// ?fps in the address shows a frame-rate readout (fps-meter.js), loaded only then.
if (new URLSearchParams(location.search).has('fps')) {
  import('./fps-meter.js').then((m) => m.startFpsMeter()).catch(() => {});
}

// key -> {el, rect, parentKey}; anything sharing a key with another element is left out.
function measure(container) {
  const found = new Map();
  const twice = new Set();
  for (const { selector, key } of ITEMS) {
    for (const el of container.querySelectorAll(selector)) {
      const k = key(el);
      if (found.has(k)) twice.add(k);
      // A name in the line carries its group's id, so no walking up the tree.
      const parentKey = el.classList.contains('slot') && el.dataset.groupId ? `group:${el.dataset.groupId}` : null;
      found.set(k, { el, rect: el.getBoundingClientRect(), parentKey });
    }
  }
  for (const k of twice) found.delete(k);
  return found;
}

function fadeOutGhost({ el, rect }) {
  const ghost = el.cloneNode(true);
  Object.assign(ghost.style, {
    position: 'fixed', left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px`,
    margin: '0', pointerEvents: 'none', zIndex: '4', boxSizing: 'border-box',
  });
  document.body.append(ghost);
  ghost.animate([{ opacity: 1 }, { opacity: 0, transform: 'scale(0.96)' }], { duration: FADE_OUT_MS, easing: 'ease-out' })
    .finished.finally(() => ghost.remove());
}

// Pages redraw every section on any change (a check-in, someone's bubble
// colour…). When a section would come out exactly the same, keep what's on
// screen: no swap, no layout, no measuring.
function unchanged(container, nodes) {
  const shown = container.childNodes;
  return shown.length === nodes.length && nodes.every((node, i) => node.isEqualNode(shown[i]));
}

const onScreen = (rect) => rect.bottom > 0 && rect.top < innerHeight;

/**
 * Puts `nodes` in the container and animates the difference. Safe to use
 * everywhere: without a visible container or with reduced motion it just swaps.
 * @returns {boolean} whether anything changed
 */
export function animateRedraw(container, nodes) {
  if (unchanged(container, nodes)) return false;
  if (reduceMotion() || document.visibilityState !== 'visible' || !container.getClientRects().length) {
    container.replaceChildren(...nodes);
    return true;
  }
  const before = measure(container);
  container.replaceChildren(...nodes);
  if (!before.size) return true; // first draw: nothing to compare with
  const after = measure(container);
  const now = Date.now();

  // How far each element moved; a child's own move excludes its group's.
  const shift = new Map();
  for (const [k, item] of after) {
    const was = before.get(k);
    if (was) shift.set(k, { x: was.rect.left - item.rect.left, y: was.rect.top - item.rect.top });
  }
  for (const [k, { el, rect, parentKey }] of after) {
    const moved = shift.get(k);
    // Off screen before and after: nobody would see it move.
    if (!onScreen(rect) && !(before.get(k) && onScreen(before.get(k).rect))) continue;
    if (!moved) {
      if (parentKey && !before.has(parentKey)) continue; // a new group fades in as a whole
      el.animate([{ opacity: 0, transform: 'scale(0.96)' }, { opacity: 1, transform: 'none' }], { duration: FADE_IN_MS, easing: EASE });
      continue;
    }
    if ((dropped.get(k) ?? 0) > now) continue;
    const parent = parentKey ? shift.get(parentKey) : null;
    const x = moved.x - (parent?.x ?? 0);
    const y = moved.y - (parent?.y ?? 0);
    if (Math.abs(x) < MIN_SHIFT_PX && Math.abs(y) < MIN_SHIFT_PX) continue;
    el.animate([{ transform: `translate(${x}px, ${y}px)` }, { transform: 'none' }], { duration: GLIDE_MS, easing: EASE });
  }
  // Gone: fade out where they stood (a whole group fades as one, not name by name).
  for (const [k, was] of before) {
    const groupGoneToo = was.parentKey && before.has(was.parentKey) && !after.has(was.parentKey);
    if (!after.has(k) && !groupGoneToo && onScreen(was.rect)) fadeOutGhost(was);
  }
  return true;
}

/** Courts don't move; one that changed (called, freed) fades in once so the eye catches it. */
export function animateCourts(container, nodes) {
  if (unchanged(container, nodes)) return;
  const groupOf = () => new Map([...container.querySelectorAll('.court[data-court]')].map((el) => [el.dataset.court, el.dataset.groupId]));
  const before = groupOf();
  container.replaceChildren(...nodes);
  if (!before.size || reduceMotion() || document.visibilityState !== 'visible') return;
  for (const el of container.querySelectorAll('.court[data-court]')) {
    if (before.has(el.dataset.court) && before.get(el.dataset.court) !== el.dataset.groupId) {
      el.animate([{ opacity: 0.25 }, { opacity: 1 }], { duration: 320, easing: 'ease-out' });
    }
  }
}
