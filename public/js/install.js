// Offers "Add to home screen" where the browser supports a one-tap install
// (Chrome on Android and desktop). iPhones get the Share-menu steps from the
// notification panel instead, since that's also what unlocks notifications there.
import { h, storage } from './core.js';

const DISMISSED_KEY = 'installDismissed';
const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

export function setupInstall(container) {
  let deferred = null;

  const render = () => {
    if (!deferred || isStandalone() || storage.get(DISMISSED_KEY)) {
      container.replaceChildren();
      return;
    }
    container.replaceChildren(h('section', { class: 'panel install' },
      h('img', { src: '/icons/court-192.png', alt: '', width: '48', height: '48' }),
      h('div', {},
        h('strong', { text: 'Add to your home screen' }),
        h('div', { class: 'notice', text: 'Open the queue with one tap next time, like an app.' })),
      h('div', { class: 'row' },
        h('button', {
          type: 'button',
          onclick: async () => {
            const prompt = deferred;
            deferred = null;
            render();
            await prompt.prompt();
          },
        }, 'Add'),
        h('button', {
          type: 'button',
          class: 'ghost',
          onclick: () => {
            storage.set(DISMISSED_KEY, '1');
            render();
          },
        }, 'Not now'))));
  };

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferred = event;
    render();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    render();
  });
}
