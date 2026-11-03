// GET: the public key phones need to sign up for push.
// POST: remembers which push address belongs to which player.
import { getStore } from '../lib/store.js';
import { checkPlayerId } from '../lib/validate.js';
import { vapidPublicKey, checkSubscription } from '../lib/push.js';
import { handle, ok, readJson } from '../lib/http.js';

export const GET = handle(async () => ok({ vapidPublicKey: vapidPublicKey() }));

export const POST = handle(async (request) => {
  const body = await readJson(request);
  const playerId = checkPlayerId(body.playerId);
  const subscription = checkSubscription(body.subscription);
  await getStore().saveSubscription(playerId, JSON.stringify({ subscription }));
  return ok({ subscribed: true });
});
