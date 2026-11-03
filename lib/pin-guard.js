// Stops anyone guessing the host PIN: 10 wrong tries from one network locks
// host sign-in there for 10 minutes after the latest miss. While locked, even
// the right PIN is turned away, or the lock would tell a guesser when they hit it.
import { isHostPin } from './auth.js';
import { HttpError } from './http.js';

const MAX_MISSES = 10;
const LOCK_SECONDS = 10 * 60;

/** Call before trusting a host PIN from `ip`; does nothing when no PIN was sent. */
export async function guardHostPin(store, ip, pin) {
  if (!pin) return;
  const key = `pin:${ip}`;
  if ((await store.strikes(key)) >= MAX_MISSES) {
    throw new HttpError(429, 'pin_locked', 'Too many wrong host PINs from this network. Wait 10 minutes and try again.');
  }
  if (!isHostPin(pin)) await store.strike(key, LOCK_SECONDS);
}
