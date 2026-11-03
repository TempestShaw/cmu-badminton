// Putting the courts right, from the court screen and the host page.
// "Change court": a game is really being played on another court than the app
// says (say, the court it was sent to was taken). Pick where it is; a game the
// app has there swaps over. "Mark in use": people not in the app are playing
// on a court, so the line skips it until someone frees it.
import { h } from './core.js';
import { pickDialog } from './dialogs.js';
import { twoTapButton } from './two-tap.js';

/** @param {(body: object) => Promise<unknown>} act  the page's own action sender */
export function changeCourtButton(state, court, group, act, className = '') {
  const choose = async () => {
    const options = state.courts.filter((c) => c.no !== court.no).map((c) => {
      const other = c.groupId ? state.groups.find((g) => g.id === c.groupId) : null;
      const detail = other ? `Swap with Group ${other.no}` : c.inUse ? 'In use' : 'Free';
      return { label: `Court ${c.no}`, detail, value: String(c.no) };
    });
    const to = await pickDialog({ title: `Where is Group ${group.no} playing?`, options });
    if (to) act({ type: 'moveToCourt', courtNo: court.no, groupId: group.id, toCourtNo: Number(to) });
  };
  return h('button', { type: 'button', class: `court-change ${className}`.trim(), onclick: choose }, 'Change court');
}

/** On an empty court: mark it in use, or (two taps, since the line then moves in) free it again. */
export function courtUseButton(court, act, rerender, className = '') {
  if (!court.inUse) {
    return h('button', {
      type: 'button', class: `court-use ${className}`.trim(),
      onclick: () => act({ type: 'setCourtInUse', courtNo: court.no, inUse: true }),
    }, 'Mark in use');
  }
  return twoTapButton({
    id: `free-court-${court.no}`, label: 'Free it', confirmLabel: 'Tap again: it\'s free', className: `court-use ${className}`.trim(), rerender,
    onConfirm: () => act({ type: 'setCourtInUse', courtNo: court.no, inUse: false }),
  });
}
