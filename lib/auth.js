// Who is asking: the host (knows HOST_PIN), an unlocked court screen (holds a
// token derived from it), or a phone (holds its own secret player id).
import { createHash, timingSafeEqual } from 'node:crypto';

const sha256 = (text) => createHash('sha256').update(text).digest();

// Compares hashes in constant time, so response timing can't leak the secret.
const sameSecret = (given, expected) => typeof given === 'string' && given.length > 0
  && timingSafeEqual(sha256(given), sha256(expected));

/** Public, non-reversible handle for a player; phones compute the same value to find themselves. */
export function playerKeyOf(playerId) {
  return sha256(playerId).toString('hex').slice(0, 16);
}

export function isHostPin(given) {
  const expected = process.env.HOST_PIN;
  return Boolean(expected) && sameSecret(given, expected);
}

/** What an unlocked court screen keeps instead of the PIN; changes when the PIN does. */
export function kioskTokenFor(pin) {
  return pin ? sha256(`kiosk:${pin}`).toString('hex').slice(0, 32) : null;
}

export function isKioskToken(given) {
  const expected = kioskTokenFor(process.env.HOST_PIN);
  return Boolean(expected) && sameSecret(given, expected);
}
