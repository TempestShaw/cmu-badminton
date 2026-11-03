// Web Push: who gets told what when the queue changes, and sending it.
// Phones register in the browser (public/js/notify.js); the service worker
// (public/sw.js) shows what arrives.
import { HttpError } from './http.js';

// Browsers hand out addresses on their vendor's push service. Accepting only
// those keeps the server from being used to send requests anywhere else.
const PUSH_HOSTS = [
  'fcm\\.googleapis\\.com', // Chrome, Android
  'android\\.googleapis\\.com',
  '([a-z0-9-]+\\.)*push\\.apple\\.com', // Safari, iPhone
  '([a-z0-9-]+\\.)*push\\.services\\.mozilla\\.com', // Firefox
  '([a-z0-9-]+\\.)*notify\\.windows\\.com', // Edge
];
const PUSH_SERVICE = new RegExp(`^https://(${PUSH_HOSTS.join('|')})/`);

export function checkSubscription(sub) {
  const valid = sub && typeof sub.endpoint === 'string' && PUSH_SERVICE.test(sub.endpoint)
    && typeof sub.keys?.p256dh === 'string' && typeof sub.keys?.auth === 'string';
  if (!valid) throw new HttpError(400, 'invalid_subscription', 'Invalid notification subscription');
  return { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } };
}

let sender = null;

// web-push is the heaviest dependency, so it loads only when something is sent.
async function pushSender() {
  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = process.env;
  if (!(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY && VAPID_SUBJECT)) return null;
  if (!sender) {
    sender = (await import('web-push')).default;
    sender.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  }
  return sender;
}

export function vapidPublicKey() {
  return process.env.VAPID_PUBLIC_KEY || null;
}

/** Lets someone check their phone really receives alerts. */
export async function sendTest(subscription) {
  const webpush = await pushSender();
  if (!webpush) throw new HttpError(503, 'push_unconfigured', 'Notifications aren\'t set up on the server');
  const message = {
    title: 'Test notification',
    body: 'Alerts work on this phone. You\'ll get one like this when your group is up.',
    tag: 'test',
  };
  try {
    await webpush.sendNotification(subscription, JSON.stringify(message), { TTL: 60, urgency: 'high' });
  } catch (error) {
    if (error?.statusCode === 404 || error?.statusCode === 410) {
      throw new HttpError(410, 'subscription_gone', 'This phone\'s notification setup expired. Reload the page and turn notifications on again.');
    }
    throw error;
  }
}

/** Turns a queue effect into the notification each player in that group sees. */
export function messageFor(effect, player) {
  const { group } = effect;
  if (effect.kind === 'called') {
    const mates = group.players.filter((p) => p.id !== player.id).map((p) => p.name);
    return {
      title: `You're up! Head to Court ${group.court}`,
      body: mates.length ? `Group ${group.no} · With ${mates.join(', ')}` : `Group ${group.no}`,
      tag: `called-${group.id}`,
    };
  }
  if (effect.kind === 'courtFree') {
    return {
      title: 'A court is free: your group is up',
      body: `Group ${group.no} has ${group.players.length} so far. Grab someone to fill in and tap Start.`,
      tag: `courtfree-${group.id}`,
    };
  }
  return {
    title: 'You\'re up next',
    body: `Group ${group.no} is first in line. Warm up now: you're on as soon as a court frees up.`,
    tag: `upnext-${group.id}`,
  };
}

// Stored as {subscription}; older records are the bare subscription. Records
// marked proxy came from a helper's phone taking friends' alerts, which is no
// longer done, so they're skipped.
function parseRecord(raw) {
  try {
    const value = JSON.parse(raw);
    const subscription = value?.subscription ?? value;
    if (typeof subscription?.endpoint !== 'string' || value.proxy) return null;
    return subscription;
  } catch {
    return null;
  }
}

/** Each player with notifications on gets their own message; nobody gets friends' alerts. */
export function planDeliveries(effects, subs) {
  return effects.flatMap((effect) => effect.group.players.flatMap((player) => {
    const subscription = subs[player.id] ? parseRecord(subs[player.id]) : null;
    return subscription ? [{ effect, subscription, playerIds: [player.id], message: messageFor(effect, player) }] : [];
  }));
}

/** Sends notifications for effects; failures are logged and never block the queue. */
export async function notify(store, effects) {
  if (!effects.length) return;
  const ids = [...new Set(effects.flatMap((effect) => effect.group.players.map((p) => p.id)))];
  const plans = planDeliveries(effects, await store.getSubscriptions(ids));
  if (!plans.length) return;
  const webpush = await pushSender();
  if (!webpush) return;

  await Promise.allSettled(plans.map(async ({ effect, subscription, playerIds, message }) => {
    try {
      await webpush.sendNotification(subscription, JSON.stringify(message), { TTL: 600, urgency: 'high' });
    } catch (error) {
      if (error?.statusCode === 404 || error?.statusCode === 410) {
        await Promise.all(playerIds.map((id) => store.deleteSubscription(id)));
      } else {
        console.error('push failed', { group: effect.group.no, status: error?.statusCode, message: error?.message });
      }
    }
  }));
}
