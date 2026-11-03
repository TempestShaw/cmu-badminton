// Signing up several people in one go: name parsing and the group picker that
// only offers groups with room for the whole party.
import { h, waiting, GROUP_SIZE } from './core.js';

/** Splits pasted or typed names on new lines, commas (incl. Chinese ，、) and semicolons. */
export function parseNames(text) {
  return text.split(/[\n,，、;；]+/).map((name) => name.trim().replace(/\s+/g, ' ')).filter(Boolean);
}

export function partyError(count) {
  if (count === 0) return 'Enter at least one name';
  if (count > GROUP_SIZE) return `A group holds ${GROUP_SIZE}. Sign up the rest in a second batch.`;
  return '';
}

export function groupOptions(state, size) {
  const needed = Math.max(size, 1);
  const fits = waiting(state).filter((g) => GROUP_SIZE - g.players.length >= needed);
  return [
    { value: 'auto', text: needed > 1 ? 'Auto: first group with room for everyone' : 'Auto: first group with room' },
    ...fits.map((g) => ({ value: g.id, text: `Group ${g.no} (${GROUP_SIZE - g.players.length} open)` })),
    { value: 'new', text: 'Start a new group' },
  ];
}

/** Refreshes a <select>'s options, leaving it alone while someone has it open. */
export function fillSelect(select, options) {
  if (document.activeElement === select) return;
  const previous = select.value || 'auto';
  select.replaceChildren(...options.map((o) => h('option', { value: o.value, text: o.text })));
  select.value = options.some((o) => o.value === previous) ? previous : 'auto';
}

export const peopleLabel = (count) => (count === 1 ? '1 person' : `${count} people`);

const SEPARATOR = /[\n,，、;；]/;

/**
 * One box per name. Typing a comma jumps to the next box, and pasting
 * "Amy, Ben, Cat" into one box spreads the names over the boxes.
 * @param {HTMLElement} container  holds the <input>s
 */
export function nameBoxes(container) {
  const boxes = () => [...container.querySelectorAll('input')];
  const visible = () => boxes().filter((box) => !box.hidden);
  container.addEventListener('input', (event) => {
    const box = event.target;
    if (!SEPARATOR.test(box.value)) return;
    const shown = visible();
    const start = shown.indexOf(box);
    const parts = parseNames(box.value);
    box.value = parts[0] ?? '';
    parts.slice(1).forEach((name, i) => { if (shown[start + 1 + i]) shown[start + 1 + i].value = name; });
    (shown[start + Math.max(parts.length, 1)] ?? box).focus();
  });
  return {
    names: () => visible().map((box) => box.value.trim().replace(/\s+/g, ' ')).filter(Boolean),
    clear: () => boxes().forEach((box) => { box.value = ''; }),
    /** Shows the first `count` boxes; hidden ones are emptied so they never count. */
    show: (count) => boxes().forEach((box, i) => {
      box.hidden = i >= count;
      if (box.hidden) box.value = '';
    }),
  };
}

/** Suggests today's checked-in names while typing, so friends are matched instead of retyped. */
export function fillNameSuggestions(datalist, state) {
  const names = state.roster.map((m) => m.name).sort((a, b) => a.localeCompare(b));
  const joined = names.join('\n');
  if (datalist.dataset.names === joined) return;
  datalist.dataset.names = joined;
  datalist.replaceChildren(...names.map((name) => h('option', { value: name })));
}
