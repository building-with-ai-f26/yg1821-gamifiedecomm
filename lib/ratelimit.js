// Fixed-window rate limiter kept in memory (fine for one server instance).
// hit("quiz:user:abc", 10, 600000) allows 10 calls per 10 minutes for that key; the 11th is refused.
const buckets = new Map();

export function hit(key, max, windowMs) {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || b.reset <= now) {
    b = { count: 0, reset: now + windowMs };
    buckets.set(key, b);
  }
  b.count++;
  return { ok: b.count <= max, retryAfterSec: Math.max(1, Math.ceil((b.reset - now) / 1000)) };
}

// Drop expired buckets every minute so memory stays small.
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) if (b.reset <= now) buckets.delete(k);
}, 60_000).unref();
