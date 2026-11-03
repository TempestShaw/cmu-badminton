import { waitUntil } from '@vercel/functions';
import { getStore } from '../lib/store.js';
import { checkSubscription, sendTest } from '../lib/push.js';
import {
  handle, ok, readJson, clientIp, HttpError,
} from '../lib/http.js';

// Per network: a whole hall can share one Wi-Fi address on the first night.
const TESTS_PER_10_MIN = 60;
// Long enough to lock the phone and see the alert arrive on the lock screen.
const MAX_DELAY_SECONDS = 15;

// "Send me a test notification", so people can check alerts work before their turn.
export const POST = handle(async (request) => {
  if (!(await getStore().hit(`pushtest:${clientIp(request)}`, TESTS_PER_10_MIN, 600))) {
    throw new HttpError(429, 'slow_down', 'That\'s plenty of tests for now. Try again in a few minutes.');
  }
  const body = await readJson(request);
  const subscription = checkSubscription(body.subscription);
  const delay = Number.isFinite(body.delaySeconds) ? Math.min(Math.max(body.delaySeconds, 0), MAX_DELAY_SECONDS) : 0;
  if (!delay) {
    await sendTest(subscription);
    return ok({ sent: true });
  }
  // Answer right away and send after the delay in the background: the phone is
  // locked by then, and a locked iPhone pauses the page's network requests.
  waitUntil((async () => {
    await new Promise((resolve) => { setTimeout(resolve, delay * 1000); });
    await sendTest(subscription);
  })().catch((error) => console.error('test push failed', error?.message)));
  return ok({ scheduled: true, delaySeconds: delay });
});
