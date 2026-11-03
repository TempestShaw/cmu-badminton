import { getStore } from '../lib/store.js';
import { loadState } from '../lib/actions.js';
import { toPublic } from '../lib/queue.js';
import { handle, ok } from '../lib/http.js';

// Every phone polls this. The CDN serves one cached copy for a second, so
// Redis sees about one read a second however many people are watching, and a
// change reaches the court screen within a few seconds. Writes return fresh
// state directly to whoever made them.
export const GET = handle(async () => {
  const started = performance.now();
  const { state } = await loadState(getStore());
  return ok(toPublic(state), {
    'Cache-Control': 'public, max-age=0, s-maxage=1, stale-while-revalidate=1',
    'Server-Timing': `redis;dur=${(performance.now() - started).toFixed(1)}`,
  });
});
