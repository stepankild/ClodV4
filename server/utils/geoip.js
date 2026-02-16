/**
 * Lightweight GeoIP lookup using ip-api.com (free, no key, 45 req/min).
 * In-memory cache to avoid repeat lookups.
 */

const cache = new Map();           // ip → { country, countryCode }
const CACHE_TTL = 24 * 60 * 60_000; // 24 hours

// Private / local IPs — skip lookup
const PRIVATE_RE = /^(127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|::1|fc|fd|fe80)/;

/**
 * Resolve IP → { country, countryCode } or null.
 * Non-blocking, never throws.
 */
export async function geoipLookup(ip) {
  if (!ip || PRIVATE_RE.test(ip)) return null;

  // Strip IPv6-mapped prefix
  const cleanIp = ip.replace(/^::ffff:/, '');

  const cached = cache.get(cleanIp);
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    return cached.data;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    const res = await fetch(`http://ip-api.com/json/${cleanIp}?fields=status,country,countryCode`, {
      signal: controller.signal
    });
    clearTimeout(timeout);

    if (!res.ok) return null;
    const json = await res.json();

    if (json.status !== 'success') {
      cache.set(cleanIp, { data: null, ts: Date.now() });
      return null;
    }

    const data = { country: json.country, countryCode: json.countryCode };
    cache.set(cleanIp, { data, ts: Date.now() });
    return data;
  } catch {
    return null;
  }
}

/**
 * Batch-resolve an array of IPs. Returns Map<ip, { country, countryCode }>.
 */
export async function geoipBatch(ips) {
  const unique = [...new Set(ips.filter(Boolean))];
  const results = new Map();

  // Resolve all in parallel (with concurrency inherently limited by the event loop)
  await Promise.allSettled(
    unique.map(async (ip) => {
      const geo = await geoipLookup(ip);
      if (geo) results.set(ip, geo);
    })
  );

  return results;
}
