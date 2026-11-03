// Bug reports: anyone can send one; only the host can list or delete them.
import { randomUUID } from 'node:crypto';
import { getStore } from '../lib/store.js';
import { isHostPin } from '../lib/auth.js';
import { guardHostPin } from '../lib/pin-guard.js';
import {
  handle, ok, readJson, clientIp, HttpError,
} from '../lib/http.js';

const MAX_MESSAGE = 1000;
const REPORTS_PER_WINDOW = 5;
const WINDOW_SECONDS = 600;

const text = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

async function requireHost(request) {
  const pin = request.headers.get('x-host-pin');
  await guardHostPin(getStore(), clientIp(request), pin);
  if (!isHostPin(pin)) throw new HttpError(403, 'not_host', 'Wrong host PIN');
}

// Anyone can report a problem; reports land in the host's inbox.
export const POST = handle(async (request) => {
  const store = getStore();
  if (!(await store.hit(`report:${clientIp(request)}`, REPORTS_PER_WINDOW, WINDOW_SECONDS))) {
    throw new HttpError(429, 'slow_down', 'Thanks! That\'s enough reports for now. Try again in a few minutes.');
  }
  const body = await readJson(request);
  const message = text(body.message, MAX_MESSAGE);
  if (!message) throw new HttpError(400, 'empty_report', 'Describe what went wrong');
  await store.pushInbox({
    id: randomUUID(),
    kind: 'bug',
    at: Date.now(),
    message,
    name: text(body.name, 40),
    page: text(body.page, 40),
    context: text(body.context, 500),
    userAgent: text(request.headers.get('user-agent'), 200),
  });
  return ok({ received: true });
});

export const GET = handle(async (request) => {
  await requireHost(request);
  return ok({ items: await getStore().listInbox() });
});

export const DELETE = handle(async (request) => {
  await requireHost(request);
  const id = new URL(request.url).searchParams.get('id');
  if (!id) throw new HttpError(400, 'missing_id', 'Which report?');
  await getStore().deleteInbox(id);
  return ok({ deleted: true });
});
