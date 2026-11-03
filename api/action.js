// The one write endpoint: every tap on every page ends up here.
import { waitUntil } from '@vercel/functions';
import { getStore } from '../lib/store.js';
import { runAction } from '../lib/actions.js';
import { toPublic } from '../lib/queue.js';
import { notify } from '../lib/push.js';
import { publishState } from '../lib/realtime.js';
import { guardHostPin } from '../lib/pin-guard.js';
import {
  handle, ok, readJson, clientIp, HttpError,
} from '../lib/http.js';

// Generous enough for a whole hall behind one Wi-Fi address; stops scripts.
const ACTIONS_PER_MINUTE = 300;
// Check-ins are where someone would guess codes.
const CHECK_INS_PER_10_MIN = 150;

async function guard(store, ip, type) {
  if (!(await store.hit(`act:${ip}`, ACTIONS_PER_MINUTE, 60))) {
    throw new HttpError(429, 'slow_down', 'Too many taps from this network. Wait a minute and try again.');
  }
  if (type === 'checkIn' && !(await store.hit(`checkin:${ip}`, CHECK_INS_PER_10_MIN, 600))) {
    throw new HttpError(429, 'slow_down', 'Too many check-in attempts. Wait a few minutes and try again.');
  }
}

export const POST = handle(async (request) => {
  const store = getStore();
  const body = await readJson(request);
  const ip = clientIp(request);
  const hostPin = request.headers.get('x-host-pin');
  await guard(store, ip, body.type);
  await guardHostPin(store, ip, hostPin);
  // Ending the day asks for the password again; a wrong one counts as a miss too.
  if (body.type === 'endDay') await guardHostPin(store, ip, typeof body.confirmPin === 'string' ? body.confirmPin : '');
  const {
    state, effects, changed, result,
  } = await runAction(store, body, {
    hostPin,
    kioskToken: request.headers.get('x-kiosk-token'),
  });
  const publicState = toPublic(state);
  // Answer whoever tapped right away; alerts and the live push to every open
  // page finish in the background.
  waitUntil(notify(store, effects).catch((error) => console.error('notify failed', error?.message)));
  if (changed) waitUntil(publishState(publicState));
  return ok({ state: publicState, result });
});
