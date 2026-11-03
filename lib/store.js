// Storage: the whole queue lives in one Redis key and every write is a
// compare-and-set, so concurrent taps never overwrite each other (see actions.js).
// Push subscriptions, rate-limit counters and bug reports sit beside it.
// Without Redis settings (local development) everything stays in memory.
import { Redis } from '@upstash/redis';

// A different prefix keeps load tests on the real database away from live data.
const PREFIX = process.env.BQ_KEY_PREFIX || 'bq:';
const STATE_KEY = `${PREFIX}state`;
const SUBS_KEY = `${PREFIX}subs`;
const INBOX_KEY = `${PREFIX}inbox`;
// The day just cleared by "Start a new day" / "End today", kept briefly for undo.
const PREVIOUS_KEY = `${PREFIX}previous`;
const PREVIOUS_TTL_SECONDS = 30 * 60;
const INBOX_MAX = 200;

const parseEntry = (raw) => {
  try { return JSON.parse(raw); } catch { return null; }
};

// Writes `next` only if the stored value is still `expected` ('' = missing).
const COMPARE_AND_SET = `
local cur = redis.call('GET', KEYS[1])
if (cur == false and ARGV[1] == '') or cur == ARGV[1] then
  redis.call('SET', KEYS[1], ARGV[2])
  return 1
end
return 0`;

/**
 * @typedef {object} Store
 * @property {() => Promise<string|null>} loadRaw
 * @property {(expected: string|null, next: string) => Promise<boolean>} compareAndSet
 * @property {(ids: string[]) => Promise<Record<string, string|null>>} getSubscriptions
 * @property {(id: string, sub: string) => Promise<void>} saveSubscription
 * @property {(id: string) => Promise<void>} deleteSubscription
 * @property {(key: string, limit: number, windowSeconds: number) => Promise<boolean>} hit  true while under the limit
 * @property {(entry: object) => Promise<void>} pushInbox  bug reports for the host, newest first
 * @property {() => Promise<object[]>} listInbox
 * @property {(id: string) => Promise<void>} deleteInbox
 * @property {(raw: string) => Promise<void>} savePrevious  keeps a cleared day for 30 minutes
 * @property {() => Promise<string|null>} takePrevious  returns it once, then forgets it
 */

/**
 * With automaticDeserialization off, Upstash answers HMGET with the values in
 * the order asked rather than keyed by field; key them by id either way.
 */
export function fieldsById(ids, result) {
  if (Array.isArray(result)) return Object.fromEntries(ids.map((id, i) => [id, result[i] ?? null]));
  return result ?? {};
}

/** @returns {Store} */
function redisStore(url, token) {
  const redis = new Redis({ url, token, automaticDeserialization: false });
  return {
    loadRaw: () => redis.get(STATE_KEY),
    compareAndSet: async (expected, next) => (await redis.eval(COMPARE_AND_SET, [STATE_KEY], [expected ?? '', next])) === 1,
    getSubscriptions: async (ids) => (ids.length ? fieldsById(ids, await redis.hmget(SUBS_KEY, ...ids)) : {}),
    saveSubscription: async (id, sub) => { await redis.hset(SUBS_KEY, { [id]: sub }); },
    deleteSubscription: async (id) => { await redis.hdel(SUBS_KEY, id); },
    hit: async (key, limit, windowSeconds) => {
      const counter = `${PREFIX}rl:${key}`;
      const count = await redis.incr(counter);
      if (count === 1) await redis.expire(counter, windowSeconds);
      return count <= limit;
    },
    pushInbox: async (entry) => {
      await redis.lpush(INBOX_KEY, JSON.stringify(entry));
      await redis.ltrim(INBOX_KEY, 0, INBOX_MAX - 1);
    },
    listInbox: async () => (await redis.lrange(INBOX_KEY, 0, INBOX_MAX - 1)).map(parseEntry).filter(Boolean),
    deleteInbox: async (id) => {
      const raws = await redis.lrange(INBOX_KEY, 0, INBOX_MAX - 1);
      const raw = raws.find((r) => parseEntry(r)?.id === id);
      if (raw) await redis.lrem(INBOX_KEY, 1, raw);
    },
    savePrevious: async (raw) => { await redis.set(PREVIOUS_KEY, raw, { ex: PREVIOUS_TTL_SECONDS }); },
    takePrevious: async () => redis.getdel(PREVIOUS_KEY),
  };
}

/** In-process store for local development and tests. @returns {Store} */
export function memoryStore() {
  let raw = null;
  const subs = new Map();
  const hits = new Map();
  let inbox = [];
  let previous = null;
  return {
    loadRaw: async () => raw,
    compareAndSet: async (expected, next) => {
      if (raw !== expected) return false;
      raw = next;
      return true;
    },
    getSubscriptions: async (ids) => Object.fromEntries(ids.map((id) => [id, subs.get(id) ?? null])),
    saveSubscription: async (id, sub) => { subs.set(id, sub); },
    deleteSubscription: async (id) => { subs.delete(id); },
    hit: async (key, limit, windowSeconds) => {
      const now = Date.now();
      const current = hits.get(key);
      const entry = current && current.until > now ? current : { count: 0, until: now + windowSeconds * 1000 };
      hits.set(key, { ...entry, count: entry.count + 1 });
      return entry.count + 1 <= limit;
    },
    pushInbox: async (entry) => { inbox = [entry, ...inbox].slice(0, INBOX_MAX); },
    listInbox: async () => inbox,
    deleteInbox: async (id) => { inbox = inbox.filter((e) => e.id !== id); },
    savePrevious: async (value) => { previous = { value, until: Date.now() + PREVIOUS_TTL_SECONDS * 1000 }; },
    takePrevious: async () => {
      const kept = previous && previous.until > Date.now() ? previous.value : null;
      previous = null;
      return kept;
    },
  };
}

let cached = null;

/** Upstash when its env vars are set (Vercel marketplace names either pair), memory otherwise. */
export function getStore() {
  if (cached) return cached;
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (url && token) {
    cached = redisStore(url, token);
  } else if (process.env.VERCEL) {
    throw new Error('Redis is not configured: set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN');
  } else {
    cached = memoryStore();
  }
  return cached;
}
