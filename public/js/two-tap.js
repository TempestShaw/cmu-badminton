// Buttons for things that are hard to undo (ending a game, calling a group
// off): the first tap arms them, a second tap within a few seconds acts.
import { h } from './core.js';

const WINDOW_MS = 4000;
let armed = null;

/**
 * @param {{id: string, label: string, confirmLabel: string, onConfirm: () => void,
 *          rerender: () => void, className?: string}} opts
 */
export function twoTapButton({ id, label, confirmLabel, onConfirm, rerender, className = '' }) {
  const confirming = armed?.id === id && armed.until > Date.now();
  return h('button', {
    type: 'button',
    class: `${className}${confirming ? ' confirm' : ''}`.trim(),
    onclick: () => {
      if (!confirming) {
        armed = { id, until: Date.now() + WINDOW_MS };
        rerender();
        setTimeout(rerender, WINDOW_MS + 50);
        return;
      }
      armed = null;
      onConfirm();
    },
  }, confirming ? confirmLabel : label);
}
