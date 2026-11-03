// Small helpers shared by the API routes: the JSON envelope every response
// uses ({ success, data, error }), body parsing, and turning errors into replies.
const MAX_BODY_BYTES = 8 * 1024;
// Which deployment answered; pages left open reload once a newer one is live.
const VERSION = process.env.VERCEL_DEPLOYMENT_ID ?? null;

export class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function ok(data, headers = {}) {
  return Response.json({ success: true, data, error: null, version: VERSION }, { headers: { 'Cache-Control': 'no-store', ...headers } });
}

export function fail(status, code, message, details) {
  return Response.json({ success: false, data: null, error: { code, message, ...(details ? { details } : {}) } }, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

export async function readJson(request) {
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) throw new HttpError(413, 'too_large', 'Request is too large');
  try {
    const body = JSON.parse(text);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('not an object');
    return body;
  } catch {
    throw new HttpError(400, 'bad_json', 'Invalid request format');
  }
}

/** Caller's address as Vercel reports it; used only for rate limits. */
export function clientIp(request) {
  return request.headers.get('x-forwarded-for')?.split(',')[0].trim() || request.headers.get('x-real-ip') || 'local';
}

/** Wraps a handler so every thrown error becomes a JSON envelope. */
export function handle(fn) {
  return async (request) => {
    try {
      return await fn(request);
    } catch (error) {
      if (error instanceof HttpError) return fail(error.status, error.code, error.message);
      if (error?.name === 'QueueError') return fail(409, error.code, error.message, error.details);
      console.error('request failed', { url: request.url, message: error?.message, stack: error?.stack });
      return fail(500, 'server_error', 'Something went wrong on the server. Please try again.');
    }
  };
}
