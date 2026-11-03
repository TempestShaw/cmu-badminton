// Live push on top of polling. After every change the server sends the new
// public state to one Ably channel; pages listen through the browser's own
// EventSource with a short-lived, subscribe-only token (no Ably SDK to load).
// Polling keeps running underneath, so if Ably is down or the keys are missing
// (local development) everything still works, just a little less instantly.
const REST_URL = 'https://rest.ably.io';
const STREAM_URL = 'https://realtime.ably.io/event-stream';
const TOKEN_TTL_MS = 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 3000;
// Ably refuses messages over 64 KB; a bigger state goes out as a bare revision
// number and pages fetch the state themselves.
const MAX_PAYLOAD_BYTES = 60 * 1024;

/** One channel per data set, so test data (BQ_KEY_PREFIX) never reaches real screens. */
export function channelName() {
  return `${process.env.BQ_KEY_PREFIX || 'bq:'}state`.replace(/[^A-Za-z0-9_-]/g, '-');
}

const basicAuth = (key) => `Basic ${Buffer.from(key).toString('base64')}`;

async function ablyPost(path, key, body) {
  const response = await fetch(`${REST_URL}${path}`, {
    method: 'POST',
    headers: { Authorization: basicAuth(key), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const json = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`Ably ${response.status}: ${json?.error?.message ?? 'no details'}`);
  return json;
}

/** Sends the new public state to every listening page. Never throws: polling covers a miss. */
export async function publishState(publicState) {
  const key = process.env.ABLY_PUBLISH_KEY;
  if (!key) return;
  const full = JSON.stringify(publicState);
  const data = Buffer.byteLength(full) <= MAX_PAYLOAD_BYTES ? full : String(publicState.rev);
  try {
    await ablyPost(`/channels/${encodeURIComponent(channelName())}/messages`, key, { name: 'state', data });
  } catch (error) {
    console.error('realtime publish failed', error?.message);
  }
}

/**
 * Where a page should listen, or null when live push isn't set up. The token
 * can only subscribe, only to this one channel, and expires within the hour.
 * @returns {Promise<{url: string, expires: number}|null>}
 */
export async function listenerFor() {
  const key = process.env.ABLY_SUBSCRIBE_KEY;
  if (!key) return null;
  const keyName = key.split(':')[0];
  const channel = channelName();
  const token = await ablyPost(`/keys/${encodeURIComponent(keyName)}/requestToken`, key, {
    keyName,
    timestamp: Date.now(),
    ttl: TOKEN_TTL_MS,
    capability: JSON.stringify({ [channel]: ['subscribe'] }),
  });
  const params = new URLSearchParams({ channels: channel, v: '1.2', enveloped: 'false', accessToken: token.token });
  return { url: `${STREAM_URL}?${params}`, expires: token.expires };
}
