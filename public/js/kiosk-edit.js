// Court screen "Edit": tap up to four people in the line, then move them all
// together to a group with room or a new group at the back, or take them out
// of the line. The server does all of them or none (movePlayers and
// removePlayers in lib/queue.js), so two people rearranging at once never
// leave half a change. The line keeps updating while people are
// picked; anyone who moves or leaves meanwhile just drops out of the picks.
import { h, waiting, GROUP_SIZE } from './core.js';
import { openDialog, pickDialog } from './dialogs.js';

const MAX_PICKS = GROUP_SIZE;
const EDIT_HINT = 'Tap up to 4 people, then Move to… or Remove from line. Tap Done when finished.';

const samePick = (a, b) => a.playerKey === b.playerKey && a.fromGroupId === b.fromGroupId;
const listNames = (picks) => picks.map((p) => p.name).join(', ');

/**
 * @param {{els: Record<string, HTMLElement>, getState: () => object|null,
 *          send: (body: object, onError: (message: string) => void) => Promise<object|null>,
 *          refresh: () => void, rerender: () => void}} deps
 */
export function createLineEditor({ els, getState, send, refresh, rerender }) {
  const normalHint = els.hint.textContent;
  let editing = false;
  let picks = []; // { playerKey, fromGroupId, name }
  let note = '';

  const isPicked = (player, group) => picks.some((p) => samePick(p, { playerKey: player.key, fromGroupId: group.id }));

  function toggle(player, group) {
    const pick = { playerKey: player.key, fromGroupId: group.id, name: player.name };
    if (picks.some((p) => samePick(p, pick))) {
      picks = picks.filter((p) => !samePick(p, pick));
      note = '';
    } else if (picks.some((p) => p.playerKey === pick.playerKey)) {
      note = `${pick.name} is already picked from another group.`;
    } else if (picks.length >= MAX_PICKS) {
      note = `Up to ${MAX_PICKS} people at a time.`;
    } else {
      picks = [...picks, pick];
      note = '';
    }
    rerender();
  }

  // Someone else moved a picked person (or they left, or their group went on court).
  function prune(state) {
    const stillThere = (p) => waiting(state).some((g) => g.id === p.fromGroupId && g.players.some((x) => x.key === p.playerKey));
    const gone = picks.filter((p) => !stillThere(p));
    if (!gone.length) return;
    picks = picks.filter(stillThere);
    note = `${listNames(gone)} moved or left just now, so ${gone.length === 1 ? 'is' : 'are'} no longer picked.`;
  }

  // Groups with room for everyone coming in, that none of them is already in.
  function targets(state) {
    return waiting(state).filter((g) => {
      const coming = picks.filter((p) => p.fromGroupId !== g.id);
      const twice = coming.some((p) => g.players.some((x) => x.key === p.playerKey));
      return coming.length > 0 && coming.length <= GROUP_SIZE - g.players.length && !twice;
    });
  }

  async function move() {
    const state = getState();
    if (!state || !picks.length) return;
    const options = [
      ...targets(state).map((g) => ({
        label: `Group ${g.no}`,
        detail: `${GROUP_SIZE - g.players.length} open · ${g.players.map((p) => p.name).join(', ') || 'empty'}`,
        value: g.id,
      })),
      { label: 'New group at the back', detail: 'Starts a new group with them', value: 'new' },
    ];
    const groupId = await pickDialog({ title: `Move ${listNames(picks)}`, body: 'They move together.', options });
    if (!groupId) return;
    const moving = picks;
    const done = await send({
      type: 'movePlayers',
      moves: moving.map(({ playerKey, fromGroupId }) => ({ playerKey, fromGroupId })),
      groupId,
    }, (message) => { note = message; });
    if (done) {
      picks = [];
      note = `Moved ${listNames(moving)}.`;
    } else {
      refresh();
    }
    rerender();
  }

  async function remove() {
    if (!picks.length) return;
    const removing = picks;
    const choice = await openDialog({
      title: `Remove ${listNames(removing)} from the line?`,
      actions: [{ label: 'Cancel', value: '', kind: 'secondary' }, { label: 'Remove', value: 'remove', kind: 'danger' }],
    });
    if (choice !== 'remove') return;
    const done = await send({
      type: 'removePlayers',
      picks: removing.map(({ playerKey, fromGroupId }) => ({ playerKey, fromGroupId })),
    }, (message) => { note = message; });
    if (done) {
      picks = [];
      note = `Removed ${listNames(removing)} from the line.`;
    } else {
      refresh();
    }
    rerender();
  }

  function setEditing(on) {
    editing = on;
    picks = [];
    note = '';
    rerender();
  }

  function draw() {
    els.button.textContent = editing ? 'Done' : 'Edit';
    els.button.classList.toggle('confirm', editing);
    els.hint.textContent = editing ? EDIT_HINT : normalHint;
    els.bar.hidden = !editing;
    if (!editing) return;
    els.picked.replaceChildren(...(picks.length
      ? picks.map((p) => h('span', { class: 'chip', text: p.name }))
      : [h('span', { class: 'muted', text: 'Nobody picked yet' })]));
    els.move.disabled = picks.length === 0;
    els.remove.disabled = picks.length === 0;
    els.move.textContent = picks.length ? `Move ${picks.length} to…` : 'Move to…';
    els.note.textContent = note;
  }

  els.button.addEventListener('click', () => setEditing(!editing));
  els.move.addEventListener('click', move);
  els.remove.addEventListener('click', remove);
  els.clear.addEventListener('click', () => { picks = []; note = ''; rerender(); });

  return {
    get editing() { return editing; },
    isPicked,
    toggle,
    /** Call at the start of every render. */
    sync(state) {
      if (editing) prune(state);
      draw();
    },
  };
}
