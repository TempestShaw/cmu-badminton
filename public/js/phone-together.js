// The phone's "Signing up friends too?" panel. The form is static HTML so what
// someone is typing survives the list refreshing every few seconds.
import {
  partyError, groupOptions, fillSelect, peopleLabel, nameBoxes, fillNameSuggestions,
} from './together.js';

const $ = (id) => document.getElementById(id);
let ctx = null;
let boxes = null;

function partyFromForm(state) {
  const includeMe = ctx.myGroups(state).length === 0 && $('include-me').checked;
  const names = boxes.names();
  return { includeMe, names, count: names.length + (includeMe ? 1 : 0) };
}

function refreshCount(state) {
  const { count } = partyFromForm(state);
  $('together-submit').textContent = count ? `Sign up ${peopleLabel(count)}` : 'Sign up';
  fillSelect($('together-group'), groupOptions(state, count));
}

// Up to 4 per group: three friend boxes plus "me", or four when I'm not included.
function showBoxes(state) {
  const includeMe = ctx.myGroups(state).length === 0 && $('include-me').checked;
  boxes.show(includeMe ? 3 : 4);
}

export function renderTogether(state, groups, member) {
  if (!ctx || !state) return;
  $('include-me-row').hidden = groups.length > 0;
  showBoxes(state);
  fillNameSuggestions($('roster-names'), state);
  $('include-me-row').querySelector('span').textContent = `Include me (${member.name})`;
  refreshCount(state);
}

async function submit(event) {
  event.preventDefault();
  const state = ctx.getState();
  if (!state || ctx.isBusy()) return;
  const error = $('together-error');
  error.textContent = '';

  const { includeMe, names, count } = partyFromForm(state);
  const problem = partyError(count);
  if (problem) {
    error.textContent = problem;
    return;
  }
  try {
    await ctx.submit({ type: 'joinTogether', includeMe, names, groupId: $('together-group').value });
    boxes.clear();
    $('together').open = false;
  } catch (e) {
    ctx.explain(e, (message) => { error.textContent = message; });
  }
}

/**
 * @param {{getState: () => object|null, myGroups: (state: object) => object[], isBusy: () => boolean,
 *          submit: (body: object) => Promise<void>, explain: (error: Error, show: (m: string) => void) => void}} context
 */
export function setupTogether(context) {
  ctx = context;
  boxes = nameBoxes($('friend-names'));
  const refresh = () => {
    const state = ctx.getState();
    if (!state) return;
    showBoxes(state);
    refreshCount(state);
  };
  $('friend-names').addEventListener('input', refresh);
  $('include-me').addEventListener('change', refresh);
  $('together-form').addEventListener('submit', submit);
}
