// "Your name bubble": pick a color and a pattern for your name in the line.
// It sits folded at the bottom of the phone page. The choice is kept on this
// phone and sent again after each new day's check-in, so it sticks.
import { h, storage } from './core.js';
import {
  COLORS, TEXTURES, COMBINATIONS, lookStyle, validLook,
} from './looks.js';

const STORAGE_KEY = 'look';
// Tapping through swatches sends one save, not one per tap.
const SAVE_DELAY_MS = 700;
const PREVIEW_COLOR = 'scarlet';

function storedLook() {
  try { return validLook(JSON.parse(storage.get(STORAGE_KEY) || 'null')); } catch { return null; }
}

const sameLook = (a, b) => JSON.stringify(validLook(a)) === JSON.stringify(validLook(b));
const pick = (list) => list[Math.floor(Math.random() * list.length)];

/**
 * @param {HTMLDetailsElement} panel  holds a [data-look-body] element
 * @param {{send: (look: object|null) => Promise<void>}} deps  saves the look on the server
 * @returns {(state: object, member: object|null) => void} call on every render
 */
export function createLookPicker(panel, { send }) {
  const body = panel.querySelector('[data-look-body]');
  let draft = storedLook();
  let name = '';
  let saveTimer = null;
  let syncedSession = null;

  function choose(look) {
    draft = look;
    storage.set(STORAGE_KEY, look ? JSON.stringify(look) : '');
    draw();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => send(draft), SAVE_DELAY_MS);
  }

  const surprise = () => choose({ color: pick(Object.keys(COLORS)), texture: pick(Object.keys(TEXTURES)) });

  function swatch([id, color]) {
    return h('button', {
      type: 'button', class: 'swatch', style: `background:${color.bg}`, title: color.label, 'aria-label': color.label,
      'aria-pressed': String(draft?.color === id),
      onclick: () => choose({ color: id, texture: draft?.texture ?? 'plain' }),
    });
  }

  function patternButton([id, texture]) {
    const color = draft?.color ?? PREVIEW_COLOR;
    return h('button', {
      type: 'button', class: 'pattern', style: lookStyle({ color, texture: id }),
      'aria-pressed': String(draft?.texture === id),
      onclick: () => choose({ color, texture: id }),
    }, texture.label);
  }

  function draw() {
    body.replaceChildren(
      h('p', { class: 'hint', text: `Pick a color and a pattern (${COMBINATIONS} combinations). Everyone sees it in the line.` }),
      h('div', { class: `slot you look-preview${draft ? ' styled' : ''}`, style: lookStyle(draft) },
        h('span', { class: 'name', text: name || 'You' })),
      h('div', { class: 'look-label', text: 'Color' }),
      h('div', { class: 'swatches' }, Object.entries(COLORS).map(swatch)),
      h('div', { class: 'look-label', text: 'Pattern' }),
      h('div', { class: 'patterns' }, Object.entries(TEXTURES).map(patternButton)),
      h('div', { class: 'row' },
        h('button', { type: 'button', class: 'secondary', onclick: surprise }, '🎲 Surprise me'),
        draft ? h('button', { type: 'button', class: 'ghost', onclick: () => choose(null) }, 'Back to plain') : null),
    );
  }

  return function update(state, member) {
    panel.hidden = !member;
    if (!member) return;
    // Once per day: send this phone's choice to today's check-in, or adopt the
    // one already there if this phone has none saved.
    const sessionId = state.session?.id ?? null;
    if (syncedSession !== sessionId) {
      syncedSession = sessionId;
      if (draft && !sameLook(member.look, draft)) send(draft);
      else if (!draft && validLook(member.look)) draft = validLook(member.look);
      draw();
    }
    if (member.name !== name) {
      name = member.name;
      draw();
    }
  };
}
