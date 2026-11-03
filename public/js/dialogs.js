// Modal dialogs: questions that need an answer before going on, plain alerts,
// and the "report a problem" form every page shares.
import { api, h } from './core.js';

/**
 * @param {{title: string, body?: (string|Node)[], actions: {label: string, value: string, kind?: string}[]}} opts
 * @returns {Promise<string|null>} the chosen action's value, or null if dismissed
 */
export function openDialog({ title, body = [], actions }) {
  return new Promise((resolve) => {
    const dialog = h('dialog', { class: 'sheet' },
      h('h2', { text: title }),
      ...body.map((part) => (typeof part === 'string' ? h('p', { text: part }) : part)),
      h('div', { class: 'row actions' }, actions.map((a) => h('button', {
        type: 'button', class: a.kind ?? '', onclick: () => dialog.close(a.value),
      }, a.label))));
    dialog.addEventListener('close', () => {
      dialog.remove();
      resolve(dialog.returnValue || null);
    });
    document.body.append(dialog);
    dialog.showModal();
  });
}

/**
 * A list of big tappable choices, e.g. which group to move to.
 * @param {{title: string, body?: string, options: {label: string, detail?: string, value: string}[]}} opts
 * @returns {Promise<string|null>} the chosen value, or null if cancelled
 */
export function pickDialog({ title, body, options }) {
  return new Promise((resolve) => {
    let chosen = null;
    const dialog = h('dialog', { class: 'sheet' },
      h('h2', { text: title }),
      body ? h('p', { class: 'notice', text: body }) : null,
      h('div', { class: 'pick-list' }, options.map((o) => h('button', {
        type: 'button',
        class: 'pick',
        onclick: () => { chosen = o.value; dialog.close(); },
      }, h('span', { class: 'pick-label', text: o.label }), o.detail ? h('span', { class: 'pick-detail', text: o.detail }) : null))),
      h('div', { class: 'row actions' }, h('button', { type: 'button', class: 'secondary', onclick: () => dialog.close() }, 'Cancel')));
    dialog.addEventListener('close', () => {
      dialog.remove();
      resolve(chosen);
    });
    document.body.append(dialog);
    dialog.showModal();
  });
}

/**
 * Asks for one line of text, e.g. a corrected name, or (type 'password') the host password.
 * @returns {Promise<string|null>} the text, or null if cancelled
 */
export function promptDialog({
  title, label, note, value = '', confirmLabel = 'Save', confirmKind = '', maxlength = 20, type = 'text',
}) {
  return new Promise((resolve) => {
    let answer = null;
    const input = h('input', { type, maxlength: String(maxlength), autocomplete: 'off' });
    input.value = value;
    const form = h('form', { class: 'stack', method: 'dialog' },
      note ? h('p', { class: 'notice', text: note }) : null,
      h('label', { text: label }), input,
      h('div', { class: 'row actions' },
        h('button', { type: 'button', class: 'secondary', onclick: () => dialog.close() }, 'Cancel'),
        h('button', { type: 'submit', class: confirmKind }, confirmLabel)));
    const dialog = h('dialog', { class: 'sheet' }, h('h2', { text: title }), form);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      answer = input.value.trim() || null;
      dialog.close();
    });
    dialog.addEventListener('close', () => {
      dialog.remove();
      resolve(answer);
    });
    document.body.append(dialog);
    dialog.showModal();
    input.select();
  });
}

export const alertDialog = (title, message) => openDialog({ title, body: [message], actions: [{ label: 'OK', value: 'ok' }] });

/** Opens the problem report form. `context` is attached so the host can see what state things were in. */
export function reportProblem({ name = '', context = '' } = {}) {
  const message = h('textarea', { rows: '4', maxlength: '1000', placeholder: 'What happened, and what did you expect?' });
  const who = h('input', { maxlength: '40', autocomplete: 'nickname', placeholder: 'Optional' });
  who.value = name;
  const status = h('div', { class: 'error', role: 'alert' });
  const send = h('button', { type: 'submit' }, 'Send');
  const form = h('form', { class: 'stack', method: 'dialog' },
    h('label', { text: 'What went wrong?' }), message,
    h('label', { text: 'Your name' }), who,
    status,
    h('div', { class: 'row actions' },
      h('button', { type: 'button', class: 'secondary', onclick: () => dialog.close() }, 'Cancel'),
      send));
  const dialog = h('dialog', { class: 'sheet' }, h('h2', { text: 'Report a problem' }),
    h('p', { class: 'notice', text: 'The host sees these on the host page.' }), form);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    status.textContent = '';
    send.disabled = true;
    try {
      await api.report({ message: message.value, name: who.value, page: location.pathname, context });
      form.replaceChildren(h('p', { text: 'Thanks! The host will see it.' }),
        h('div', { class: 'row actions' }, h('button', { type: 'button', onclick: () => dialog.close() }, 'Close')));
    } catch (error) {
      status.textContent = error.message;
      send.disabled = false;
    }
  });
  dialog.addEventListener('close', () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
  message.focus();
}
