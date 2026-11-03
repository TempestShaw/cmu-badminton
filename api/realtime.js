// Hands a page a short-lived, listen-only address for live updates (see lib/realtime.js).
import { getStore } from '../lib/store.js';
import { listenerFor } from '../lib/realtime.js';
import {
  handle, ok, clientIp, HttpError,
} from '../lib/http.js';

// Each open page asks about once an hour, plus a few times after network drops.
const TOKENS_PER_10_MIN = 200;

export const GET = handle(async (request) => {
  if (!(await getStore().hit(`rt:${clientIp(request)}`, TOKENS_PER_10_MIN, 600))) {
    throw new HttpError(429, 'slow_down', 'Too many live-update requests. Updates will keep coming every few seconds.');
  }
  const listener = await listenerFor();
  return ok(listener ? { enabled: true, ...listener } : { enabled: false });
});
