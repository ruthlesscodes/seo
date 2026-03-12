/**
 * Normalize domain for comparison: lowercase, strip protocol and path.
 * Use when comparing URLs to a domain (e.g. SERP position checks).
 * @param {string} domainOrUrl - e.g. "https://www.example.com/path" or "example.com"
 * @param {object} opts - { stripWww: false } to keep www
 * @returns {string} - e.g. "www.example.com" or "example.com" if stripWww
 */
function normalizeDomain(domainOrUrl, opts = {}) {
  if (!domainOrUrl || typeof domainOrUrl !== 'string') return '';
  const { stripWww = false } = opts;
  let s = domainOrUrl.toLowerCase().trim()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '');
  if (stripWww) s = s.replace(/^www\./, '');
  return s;
}

module.exports = { normalizeDomain };
