/**
 * SSRF protection: reject URLs that target private/internal networks.
 * Call before passing user-supplied url/domain to Firecrawl or any outbound fetch.
 */

const BLOCKED_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '::1',
  '[::1]'
]);

const BLOCKED_PREFIXES = [
  '10.',           // RFC1918
  '172.16.', '172.17.', '172.18.', '172.19.', '172.20.', '172.21.', '172.22.', '172.23.',
  '172.24.', '172.25.', '172.26.', '172.27.', '172.28.', '172.29.', '172.30.', '172.31.',
  '192.168.',      // RFC1918
  '169.254.',      // link-local
  '100.64.', '100.65.', '100.66.', '100.67.', '100.68.', '100.69.', '100.70.', '100.71.',
  '100.72.', '100.73.', '100.74.', '100.75.', '100.76.', '100.77.', '100.78.', '100.79.',
  '100.80.', '100.81.', '100.82.', '100.83.', '100.84.', '100.85.', '100.86.', '100.87.',
  '100.88.', '100.89.', '100.90.', '100.91.', '100.92.', '100.93.', '100.94.', '100.95.',
  '100.96.', '100.97.', '100.98.', '100.99.', '100.100.', '100.101.', '100.102.', '100.103.',
  '100.104.', '100.105.', '100.106.', '100.107.', '100.108.', '100.109.', '100.110.', '100.111.',
  '100.112.', '100.113.', '100.114.', '100.115.', '100.116.', '100.117.', '100.118.', '100.119.',
  '100.120.', '100.121.', '100.122.', '100.123.', '100.124.', '100.125.', '100.126.', '100.127.', // CGNAT
  'fc00:', 'fd00:', // IPv6 unique local
  'fe80:'          // IPv6 link-local
];

function isBlockedHostname(hostname) {
  if (!hostname || typeof hostname !== 'string') return true;
  const lower = hostname.toLowerCase().trim();
  if (BLOCKED_HOSTS.has(lower)) return true;
  if (lower.endsWith('.localhost') || lower.endsWith('.local')) return true;
  for (const p of BLOCKED_PREFIXES) {
    if (lower.startsWith(p)) return true;
  }
  return false;
}

/**
 * Validates a URL or host for outbound scraping. Throws if SSRF-unsafe.
 * @param {string} input - URL (http(s)://...) or bare host/domain
 * @returns {{ url: string, hostname: string }} normalized URL and hostname
 */
function validateUrlForScraping(input) {
  if (!input || typeof input !== 'string') {
    throw new Error('url_required');
  }
  const trimmed = input.trim();
  let urlStr = trimmed;
  if (!/^https?:\/\//i.test(trimmed)) {
    urlStr = `https://${trimmed}`;
  }
  let hostname;
  try {
    const u = new URL(urlStr);
    hostname = u.hostname;
    if (isBlockedHostname(hostname)) {
      throw new Error('url_not_allowed');
    }
    return { url: urlStr, hostname };
  } catch (err) {
    if (err.message === 'url_not_allowed' || err.message === 'url_required') throw err;
    throw new Error('invalid_url');
  }
}

module.exports = { validateUrlForScraping, isBlockedHostname };
