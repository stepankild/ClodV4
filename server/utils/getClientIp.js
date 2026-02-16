/**
 * Extract real client IP from request.
 * Handles proxies (Railway, Cloudflare, nginx) via x-forwarded-for / cf-connecting-ip.
 * Requires `app.set('trust proxy', true)` in Express.
 */
export function getClientIp(req) {
  // Cloudflare puts the real IP here
  const cfIp = req.headers?.['cf-connecting-ip'];
  if (cfIp) return cfIp.trim();

  // Standard proxy header — first value is the original client
  const xff = req.headers?.['x-forwarded-for'];
  if (xff) {
    const first = xff.split(',')[0].trim();
    if (first) return first;
  }

  // Express trust-proxy-resolved ip
  if (req.ip) return req.ip;

  // Fallback
  return req.connection?.remoteAddress || '';
}
