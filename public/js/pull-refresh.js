// Pull down at the top of the page to check for news, for the Home Screen app
// (a browser tab already has its own pull-to-refresh). It only re-reads the
// queue, never reloads the page, and at most once every few seconds, so a pull
// costs about one CDN request.
import { h } from './core.js';

const PULL_TRIGGER_PX = 70;
const MAX_SHIFT_PX = 56;
const MIN_GAP_MS = 3000;

const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

/** @param {() => Promise<void>} refresh  re-reads the queue */
export function setupPullToRefresh(refresh) {
  if (!standalone()) return;
  const tip = h('div', { class: 'pull-tip', 'aria-hidden': 'true' });
  document.body.append(tip);
  let startY = null;
  let pulled = 0;
  let lastAt = 0;

  const show = (text, shift) => {
    tip.textContent = text;
    tip.style.transform = `translate(-50%, ${shift}px)`;
    tip.classList.toggle('shown', Boolean(text));
  };

  addEventListener('touchstart', (event) => {
    // Not from a drag handle, a form field or a dialog, and only at the very top.
    const skip = scrollY > 0 || event.touches.length > 1
      || event.target.closest?.('.grip, dialog, input, textarea, select');
    startY = skip ? null : event.touches[0].clientY;
    pulled = 0;
  }, { passive: true });

  addEventListener('touchmove', (event) => {
    if (startY === null || document.body.classList.contains('dragging')) return;
    pulled = event.touches[0].clientY - startY;
    if (pulled <= 0) show('', 0);
    else show(pulled >= PULL_TRIGGER_PX ? '↻ Release to refresh' : '↓ Pull to refresh', Math.min(pulled / 2, MAX_SHIFT_PX));
  }, { passive: true });

  addEventListener('touchend', async () => {
    if (startY === null) return;
    startY = null;
    if (pulled < PULL_TRIGGER_PX) return show('', 0);
    show('Refreshing…', MAX_SHIFT_PX / 2);
    if (Date.now() - lastAt > MIN_GAP_MS) {
      lastAt = Date.now();
      await refresh();
    }
    show('', 0);
  }, { passive: true });
}
